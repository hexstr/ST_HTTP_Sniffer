
// plugins/http-observe.js
// 抓取开关与 SSE 连接生命周期绑定：有 SSE 客户端时抓；无客户端时停抓。
// 停止抓取不清空（由前端按钮决定）。
// 路由：/health /stats /logs /sse /clear(GET) /debug/make

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const MAX_LOGS = Number(process.env.HTTP_OBSERVE_MAX_LOGS || 1000);
const MAX_BODY = Number(process.env.HTTP_OBSERVE_MAX_BODY || 16 * 1024 * 1024); // 16MB 预览

let captureEnabled = false; // 仅当存在 SSE 客户端时为 true

const logs = [];
function pushLog(entry) { logs.push(entry); if (logs.length > MAX_LOGS) logs.shift(); }
function clearLogs() { logs.length = 0; }

const sseClients = new Set();
const clientMeta = new Map(); // 心跳定时器等

function broadcastSSE(data) {
  if (!captureEnabled) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch {} }
}

function truncateText(s) {
  if (typeof s !== 'string') s = String(s ?? '');
  if (s.length > MAX_BODY) return s.slice(0, MAX_BODY) + `\n... [truncated ${s.length - MAX_BODY} bytes]`;
  return s;
}
function getUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
  return String(input);
}
function getMethod(input, init) {
  return (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
}
async function normalizeBodyAny(body) {
  try {
    if (body == null) return '';
    if (typeof body === 'string') return truncateText(body);
    if (Buffer.isBuffer(body)) return truncateText(body.toString('utf8'));
    if (body instanceof Uint8Array) return truncateText(Buffer.from(body).toString('utf8'));
    if (typeof body.text === 'function') {
      const t = await body.text();
      return truncateText(t);
    }
    if (typeof body.arrayBuffer === 'function') {
      const buf = Buffer.from(await body.arrayBuffer());
      return truncateText(buf.toString('utf8'));
    }
    return truncateText(JSON.stringify(body));
  } catch { return '<unreadable>'; }
}
async function readRequestBody(input, init) {
  if (init && 'body' in init && init.body != null) return normalizeBodyAny(init.body);
  if (input && typeof input === 'object' && typeof input.clone === 'function') {
    try { const t = await input.clone().text(); return truncateText(t); } catch {}
  }
  return '';
}
async function readResponseBody(res) {
  try { const t = await res.clone().text(); return truncateText(t); } catch { return '<unreadable>'; }
}



function patchNodeHttp(module, scheme) {
  const origRequest = module.request;
  const origGet = module.get;

  module.request = function patchedRequest(...args) {
    // —— 1) 从尾部安全抽取“用户回调”（可选）——
    let userCb = undefined;
    if (args.length > 0 && typeof args[args.length - 1] === 'function') {
      userCb = args.pop();
    }

    // —— 2) 解析 url / options 以便我们做日志用（不影响真正请求）——
    let method = 'GET', hostname = '', path = '/';
    try {
      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        const url = (args[0] instanceof URL) ? args[0] : new URL(args[0]);
        const opt = (args[1] && typeof args[1] === 'object') ? args[1] : {};
        method = opt.method || 'GET';
        hostname = url.hostname || opt.hostname || opt.host || 'localhost';
        path = (url.pathname || '/') + (url.search || '');
      } else {
        const opt = args[0] || {};
        method = opt.method || 'GET';
        hostname = opt.hostname || opt.host || 'localhost';
        path = opt.path || '/';
      }
    } catch { /* 忽略解析失败，仅用于日志 */ }

    const start = Date.now();
    let reqBody = '';

    // —— 3) 我们自己的“包裹回调”，先采集、再安全地调用用户回调 —— 
    function wrappedCb(res) {
      try {
        // 采集响应体（保持你原来的 data/end 监听与截断）
        let respBody = '';
        res.on('data', (chunk) => {
          if (!captureEnabled) return;
          respBody += chunk.toString('utf8');
          if (respBody.length > MAX_BODY) respBody = respBody.slice(0, MAX_BODY);
        });
        res.on('end', () => {
          if (!captureEnabled) return;
          const entry = {
            time: new Date().toISOString(),
            ms: Date.now() - start,
            method, url: `${scheme}://${hostname}${path}`,
            statusCode: res.statusCode || 0,
            requestBody: reqBody,
            responseBody: respBody,
          };
          pushLog(entry);
          broadcastSSE(entry);
        });

        // **最后**再把 res 传给用户的回调（如果存在）
        if (typeof userCb === 'function') userCb(res);
      } catch (e) {
        // 防止“用户回调抛错”击穿到解析器：吞掉并打印
        console.error('[http-observe] user callback error:', e);
      }
    }

    // —— 4) 用“原始参数 + 我们的 wrappedCb”创建请求（不破坏语义）——
    const req = origRequest.apply(module, [...args, wrappedCb]);

    // —— 5) 采集请求体（保持你原来的 write/end 包裹与截断）——
    const origWrite = req.write;
    req.write = function patchedWrite(chunk, encoding, cb) {
      if (captureEnabled && chunk) {
        reqBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (reqBody.length > MAX_BODY) reqBody = reqBody.slice(0, MAX_BODY);
      }
      return origWrite.call(req, chunk, encoding, cb);
    };
    const origEnd = req.end;
    req.end = function patchedEnd(chunk, encoding, cb) {
      if (captureEnabled && chunk) {
        reqBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        if (reqBody.length > MAX_BODY) reqBody = reqBody.slice(0, MAX_BODY);
      }
      return origEnd.call(req, chunk, encoding, cb);
    };

    req.on('error', (err) => {
      if (!captureEnabled) return;
      const entry = {
        time: new Date().toISOString(),
        ms: Date.now() - start,
        method, url: `${scheme}://${hostname}${path}`,
        statusCode: -1,
        requestBody: reqBody,
        responseBody: '',
        error: String(err && err.message || err),
      };
      pushLog(entry); broadcastSSE(entry);
    });

    return req;
  };

  // 让 get 的行为与原生保持一致：复用我们刚才的 request 包装
  module.get = function patchedGet(...args) {
    const req = module.request(...args);
    req.end();
    return req;
  };
}



function setupRoutes(router) {
  router.get('/health', (req, res) => {
    res.json({ ok: true, plugin: 'http-observe', fetchPatched: !!globalThis.__fetch_patched__, captureEnabled });
  });
  router.get('/status', (req, res) => { res.json({ client: sseClients.size, count: logs.length, max: MAX_LOGS }); });
  router.get('/logs', (req, res) => { res.json({ count: logs.length, max: MAX_LOGS, logs }); });

  // —— SSE：规范头 + 心跳 + 禁缓冲（反代兼容）——
  router.get('/sse', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',          // 必须头（MDN/WHATWG）
      'Cache-Control': 'no-cache, no-transform',     // 禁缓存/转码（避免压缩破坏流）
      'Connection': 'keep-alive',                    // 长连接
      'X-Accel-Buffering': 'no',                     // Nginx 禁缓冲
    });
    res.flushHeaders?.();

    // 初始注释行：避免某些代理的超时
    res.write(':\n');

    sseClients.add(res);
    captureEnabled = true; // 有至少一个客户端即开始抓取

    // 心跳（防闲置断连）
    const heartbeat = setInterval(() => {
      try { res.write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`); } catch {}
    }, 15000);
    clientMeta.set(res, { heartbeat });

    req.on('close', () => {
      const meta = clientMeta.get(res);
      if (meta?.heartbeat) clearInterval(meta.heartbeat);
      clientMeta.delete(res);

      sseClients.delete(res);
      // 无客户端则停止抓取（不清空）
      if (sseClients.size === 0) captureEnabled = false;

      try { res.end(); } catch {}
    });
  });

  // 清空日志（GET，避开 CSRF）
  router.get('/clear', (req, res) => {
    clearLogs();
    res.json({ ok: true, message: 'logs cleared' });
  });

  // 自测：触发一次服务端 fetch（POST 带 body）
  router.get('/debug/make', async (req, res) => {
    try {
      const r = await fetch('https://httpbin.org/anything', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: 'http-observe', now: Date.now() }),
      });
      const text = await r.text();
      res.json({ ok: true, status: r.status, len: text.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message || e) });
    }
  });
  
    // —— 在 setupRoutes(router) 里加一个查看页 ——
    // 注意：这是只读页，仍然复用现有的 /sse /logs /clear
    router.get('/view', (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const htmlPath = path.join(__dirname, 'sniffer_log.html');
    try {
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
        res.end(htmlContent);
    } catch (err) {
        res.status(500).end('Error loading template file');
        console.error(err);
    }
    });

}

async function init(router) {
  console.log('[http-observe] init start');

  patchNodeHttp(http, 'http');
  patchNodeHttp(https, 'https');

  setupRoutes(router);
  console.log('[http-observe] routes: /api/plugins/http-observe/{health,stats,logs,sse,clear,debug/make}');
  console.log('HTTP Observe plugin loaded!');
  return Promise.resolve();
}
async function exit() {
  for (const res of sseClients) { try { res.end(); } catch {} }
  sseClients.clear();
  clientMeta.clear();
  return Promise.resolve();
}
module.exports = {
  init,
  exit,
  info: {
    id: 'http-observe',
    name: 'HTTP Observe',
    description: 'Capture server-side fetch bodies only while SSE is connected; proxy-friendly SSE.',
  },
};

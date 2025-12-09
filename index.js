import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "ST_HTTP_Sniffer";
const extensionFolderPath = `/scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {
  live_enabled: true,
  auto_scroll: true,
  max_rows: 500,
  open_on_load: false,
  pos: { x: null, y: null },
  size: { w: 860, h: 520 },
  open: false,
};

let es = null;
let selectedSummaryRow = null;

/* ------------------------- 基础工具 ------------------------- */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pretty(objOrStr) {
  try {
    if (typeof objOrStr === "string") {
      const parsed = JSON.parse(objOrStr);
      return JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(objOrStr, null, 2);
  } catch {
    return String(objOrStr ?? "");
  }
}

/* ------------------------- 对话框搭建（含右侧面板） ------------------------- */

function buildDialog() {
  const html = `
<div id="http_observe_dialog" class="http-observe-dialog" style="display:none;">
  <div id="http_observe_drag_handle" class="http-observe-dialog-header" style="display:flex;align-items:center;justify-content:space-between;">
    <div class="http-observe-title">ST_HTTP_Sniffer</div>
    <div class="http-observe-actions">
      <button id="http_observe_minimize" class="http-observe-btn">最小化</button>
      <button id="http_observe_close" class="http-observe-btn danger">关闭</button>
    </div>
  </div>

  <div class="http-observe-dialog-body" style="height:calc(100% - 40px);display:flex;flex-direction:column;">
    <div class="http-observe-controls" style="padding:8px;border-bottom:1px solid #3a3a3a;color:#e6e6e6;">
      <div class="top-part">
        <label><input type="checkbox" id="http_observe_live_enabled" style="margin: 0 5px 0 0;display: inline-grid;"> 实时连接 (SSE)</label>
        <label style="margin-left:12px;">最大行数
          <input type="number" id="http_observe_max_rows" min="10" step="10" style="width:90px">
        </label>
        <label style="margin-left:12px;"><input type="checkbox" id="http_observe_auto_scroll" style="margin: 0 5px 0 0;display: inline-grid;" checked> 自动滚动</label>
        <button id="http_observe_fetch" class="http-observe-btn" style="margin-left:12px;">拉取最新</button>
        <button id="http_observe_clear" class="http-observe-btn danger" style="margin-left:6px;">清空日志</button>
      </div>
      <div class="bottom-part">
        <span>当前条数：<b id="http_observe_count">0</b></span>
        <span style="margin-left:12px;">缓冲上限：<b id="http_observe_max">—</b></span>
        <span style="margin-left:12px;">SSE 状态：<b id="http_observe_sse_status">未连接</b></span>
      </div>
    </div>

    <div class="http-observe-content" style="flex:1 1 auto;display:flex;min-height:0;">
      <div class="http-observe-table-wrapper" style="flex: 1 1 auto;overflow:auto;padding:8px;background:#141414;color:#e6e6e6;">
        <table id="http_observe_table" style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="width:18px;"></th>
              <th style="width:120px;">时间</th>
              <th style="width:60px;">耗时</th>
              <th style="width:40px;">方法</th>
              <th style="width:40px;">状态码</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <div id="http_observe_sidepanel"
           style="width: 50%; min-width: 360px; max-width: 65%;
                  border-left:1px solid #3a3a3a; background:#171717; color:#e6e6e6;
                  display:flex; flex-direction:column;">

        <div id="http_observe_sidepanel_header" style="padding:10px;border-bottom:1px solid #3a3a3a;">
          <div style="font-weight:600;font-size:13px;margin-bottom:6px;">详情</div>
          <div id="http_observe_sidepanel_meta"
               style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#d7d7d7;">
            <div><b>Method:</b> —</div>
            <div><b>Status:</b> —</div>
            <div><b>Duration:</b> —</div>
            <div><b>Time:</b> —</div>
          </div>
          <div style="margin-top:6px;font-size:12px;color:#cfcfcf;">URL</div>
          <div id="http_observe_sidepanel_url"
               style="font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;
                      font-size:12px;line-height:1.35;background:#202020;border:1px solid #3a3a3a;
                      border-radius:6px;padding:8px;word-break:break-word;">—</div>
        </div>

        <div style="display:flex;border-bottom:1px solid #3a3a3a;">
          <button class="http-observe-tab-btn active" data-tab="request"
                  style="flex:1 1 0;padding:8px 12px;background:#1f1f1f;color:#fff;border:none;border-right:1px solid #3a3a3a;cursor:pointer;">
            Request
          </button>
          <button class="http-observe-tab-btn" data-tab="response"
                  style="flex:1 1 0;padding:8px 12px;background:#151515;color:#fff;border:none;cursor:pointer;">
            Response
          </button>
        </div>

        <div id="http_observe_tab_request" class="http-observe-tab"
             style="flex:1 1 auto;overflow:auto;padding:12px;display:block;">
          <div style="font-size:12px;color:#cfcfcf;margin-bottom:6px;">Headers</div>
          <pre id="http_observe_req_headers"
               style="white-space:pre-wrap;margin:0;font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;
                      font-size:12px;line-height:1.35;background:#202020;border:1px solid #3a3a3a;border-radius:6px;padding:8px;">—</pre>

          <div style="margin-top:10px;display:flex;align-items:center;gap:8px;">
            <div style="font-size:12px;color:#cfcfcf;">Body</div>
            <button id="http_observe_copy_req" class="http-observe-btn" style="padding:4px 8px;">复制</button>
          </div>
          <textarea id="http_observe_req_body"
                    style="width:100%;min-height:200px;resize:vertical;background:#202020!important;color:#e6e6e6;
                           border:1px solid #3a3a3a;border-radius:6px;padding:8px;font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;line-height:1.35;"></textarea>
        </div>

        <div id="http_observe_tab_response" class="http-observe-tab"
             style="flex:1 1 auto;overflow:auto;padding:12px;display:none;">
          <div style="font-size:12px;color:#cfcfcf;margin-bottom:6px;">Headers</div>
          <pre id="http_observe_resp_headers"
               style="white-space:pre-wrap;margin:0;font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;
                      font-size:12px;line-height:1.35;background:#202020;border:1px solid #3a3a3a;border-radius:6px;padding:8px;">—</pre>

          <div style="margin-top:10px;display:flex;align-items:center;gap:8px;">
            <div style="font-size:12px;color:#cfcfcf;">Body</div>
            <button id="http_observe_copy_resp" class="http-observe-btn" style="padding:4px 8px;">复制</button>
          </div>
          <textarea id="http_observe_resp_body"
                    style="width:100%;min-height:200px;resize:vertical;background:#202020!important;color:#e6e6e6;
                           border:1px solid #3a3a3a;border-radius:6px;padding:8px;font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;line-height:1.35;"></textarea>
        </div>
      </div>
    </div>
  </div>

  <div id="http_observe_resizer" class="http-observe-resizer" style="position:absolute;width:14px;height:14px;right:2px;bottom:2px;cursor:se-resize;background:linear-gradient(135deg, transparent 0 50%, #666 50% 100%);opacity:0.85;"></div>
</div>
`;
  $("body").append(html);
}

/* ------------------------- 行渲染（只列表左侧；右侧由面板显示） ------------------------- */

function renderRow(entry) {
  const $tbody = $("#http_observe_table tbody");

  const summaryHtml = `
<tr class="summary" style="cursor:pointer;">
  <td class="toggle-cell" style="width:18px;color:#bdbdbd;">▸</td>
  <td>${escapeHtml(entry.time ?? "")}</td>
  <td>${escapeHtml(entry.ms ?? "")}</td>
  <td>${escapeHtml(entry.method ?? "")}</td>
  <td>${escapeHtml(entry.statusCode ?? "")}</td>
  <td style="font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;word-break:break-word;">
    ${escapeHtml(entry.url ?? "")}
  </td>
</tr>`;
  const $row = $(summaryHtml);

  $row.on("click", () => {
    if (selectedSummaryRow)
      selectedSummaryRow.removeClass("selected").css("background", "");
    selectedSummaryRow = $row;
    selectedSummaryRow
      .addClass("selected")
      .css("background", "rgba(255,255,255,0.04)");

    fillSidePanel(entry);

    if ($("#http_observe_auto_scroll").is(":checked")) {
      const wrapper = $(".http-observe-table-wrapper")[0];
      wrapper.scrollTop = wrapper.scrollHeight;
    }
  });

  $tbody.append($row);

  const maxRows =
    Number($("#http_observe_max_rows").val()) || defaultSettings.max_rows;
  while ($tbody.children("tr.summary").length > maxRows) {
    const $first = $tbody.children("tr.summary").first();
    if (selectedSummaryRow && $first.is(selectedSummaryRow)) {
      selectedSummaryRow = null;
      clearSidePanel();
    }
    $first.remove();
  }

  $("#http_observe_count").text(String($tbody.children("tr.summary").length));
  if ($("#http_observe_auto_scroll").is(":checked")) {
    const wrapper = $(".http-observe-table-wrapper")[0];
    wrapper.scrollTop = wrapper.scrollHeight;
  }
}

/* ------------------------- 右侧面板填充/清空 ------------------------- */

function fillSidePanel(entry) {
  const reqHeaders =
    entry.requestHeaders ?? entry.reqHeaders ?? entry.headers ?? {};
  const respHeaders = entry.responseHeaders ?? entry.respHeaders ?? {};
  const reqBody = entry.requestBody ?? "";
  const respBody = entry.responseBody ?? "";

  $("#http_observe_sidepanel_meta").html(`
    <div><b>Method:</b> ${escapeHtml(entry.method ?? "—")}</div>
    <div><b>Status:</b> ${escapeHtml(entry.statusCode ?? "—")}</div>
    <div><b>Duration:</b> ${escapeHtml(entry.ms != null ? entry.ms : "—")} ${
    entry.ms != null ? "ms" : ""
  }</div>
    <div><b>Time:</b> ${escapeHtml(entry.time ?? "—")}</div>
  `);
  $("#http_observe_sidepanel_url").text(entry.url ?? "—");

  $("#http_observe_req_headers").text(pretty(reqHeaders));
  $("#http_observe_req_body").val(pretty(reqBody));

  $("#http_observe_resp_headers").text(pretty(respHeaders));
  $("#http_observe_resp_body").val(pretty(respBody));
}

function clearSidePanel() {
  $("#http_observe_sidepanel_meta").html(`
    <div><b>Method:</b> —</div>
    <div><b>Status:</b> —</div>
    <div><b>Duration:</b> —</div>
    <div><b>Time:</b> —</div>
  `);
  $("#http_observe_sidepanel_url").text("—");
  $("#http_observe_req_headers").text("—");
  $("#http_observe_req_body").val("");
  $("#http_observe_resp_headers").text("—");
  $("#http_observe_resp_body").val("");
}

/* ------------------------- Tabs 切换 & 复制 ------------------------- */

function initTabs() {
  $(document).on("click", ".http-observe-tab-btn", (e) => {
    const tab = $(e.currentTarget).data("tab");

    $(".http-observe-tab-btn")
      .removeClass("active")
      .css({ background: "#151515" });
    $(e.currentTarget).addClass("active").css({ background: "#1f1f1f" });

    if (tab === "request") {
      $("#http_observe_tab_request").show();
      $("#http_observe_tab_response").hide();
    } else {
      $("#http_observe_tab_request").hide();
      $("#http_observe_tab_response").show();
    }
  });

  $(document).on("click", "#http_observe_copy_req", () => {
    const ta = document.getElementById("http_observe_req_body");
    ta.select();
    document.execCommand("copy");
    toastr?.success?.("已复制 Request Body");
  });
  $(document).on("click", "#http_observe_copy_resp", () => {
    const ta = document.getElementById("http_observe_resp_body");
    ta.select();
    document.execCommand("copy");
    toastr?.success?.("已复制 Response Body");
  });
}

/* ------------------------- SSE / 拉取 / 清空 ------------------------- */

function connectSSE() {
  if (es) return;
  $("#http_observe_sse_status").text("连接中…");
  es = new EventSource("/api/plugins/st_http_sniffer/sse");
  es.onopen = () => {
    $("#http_observe_sse_status").text("已连接");
  };
  es.onerror = () => {
    $("#http_observe_sse_status").text("错误/断开");
  };
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      renderRow(data);
    } catch (e) {
      console.warn("[st_http_sniffer] SSE parse error:", e);
    }
  };
}

function disconnectSSE() {
  if (es) {
    es.close();
    es = null;
  }
  $("#http_observe_sse_status").text("未连接");
}

async function fetchLatest() {
  try {
    const res = await fetch("/api/plugins/st_http_sniffer/logs");
    const json = await res.json();
    $("#http_observe_max").text(String(json.max ?? "—"));
    const $tbody = $("#http_observe_table tbody");
    $tbody.empty();
    (json.logs ?? []).forEach(renderRow);
  } catch (e) {
    console.error("[st_http_sniffer] fetch logs failed:", e);
    toastr.error("拉取日志失败");
  }
}

async function clearLogs() {
  try {
    const res = await fetch("/api/plugins/st_http_sniffer/clear", {
      method: "GET",
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message ?? "unknown error");
    const $tbody = $("#http_observe_table tbody");
    $tbody.empty();
    $("#http_observe_count").text("0");
    clearSidePanel();
    toastr.success("日志已清空");
  } catch (e) {
    console.error("[st_http_sniffer] clear logs failed:", e);
    toastr.error("清空日志失败");
  }
}

/* ------------------------- 设置/窗口行为（保持原有） ------------------------- */

async function loadSettings() {
  extension_settings[extensionName] = extension_settings[extensionName] ?? {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }
  const { size, pos } = extension_settings[extensionName];

  const $dlg = $("#http_observe_dialog");
  if (size?.w && size?.h)
    $dlg.css({ width: size.w + "px", height: size.h + "px" });
  if (pos?.x != null && pos?.y != null) {
    $dlg.css({
      left: pos.x + "px",
      top: pos.y + "px",
      right: "auto",
      bottom: "auto",
    });
  }

  $("#http_observe_auto_scroll").prop(
    "checked",
    extension_settings[extensionName].auto_scroll
  );
  $("#http_observe_max_rows").val(extension_settings[extensionName].max_rows);

  if (
    extension_settings[extensionName].open_on_load ||
    extension_settings[extensionName].open
  ) {
    openDialog();
  }
}

function openDialog() {
  $("#http_observe_dialog").fadeIn(120);
  extension_settings[extensionName].open = true;
  saveSettingsDebounced();
  fetchLatest();
}

function closeDialog() {
  disconnectSSE();
  $("#http_observe_dialog").fadeOut(120);
  extension_settings[extensionName].open = false;
  saveSettingsDebounced();
}

function onLiveToggle(ev) {
  const enabled = Boolean($(ev.target).prop("checked"));
  if (enabled) connectSSE();
  else disconnectSSE();
}

function onAutoScrollToggle(ev) {
  const enabled = Boolean($(ev.target).prop("checked"));
  extension_settings[extensionName].auto_scroll = enabled;
  saveSettingsDebounced();
}

function onMaxRowsChange(ev) {
  const val = Number($(ev.target).val()) || defaultSettings.max_rows;
  extension_settings[extensionName].max_rows = val;
  saveSettingsDebounced();
}

function minimizeDialog() {
  const $dlg = $("#http_observe_dialog");
  $dlg.toggleClass("minimized");
  if ($dlg.hasClass("minimized")) {
    $dlg.css({ height: "40px" });
    $(".http-observe-dialog-body, #http_observe_resizer").hide();
  } else {
    const h =
      extension_settings[extensionName].size?.h ?? defaultSettings.size.h;
    $dlg.css({ height: h + "px" });
    $(".http-observe-dialog-body, #http_observe_resizer").show();
  }
}

function initDragAndResize() {
  const $dlg = $("#http_observe_dialog");
  const $handle = $("#http_observe_drag_handle");
  const $resizer = $("#http_observe_resizer");

  let dragging = false,
    startX = 0,
    startY = 0,
    origLeft = 0,
    origTop = 0;
  $handle.on("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = $dlg[0].getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    $("body").addClass("no-select");
    e.preventDefault();
  });
  $(document).on("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX,
      dy = e.clientY - startY;
    const left = Math.max(0, origLeft + dx);
    const top = Math.max(0, origTop + dy);
    $dlg.css({
      left: left + "px",
      top: top + "px",
      right: "auto",
      bottom: "auto",
    });
  });
  $(document).on("mouseup", () => {
    if (dragging) {
      dragging = false;
      $("body").removeClass("no-select");
      const rect = $dlg[0].getBoundingClientRect();
      extension_settings[extensionName].pos = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
      };
      saveSettingsDebounced();
    }
  });

  let resizing = false,
    rStartX = 0,
    rStartY = 0,
    origW = 0,
    origH = 0;
  $resizer.on("mousedown", (e) => {
    resizing = true;
    rStartX = e.clientX;
    rStartY = e.clientY;
    const rect = $dlg[0].getBoundingClientRect();
    origW = rect.width;
    origH = rect.height;
    $("body").addClass("no-select");
    e.preventDefault();
  });
  $(document).on("mousemove", (e) => {
    if (!resizing) return;
    const dw = e.clientX - rStartX;
    const dh = e.clientY - rStartY;
    const w = Math.max(520, origW + dw);
    const h = Math.max(320, origH + dh);
    $dlg.css({ width: w + "px", height: h + "px" });
  });
  $(document).on("mouseup", () => {
    if (resizing) {
      resizing = false;
      $("body").removeClass("no-select");
      const rect = $dlg[0].getBoundingClientRect();
      extension_settings[extensionName].size = {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
      saveSettingsDebounced();
    }
  });
}

/* ------------------------- 启动 ------------------------- */

jQuery(async () => {
  const settingsHtml = await $.get(
    `${extensionFolderPath}/st_http_sniffer.html`
  );
  $("#extensions_settings2").append(settingsHtml);

  buildDialog();

  $("#http_observe_open_dialog").on("click", openDialog);
  $("#http_observe_close").on("click", closeDialog);
  $("#http_observe_minimize").on("click", minimizeDialog);

  $("#http_observe_live_enabled").on("input", onLiveToggle);
  $("#http_observe_auto_scroll").on("input", onAutoScrollToggle);
  $("#http_observe_max_rows").on("change", onMaxRowsChange);
  $("#http_observe_fetch").on("click", fetchLatest);
  $("#http_observe_clear").on("click", clearLogs);

  initDragAndResize();
  initTabs();
  await loadSettings();
});

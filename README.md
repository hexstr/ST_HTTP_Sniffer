# ST_HTTP_Sniffer
一个`SillyTavern`插件，用来监听http[s]请求，主要是`/generate`。
![preview.webp](https://github.com/hexstr/ST_HTTP_Sniffer/blob/master/preview.webp?raw=true)
起因是怀疑记忆表格并没有随着prompt一起发送给AI，虽然文档中有写会注入但在提示词中没有找到。重新在VPS上部署mitmproxy太麻烦所以写了一个插件用来抓取所有HTTP请求。

## 用法
前端插件直接在扩展中安装即可，后端插件在`plugins/`中，需要先在`config.yaml`中启用`enableServerPlugins`，然后把其中的文件复制到`SillyTavern/plugins/`下。
具体参考[服务器插件](https://st-docs.role.fun/for-contributors/server-plugins/)

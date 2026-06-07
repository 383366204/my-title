# taobao-opc

淘宝 OPC/OPT 图片服务转接 skill。通过 DingTalk MCP 网关调用远端淘宝商品图片服务，不在本地实现淘宝开放平台签名、cookie 或 token 管理。

## 配置

在项目 `.env` 中配置任一变量：

```bash
TAOBAO_OPC_URL=https://mcp-gw.dingtalk.com/server/xxx?key=xxx
# 兼容旧命名
# TAOBAO_OPT_URL=https://mcp-gw.dingtalk.com/server/xxx?key=xxx
```

不要把带 `key=` 的真实网关 URL 提交到仓库。

## 调用模型

```text
本项目 MCP/CLI
  -> skills/taobao-opc/src/mcp-client.js
  -> DingTalk MCP Gateway
  -> 淘宝图片服务远端工具
```

先调用 `listTools()` 获取远端 `inputSchema`，再用 `callTool(name, args)` 调用具体工具。参数必须严格按远端 `inputSchema` 组装；有些工具参数在根层级，有些工具参数包在 `params` 内。

## 常见远端工具

- `query_item_more_info`：查询商品信息。
- `main_image_analysis_task_trigger`：触发主图分析任务。
- `main_image_analysis_task_fetch`：查询主图分析结果。
- `create_picture_from_tb`：基于淘宝图片生成优化图。
- `query_picture_from_tb`：查询生图任务。
- `upload_picture_to_tb_workspace`：上传图片到淘宝图片空间。
- `update_picture_tb_main`：更新商品主图。

如果远端返回 `NEED_AUTH` 或授权链接，把授权链接返回给用户，由用户自行完成授权。

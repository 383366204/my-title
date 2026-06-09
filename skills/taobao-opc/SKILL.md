# taobao-opc

Use this skill to call remote Taobao image/product tools through the DingTalk MCP gateway.

This skill is for weak agents. Do not implement Taobao signing, cookie handling, or token handling locally.

## Configuration

Set one environment variable in `.env`:

```bash
TAOBAO_OPC_URL=https://mcp-gw.dingtalk.com/server/xxx?key=xxx
```

Legacy compatible name:

```bash
TAOBAO_OPT_URL=https://mcp-gw.dingtalk.com/server/xxx?key=xxx
```

Never commit a real gateway URL that contains `key=`.

## Weak Agent Golden Path

1. Load the gateway URL from environment.
2. Call `listTools()` first.
3. Read the remote `inputSchema`.
4. Call `callTool(name, args)` with arguments that exactly match the schema.
5. If the remote tool returns `NEED_AUTH` or an authorization URL, report it to the user and stop.

## Common Remote Tools

Tool names may change. Always trust `listTools()` over this list.

- `query_item_more_info`: query item details.
- `main_image_analysis_task_trigger`: start main-image analysis.
- `main_image_analysis_task_fetch`: fetch main-image analysis result.
- `create_picture_from_tb`: create/optimize an image from a Taobao image.
- `query_picture_from_tb`: query image-generation task.
- `upload_picture_to_tb_workspace`: upload an image to Taobao workspace.
- `update_picture_tb_main`: update product main image.

## Failure Handling

- Missing gateway URL: stop and ask the user to set `TAOBAO_OPC_URL`.
- `NEED_AUTH`: show the authorization link to the user; do not bypass auth.
- Schema mismatch: call `listTools()` again and rebuild args.
- Remote timeout: retry once; if it fails again, stop and report the tool name and args.

## Never Do These

- Do not commit gateway URLs.
- Do not guess tool arguments.
- Do not call a remote tool before reading its schema.
- Do not store auth tokens in source files.

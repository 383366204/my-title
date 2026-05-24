# websockets 16.x `process_request` API 变更 — 调试记录

## 问题现象

使用 `websockets.serve()` 的 `process_request` 参数处理 HTTP 请求时：

```python
async with websockets.serve(handler, "127.0.0.1", port, process_request=my_handler):
    ...
```

**症状**:
- 服务器启动成功，端口在监听
- `curl http://127.0.0.1:{port}/` 返回 **空响应**
- curl exit code: **52** (Empty reply from server)
- 日志显示: `AssertionError: assert isinstance(response, Response)`

## 根因分析

### websockets 版本差异

| 版本 | `process_request` 签名 | 返回值类型 |
|------|------------------------|-----------|
| < 12 (旧) | `(path: str, request_headers) -> tuple` | `(status_code, headers_list, body_bytes)` |
| ≥ 14 (新) | `(connection: ServerConnection, request_headers) -> Response` | `Response` 对象 |

### 验证方法

```bash
python3 -c "import websockets; print(websockets.__version__)"
# 输出: 16.0 → 使用新 API
```

### 错误代码模式（❌ 不要这样做）

```python
# ❌ 旧版写法 — 在 websockets 16.x 上会失败
async def process_request(path, request_headers):
    if path == "/":
        return 200, [("Content-Type", "application/json")], b'{"ok":true}'
    return 404, [], b"not found"
```

错误日志：
```
[ERROR] unexpected internal error
Traceback (most recent call last):
  File ".../websockets/asyncio/server.py", line 169, in handshake
    assert isinstance(response, Response)  # help mypy
AssertionError
```

### 正确代码模式（✅ 应该这样做）

```python
from websockets.asyncio.server import Response
from websockets.datastructures import Headers

async def process_request(connection, request_headers):
    h = Headers()
    h["Content-Type"] = "application/json"
    
    # 注意：connection 是 ServerConnection 对象，不是路径字符串！
    # 如果需要 path，可能需要从 connection.path 或其他属性获取
    
    return Response(200, "OK", h, b'{"ok":true}')
```

## 调试过程记录

### 尝试 1: 元组返回值 + await drain（HTTP server 模式）
用 `asyncio.start_server` 单独跑 HTTP，websockets 跑 WS 在不同端口。
→ 失败：两个服务绑定同一端口冲突 (`OSError: [Errno 98] address already in use`)

### 尝试 2: 同一端口 HTTP+WS 分离（port / port+1）
HTTP 用 asyncio.start_server，WS 用 websockets.serve。
→ 失败：curl 到 HTTP 端口返回空（缺少 drain），修复后仍有问题

### 尝试 3: websockets.process_request 返回元组
直接返回 `(200, headers, body)` 元组。
→ 失败：AssertionError — websockets 16.x 要求 Response 对象

### 尝试 4: 导入 Response 类并返回对象
从 `websockets.asyncio.server` 导入 `Response`，构造对象返回。
→ **部分成功**：最小测试脚本在独立端口上工作正常

### 最终发现
第一个参数不是 `path` 字符串而是 `ServerConnection` 对象：
```
path=<websockets.asyncio.server.ServerConnection object at 0x...>
```

## 最小可工作测试

```python
import asyncio
from websockets.asyncio.server import serve, Response
from websockets.datastructures import Headers

async def handler(ws, path):
    await ws.wait_closed()

async def process_request(connection, request_headers):
    h = Headers()
    h["Content-Type"] = "application/json"
    return Response(200, "OK", h, b'{"ok":true}')

async def main():
    async with serve(handler, "127.0.0.1", 19888, process_request=process_request):
        print("listening on 19888")
        await asyncio.Future()

asyncio.run(main())
```

验证：
```bash
curl -s http://127.0.0.1:19888/
# 输出: {"ok":true} ✅
```

## 相关文件

- 中继服务器完整代码: `templates/relay_server.py`
- Browser Relay 架构文档: `references/browser-relay.md`

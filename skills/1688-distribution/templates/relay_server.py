#!/usr/bin/env python3
"""
Hermes Browser Relay Server — 兼容 OpenClaw Browser Relay Chrome 扩展协议

让 Hermes 通过 CDP 协议操作用户已有的 Chrome 标签页（继承登录状态）。

用法:
    python3 relay_server.py [--port 19876] [--token hermes-relay-2026]

依赖:
    pip install websockets>=14

⚠️  websockets 14+ 的 process_request API 与旧版不同：
    - 第一个参数是 ServerConnection 对象（不是路径字符串）
    - 返回值必须是 Response 对象（不是元组）
    - Headers 必须用 websockets.datastructures.Headers 类型
    详见 references/websockets16-process-request-gotcha.md
"""

import asyncio
import json
import os
import time
import hashlib
import hmac
import argparse
import logging
from urllib.parse import urlparse, parse_qs

import websockets
from websockets.asyncio.server import serve, Response
from websockets.datastructures import Headers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("relay")

# ── 全局状态 ─────────────────────────────────────────────────────────────

ext_ws = None       # Chrome 扩展的 WebSocket 连接
ctrl_ws = None      # Hermes 控制器的 WebSocket 连接
pending = {}        # id -> Future，用于等待 CDP 命令响应

# 默认配置（可通过命令行覆盖）
DEFAULT_PORT = 19876
DEFAULT_TOKEN = "hermes-relay-2026"
PORT = DEFAULT_PORT
TOKEN = DEFAULT_TOKEN


# ── 工具函数 ──────────────────────────────────────────────────────────────

def hmac_token(gw_token: str, port: int) -> str:
    """复现 OpenClaw 扩端的 Token 派生算法 (background-utils.js::deriveRelayToken)"""
    key = gw_token.encode("utf-8")
    msg = f"openclaw-extension-relay-v1:{port}".encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).digest().hex()


# ── HTTP handler（健康检查 + CDP 发现接口）───────────────────────────────

async def process_request(connection, request_headers):
    """
    处理非 WebSocket 的 HTTP 请求。

    ⚠️ websockets 16.x API:
      - connection 参数是 ServerConnection 对象，不是路径字符串
      - 必须返回 Response 对象，不能返回元组
      - Headers 必须用 websockets.datastructures.Headers
    """
    try:
        # 尝试从连接对象获取 path（websockets 16.x 可能不直接提供）
        path = getattr(connection, 'path', None) or '/'

        log.info("[HTTP] %s", path)

        if path == "/":
            body = json.dumps({"status": "ok", "service": "hermes-browser-relay"})
            h = Headers()
            h["Content-Type"] = "application/json"
            h["x-openclaw-relay-token"] = TOKEN
            return Response(200, "OK", h, body.encode())

        if path == "/json/version":
            ws_url = f"ws://127.0.0.1:{PORT}/cdp"
            body = json.dumps({
                "Browser": "Chrome (via Hermes Browser Relay)",
                "Protocol-Version": "1.3",
                "User-Agent": "Hermes-Browser-Relay/1.0",
                "webSocketDebuggerUrl": ws_url,
            })
            h = Headers()
            h["Content-Type"] = "application/json"
            return Response(200, "OK", h, body.encode())

        h = Headers()
        h["Content-Type"] = "text/plain"
        return Response(404, "Not Found", h, b"not found")

    except Exception as e:
        log.error("[HTTP] error: %s", e, exc_info=True)
        h = Headers()
        h["Content-Type"] = "text/plain"
        return Response(500, "Internal Server Error", h, f"error: {e}".encode())


# ── Chrome 扩展 WebSocket handler ─────────────────────────────────────────

async def handle_ext(ws):
    """处理来自 OpenClaw Browser Relay Chrome 扩展的 WebSocket 连接"""
    global ext_ws
    log.info("[EXT] ✅ Chrome 扩展已连接")
    ext_ws = ws

    try:
        # ── 发送 connect.challenge ──
        nonce = f"ch-{time.time()}-{os.urandom(4).hex()}"
        await ws.send(json.dumps({
            "type": "event",
            "event": "connect.challenge",
            "payload": {"nonce": nonce},
        }))
        log.info("[EXT] challenge 已发送")

        # ── 消息循环 ──
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type")
            method = msg.get("method")

            # 握手响应
            if mtype == "req" and method == "connect":
                tok = (msg.get("params", {}).get("auth", {}) or {}).get("token", "")
                ok = bool(tok) or not TOKEN
                await ws.send(json.dumps({
                    "type": "res",
                    "id": msg.get("id"),
                    "ok": ok,
                    "result": {"accepted": True} if ok else {},
                    "error": None if ok else {"message": "认证失败"},
                }))
                log.info("[EXT] 握手 %s", "✅ 成功" if ok else "❌ 失败")
                continue

            # Ping → Pong
            if method == "ping":
                await ws.send(json.dumps({"method": "pong"}))
                continue

            # CDP 事件 → 转发给 Hermes 控制器
            if method == "forwardCDPEvent":
                if ctrl_ws and not ctrl_ws.closed:
                    await ctrl_ws.send(raw)
                continue

            # CDP 命令响应 → resolve pending future 或转发给控制器
            rid = msg.get("id")
            if rid is not None and ("result" in msg or "error" in msg):
                fut = pending.pop(rid, None)
                if fut and not fut.done():
                    fut.set_result(msg)
                elif ctrl_ws and not ctrl_ws.closed:
                    await ctrl_ws.send(raw)
                continue

            log.debug("[EXT] 未处理消息: %s", str(msg)[:120])

    except websockets.ConnectionClosed as e:
        log.info("[EXT] 断开 code=%s reason=%s", e.code, getattr(e, 'reason', ''))
    finally:
        ext_ws = None


# ── Hermes 控制器 WebSocket handler ───────────────────────────────────────

async def handle_ctrl(ws):
    """处理来自 Hermes browser_tool 的 CDP WebSocket 连接"""
    global ctrl_ws
    log.info("[CTRL] ✅ Hermes 控制器已连接")
    ctrl_ws = ws

    try:
        # ── 模拟 Target.attachedToTarget 事件 ──
        await ws.send(json.dumps({
            "method": "forwardCDPEvent",
            "params": {
                "method": "Target.attachedToTarget",
                "params": {
                    "sessionId": "hermes-main-session",
                    "targetInfo": {
                        "type": "page",
                        "title": "Chrome Tab (via Relay)",
                        "url": "",
                        "attached": True,
                        "targetId": "relay-target-1",
                    },
                    "waitingForDebugger": False,
                },
            },
        }))

        # ── 消息循环：接收 CDP 命令并转发给扩展 ──
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if ext_ws and not ext_ws.closed:
                rid = msg.get("id", 0)
                params = msg.get("params", {})

                # 标准化 CDP 命令格式
                if isinstance(params, dict) and "method" in params:
                    fwd_params = params
                else:
                    fwd_params = {
                        "method": msg.get("method", ""),
                        "params": params,
                    }

                fwd = {
                    "id": rid,
                    "method": "forwardCDPCommand",
                    "params": fwd_params,
                }

                # 创建 Future 等待扩展响应
                fut = asyncio.get_event_loop().create_future()
                pending[rid] = fut

                await ext_ws.send(json.dumps(fwd))
                log.debug("[CTRL→EXT] %s", fwd_params.get("method", "?"))

                try:
                    result = await asyncio.wait_for(fut, timeout=30.0)
                    await ws.send(json.dumps(result))
                except asyncio.TimeoutError:
                    await ws.send(json.dumps({
                        "id": rid,
                        "error": {
                            "code": -32000,
                            "message": "CDP command timeout (30s)",
                        },
                    }))
                    pending.pop(rid, None)
            else:
                await ws.send(json.dumps({
                    "id": msg.get("id", 0),
                    "error": {
                        "code": -32001,
                        "message": "Chrome 扩展未连接 — 请在目标标签页点击扩展图标",
                    },
                }))

    except websockets.ConnectionClosed as e:
        log.info("[CTRL] 断开 code=%s", e.code)
    finally:
        ctrl_ws = None


# ── 路由：根据 WS 路径分发到对应 handler ────────────────────────────────

async def route_handler(ws, path: str):
    """WebSocket 路由：/extension → 扩展，/cdp → 控制器"""
    p = urlparse(path).path
    log.info("[ROUTE] %s → %s", path, p)

    if p == "/extension":
        await handle_ext(ws)
    elif p == "/cdp":
        await handle_ctrl(ws)
    else:
        log.warning("[ROUTE] 未知路径: %s", p)
        await ws.close(4004, f"unknown path: {p}")


# ── 主入口 ─────────────────────────────────────────────────────────────────

async def main():
    global PORT, TOKEN

    derived = hmac_token(TOKEN, PORT)

    log.info("=" * 60)
    log.info("🚀 Hermes Browser Relay Server")
    log.info("")
    log.info("   HTTP / CDP 发现:   http://127.0.0.1:%d/", PORT)
    log.info("   CDP 版本信息:     http://127.0.0.1:%d/json/version", PORT)
    log.info("   扩展 WS:           ws://127.0.0.1:%d/extension?token=%s...",
             PORT, derived[:16])
    log.info("   控制器 WS:         ws://127.0.0.1:%d/cdp", PORT)
    log.info("   Gateway Token:     %s", TOKEN)
    log.info("")
    log.info("使用步骤:")
    log.info("  1. Chrome → chrome://extensions → 加载解压扩展")
    log.info("     目录: ~/.openclaw/browser/chrome-extension/")
    log.info("  2. 右键扩展→选项 → Port=%d  Token=%s", PORT, TOKEN)
    log.info("  3. 打开目标页面（如 1688 分销工作台）")
    log.info("  4. 点击扩展图标 → 徽章显示 ON")
    log.info("  5. export BROWSER_CDP_URL=http://127.0.0.1:%d", PORT)
    log.info("=" * 60)

    async with serve(route_handler, "127.0.0.1", PORT, process_request=process_request):
        log.info("✅ 服务已启动，等待连接...")
        await asyncio.Future()  # 永久运行


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="Hermes Browser Relay Server — 兼容 OpenClaw Browser Relay 扩展",
    )
    ap.add_argument(
        "--port", "-p", type=int, default=DEFAULT_PORT,
        help=f"监听端口 (默认: {DEFAULT_PORT})",
    )
    ap.add_argument(
        "--token", "-t", default=DEFAULT_TOKEN,
        help=f"Gateway Token (默认: {DEFAULT_TOKEN})",
    )
    args = ap.parse_args()

    # 更新全局配置
    PORT = args.port
    TOKEN = args.token

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("\n🛑 中继服务器已停止")

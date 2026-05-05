# 聊天机器人接入指南

## 支持平台
- 飞书 (Feishu/Lark)
- 钉钉 (DingTalk)
- 微信 (WeChat iLink)

## 快速开始

### 1. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env，填入平台凭证
```

### 2. 启动机器人
```bash
# 单平台
npm run bot -- --platform feishu

# 多平台
npm run bot -- --platform feishu,dingtalk

# 测试模式（不连接）
npm run bot -- --platform feishu --dry-run
```

### 3. 平台配置

#### 飞书
1. 访问 [飞书开放平台](https://open.feishu.cn)
2. 创建企业自建应用 → 添加机器人能力
3. 获取 App ID 和 App Secret
4. 开启「使用长连接接收事件」
5. 订阅 `im.message.receive_v1` 事件

#### 钉钉
1. 访问 [钉钉开放平台](https://open.dingtalk.com)
2. 创建企业内部应用 → 添加机器人
3. 获取 Client ID 和 Client Secret
4. 开启 Stream 模式

#### 微信
1. 扫码登录获取 bot_token
2. 配置 WECHAT_BOT_TOKEN

## 使用
在对应平台内 @机器人 或直接私聊发送商品关键词：
```
纯银项链女高级感
```

## 命令
- `/help` — 显示帮助
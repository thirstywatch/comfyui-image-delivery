---
name: comfyui-send-image
description: |
  当 ComfyUI 完成 Anima 生图后，需要把原图发送到 QQ 或微信时加载。
  触发词：发图、发送原图、发到 QQ、发到微信、send image、分享图片。
  不用于生图本身（交给 comfyui-anima-master）、纯 tag 查询或 ComfyUI 运维。
---

# ComfyUI 发送原图

本 skill 负责生图完成后的图片分发：渠道检测 → 原图定位 → 发送。

## 发送规则

| 请求来源 | 行为 |
|---------|------|
| QQ 机器人发起生图 | 自动发原图到 QQ |
| 微信 / OpenClaw 发起生图 | 自动发原图到微信 |
| 本地 Claude Code 发起生图 | 不自动发。等用户说"发到 QQ/微信"再手动发送 |

## 发送工具

### ⚠️ 重要：MCP `send_media` / `notify_user` 不可用于远程渠道

`cc-openclaw-bridge` 的 MCP 工具内部使用 `spawnSync("wsl", ...)` 同步阻塞调用，WSL 冷启动 + agent session 初始化耗时会超过 bridge 的 timeout 上限，导致 `ETIMEDOUT`。

**规则**：
- **QQ / 微信远程生图**：禁止用 MCP 工具。必须直接调 `send_anima_image.js`
- **本地 CC 手动发送**：可以用 MCP 工具（用户在终端，超时可以重试）

### 方式 1：`send_anima_image.js`（唯一推荐，全渠道通用）

```powershell
Push-Location "comfyui-manager/workspace"
node send_anima_image.js --image <path> --channel qq|wechat
Pop-Location
```

| 渠道 | 底层 | WSL 依赖 |
|------|------|---------|
| `--channel qq` | NapCat WebSocket 直连 (127.0.0.1:3001) | ❌ 不需要 |
| `--channel wechat` | 写 bridge IPC 文件 + WSL 异步 fire-and-forget | ✅ 内置 WSL 健康探测 |

QQ 通道直接 WebSocket → NapCat → QQ，1-2s 完成，不经过 WSL。
微信通道写入 pending 文件后异步触发 agent，不阻塞等待返回。

### 方式 2：MCP `notify_user` / `send_media`（仅限本地 CC）

```
notify_user(
  message: "🎨 图片已生成",
  media: { path: "E:\\..." }
)
```

仅限本地 Claude Code 用户手动发送时使用。远程渠道禁止，会超时。

### 方式 3：QQ CQ 码直发（仅 QQ，cc-connect 会话中可用）

当 Claude Code 通过 cc-connect 连接到 QQ 时，可直接在回复中嵌入 CQ 码：

```
[CQ:image,file=file:///E:/AI_DRAW/ComfyUI-aki-v3/ComfyUI/output/anima/2026-06-20/image.png]
```

## 渠道检测逻辑

`send_anima_image.js --channel auto` 按以下优先级检测：

1. 命令行 `--channel` 显式指定（最高优先级）
2. 环境变量 `CC_CHANNEL`（`"qq"` 或 `"wechat"`）
3. manifest / args 中的 `_channel` 元数据
4. 都未设置 → 打印可用选项，不发送

**生图时标注渠道**（自动发送场景）：
在 ComfyUI args JSON 中加入 `_channel` 字段：
```json
{
  "prompt_11": "...",
  "_channel": "wechat"
}
```

## 生图完成后的标准流程

### QQ / 微信远程请求（自动全链路）

```
1. node run_workflow_args.js run <workflow> <args>   # 阻塞等待
2. node cache_anima_outputs.js                        # 缓存 → manifest
3. node send_anima_image.js --image <path> --channel qq|wechat  # 直接发
4. 回复用户文字摘要（无需贴图片链接，图片已自动送达）
```

⚠️ **严禁**在远程渠道使用 MCP `send_media` / `notify_user`——会 `ETIMEDOUT`。

### 本地 Claude Code 请求（手动触发）

```
1. node run_workflow_args.js submit <workflow> <args>  # 非阻塞
2. 告知用户 prompt_id 和进度
3. 用户说"发到 XX" → cache → node send_anima_image.js --image <path> --channel XX
```

## WSL 健康探测（避免盲重试）

发微信前先探测 WSL 是否通畅：
```powershell
wsl echo ok  # < 8s 返回 "ok" = 通畅，直接发
             # 超时 = 跳过触发，靠 heartbeat 兜底
```

`send_anima_image.js` 已内置此探测 + fire-and-forget 异步触发，不会因为 WSL 慢而阻塞重试。

## 补丁维护

两个缩略图修复补丁需在对应组件更新后重新执行：

| 补丁 | 脚本 | 触发时机 |
|------|------|---------|
| 微信 `hd_size` | `wsl bash /home/xixinglu/openclaw/bin/patch-weixin-hdsize.sh` | OpenClaw / 微信插件 npm update 后 |
| NapCat `picType` | `powershell -File C:\Users\Xixinglu\bin\patch-napcat-pictype.ps1` | NapCatQQ 自动更新后 |

## 排障

| 症状 | 排查 |
|------|------|
| 微信收到缩略图 | 运行 `patch-weixin-hdsize.sh` 确认补丁状态；重启 OpenClaw |
| QQ 收到压缩图 | 运行 `patch-napcat-pictype.ps1`；注意 QQ 对聊天图片有服务端压缩，无损需用文件发送 |
| `send_media` 超时 | 正常现象——WSL 慢但图片最终会到。用 `send_anima_image.js` 避免重试 |
| WSL 不通 | `wsl echo ok` 超时 → 跳过 agent 触发 → heartbeat 兜底 |
| QQ 发送失败 | 确认 NapCatQQ 正在运行；确认 OneBot WebSocket (3001) 可连 |

## 相关文件

| 文件 | 说明 |
|------|------|
| `send_anima_image.js` | 渠道感知发送脚本（comfyui-manager/workspace/） |
| `cache_anima_outputs.js` | 输出缓存 + manifest 生成 |
| `patch-weixin-hdsize.sh` | WSL 微信插件 hd_size 补丁 |
| `patch-napcat-pictype.ps1` | Windows NapCat picType 补丁 |
| cc-openclaw-bridge `src/server.ts` | MCP send_media/notify_user 实现 |

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

### 方式 1：`send_anima_image.js`（推荐，渠道感知）

```powershell
Push-Location "comfyui-manager/workspace"
node send_anima_image.js --manifest <manifest_path> --channel qq|wechat|auto
Pop-Location
```

- `--manifest`：cache_anima_outputs.js 生成的 `.manifest.json` 文件路径
- `--image`：也可以直接传图片绝对路径（跳过 manifest）
- `--channel auto`：从环境变量 `CC_CHANNEL` 或 manifest 元数据自动检测
- `--channel qq`：强制发 QQ（需 NapCat 运行中）
- `--channel wechat`：强制发微信（需 OpenClaw Gateway 运行中）
- `--caption`：可选文字说明

**输出 JSON**：
```json
{
  "status": "sent",
  "image_path": "E:\\AI_DRAW\\ComfyUI-aki-v3\\ComfyUI\\output\\anima\\2026-06-20\\...",
  "channel": "wechat",
  "triggered": true
}
```

### 方式 2：MCP `notify_user` / `send_media`（本地 CC 手动发送时）

```
notify_user(
  message: "🎨 图片已生成 | prompt_id: xxx | 1024×1536",
  media: { path: "E:\\AI_DRAW\\ComfyUI-aki-v3\\ComfyUI\\output\\anima\\..." }
)
```

**注意**：`send_media` 通过 WSL → OpenClaw → 微信发送，WSL 冷启动可能慢（~10-30s）。
如果 WSL 不通，pending 文件仍会写入，OpenClaw heartbeat 会在 ~30s 内捡起发送。

### 方式 3：QQ CQ 码直发（仅 QQ）

当 Claude Code 通过 cc-connect 连接到 QQ 时，可以直接在回复中嵌入 CQ 码：

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

```
1. ComfyUI submit/run → 拿到 prompt_id
2. 用户要求看结果时：cache_anima_outputs.js → 生成 manifest
3. 判断渠道：
   - QQ/微信请求 → node send_anima_image.js --manifest <path> --channel auto
   - 本地请求 → 展示路径，等用户指令
4. 用户说"发到 XX" → node send_anima_image.js --manifest <path> --channel XX
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

---
name: cc-bridge-media
description: |
  当 OpenClaw agent 收到来自 cc-openclaw-bridge 的 MEDIA 指令、需要向用户发送图片/文件时加载。
  不用于纯文本消息、ComfyUI 生图路由、或小红书等独立 skill 已有覆盖的场景。
---

# CC Bridge 媒体发送

本 skill 定义小雪如何处理来自 cc-bridge 的图片/文件发送请求。

## 消息格式识别

cc-bridge 通过 `openclaw agent --deliver` 传递的消息包含以下标记：

```
[CC-Bridge] <消息正文>
CAPTION:<文字说明>
MEDIA:/workspace/cc-bridge/media/<暂存文件名>
```

- `[CC-Bridge]` — 消息来源标记
- `CAPTION:` — 可选的文字说明（单行，无换行）
- `MEDIA:` — 沙箱内的暂存文件路径（bridge 已将 Windows 文件复制到 workspace）

## 处理流程

1. **识别 MEDIA 指令**：消息包含 `MEDIA:` 行时，进入媒体发送模式
2. **读取文件**：从 `MEDIA:` 指定的沙箱路径读取文件（已在 `/workspace/cc-bridge/media/` 下）
3. **发送图片**：使用 message tool，`action='send'`，设置 `media` 为沙箱路径
4. **附带文字**：如果有 `CAPTION:`，作为消息正文一起发送
5. **清理暂存**：发送成功后删除 `/workspace/cc-bridge/media/` 下的暂存文件（可选）

## 发送示例

bridge 传来的消息：
```
[CC-Bridge] ComfyUI 生图完成
MEDIA:/workspace/cc-bridge/media/1687280400000-a1b2-anima_image.png
```

小雪应该做的事：
- 使用 message tool，action='send'
- media 设为 `/workspace/cc-bridge/media/1687280400000-a1b2-anima_image.png`
- text 设为 "ComfyUI 生图完成"

## 图片质量说明

- 微信插件已打 `hd_size` 补丁——发送的图片会包含高清尺寸信息
- 微信服务器仍会对超过 16KB 的图片进行压缩，但 `hd_size` 确保客户端请求最高可用分辨率
- 不要对图片做额外压缩或格式转换——直接发送原始文件
- ComfyUI 输出的 PNG 通常 7-8 MB，微信 CDN 上传可能需要几秒

## 路径注意事项

- Docker 沙箱可访问：`/workspace/`（挂载自 `~/openclaw/workspace/`）
- Windows 文件需先 cp 到 workspace 才能在沙箱内访问
- bridge 已自动完成 Windows → WSL → workspace 的文件暂存
- 不要在沙箱内尝试访问 `/mnt/c/` 或 `/mnt/e/`（沙箱中不存在）

## 排障

| 症状 | 处理 |
|------|------|
| MEDIA 文件不存在 | 检查 bridge 暂存是否成功；确认路径在 `/workspace/cc-bridge/media/` 下 |
| 微信发送失败 | 检查 `sendImageMessageWeixin: success` 日志；确认 CDN 上传完成 |
| 图片显示为缩略图 | 确认 `hd_size` 补丁已应用：`grep hd_size send.js` |
| workspace 不可写 | 确认 Docker 沙箱挂载了 workspace（`workspaceAccess: "rw"`） |

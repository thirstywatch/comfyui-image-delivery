# ComfyUI Image Delivery

ComfyUI 生图完成后，将**原图**（PNG 全分辨率）自动/手动发送到 QQ 和微信。

## 解决的问题

ComfyUI Anima 生图后，通过 QQ 和微信发送图片时只能收到**缩略图/压缩图**，无法收到原始分辨率 PNG。本 skill 修复了两个根因 bug 并建立了渠道感知的发送机制。

## 依赖的基础设施

| 项目 | 用途 | 链接 |
|------|------|------|
| comfyui-good-anima | ComfyUI Anima 生图技能包（生图引擎） | [GitHub](https://github.com/thirstywatch/comfyui-good-anima) |
| OpenClaw Weixin Plugin | 微信通道插件（图片最终通过它发送到微信） | `@tencent-weixin/openclaw-weixin` |
| cc-connect | QQ 通道桥接（Claude Code ↔ NapCatQQ） | [GitHub](https://github.com/chenhg5/cc-connect) |
| NapCatQQ | QQ 机器人框架（OneBot v11 协议） | [GitHub](https://github.com/NapNeko/NapCatQQ) |
| cc-openclaw-bridge | Claude Code ↔ OpenClaw 双向通信桥 | [GitHub](https://github.com/totorospirit/cc-openclaw-bridge) |

## 架构

```
ComfyUI 生图完成
        │
        ▼
cache_anima_outputs.js (生图项目自带)
        │
        ▼
send_anima_image.js  ← 本仓库核心脚本
   ├─ --channel qq    → NapCat WebSocket → QQ
   └─ --channel wechat → OpenClaw Gateway → 微信
```

## 文件说明

```
comfyui-image-delivery/
├── README.md
├── send_anima_image.js          # 核心：渠道感知发送脚本
├── skill-claude-code/
│   └── SKILL.md                 # Claude Code skill：生图后发原图
├── skill-openclaw/
│   └── SKILL.md                 # OpenClaw skill：小雪处理 MEDIA 指令
└── patches/
    ├── patch-napcat-pictype.ps1  # NapCat picType 补丁（QQ 端）
    └── patch-weixin-hdsize.sh    # 微信 hd_size 补丁（微信端）
```

## 两个根因 Bug

### 微信端：OpenClaw 微信插件缺少 `hd_size`

`sendImageMessageWeixin()` 构建 `ImageItem` 时只设了 `mid_size`，未设 `hd_size`。微信客户端认为只有中等质量版本可用，以缩略图展示。

**修复**：`patches/patch-weixin-hdsize.sh` — 在 `send.js` 的 `mid_size` 旁增加 `hd_size: uploaded.fileSizeCiphertext`

### QQ 端：NapCat `picType` 映射被注释

`Q0e` 函数中 `'png'` 等图片类型映射全部被注释，ComfyUI 输出的 PNG 被错误标记为 JPEG，QQ Highway 协议处理异常后降级为缩略图。

**修复**：`patches/patch-napcat-pictype.ps1` — 解除 `'png': Wp.NEWPIC_PNG` (1001) 等映射注释

## 快速开始

### 1. 部署发送脚本

```bash
# 将 send_anima_image.js 放到 comfyui-manager/workspace/ 目录下
cp send_anima_image.js <comfyui-good-anima>/comfyui-manager/workspace/
```

### 2. 部署 Claude Code skill

```bash
# 将 skill-claude-code/ 放到 comfyui-good-anima 下，命名为 comfyui-send-image
cp -r skill-claude-code <comfyui-good-anima>/comfyui-send-image/
```

### 3. 部署 OpenClaw skill

```bash
# 复制到 OpenClaw workspace
cp skill-openclaw/SKILL.md ~/openclaw/workspace/skills/cc-bridge-media/SKILL.md
cp skill-openclaw/SKILL.md ~/openclaw/skills/stable/cc-bridge-media/SKILL.md
# 热重载
touch ~/openclaw/config/openclaw.json
```

### 4. 应用补丁

```bash
# QQ 端
powershell -File patches/patch-napcat-pictype.ps1
# 微信端（WSL 内）
bash patches/patch-weixin-hdsize.sh
# 重启对应服务
```

### 5. 设置环境变量

```powershell
# NapCat WebSocket Token（QQ 发送需要）
[System.Environment]::SetEnvironmentVariable('NAPCAT_WS_TOKEN', '<your_token>', 'User')
```

## 用法

### 命令行

```bash
# 发到 QQ
node send_anima_image.js --image <abs-path> --channel qq

# 发到微信
node send_anima_image.js --image <abs-path> --channel wechat

# 通过 manifest 自动检测渠道
node send_anima_image.js --manifest <manifest-path> --channel auto
```

### Claude Code 中

生图完成后，说"发到 QQ"或"发到微信"，Claude Code 会加载 `comfyui-send-image` skill 并执行发送。

## 发送规则

| 生图请求来源 | 行为 |
|-------------|------|
| QQ 机器人 | 自动发原图到 QQ |
| 微信 / OpenClaw | 自动发原图到微信 |
| 本地 Claude Code | 不自动发，等用户指令 |

## License

MIT

# ComfyUI Image Delivery

Automatically or manually send **original images** (full-resolution PNG) to QQ and WeChat after ComfyUI generation.

## Problem Solved

After ComfyUI Anima generates images, sending them via QQ or WeChat previously only delivered **thumbnails/compressed images** instead of the original PNG. This project fixes two root-cause bugs and provides a channel-aware delivery mechanism.

## Dependencies

| Project | Purpose | Link |
|------|------|------|
| comfyui-good-anima | ComfyUI Anima image generation skill pack | [GitHub](https://github.com/ShiroEirin/comfyui-good-anima) |
| OpenClaw Weixin Plugin | WeChat channel plugin (final image delivery to WeChat) | [npm](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) |
| OpenClaw | AI Agent Gateway (platform for WeChat channel) | [GitHub](https://github.com/openclaw/openclaw) |
| cc-connect | QQ channel bridge (Claude Code ↔ NapCatQQ) | [GitHub](https://github.com/chenhg5/cc-connect) |
| NapCatQQ | QQ bot framework (OneBot v11 protocol) | [GitHub](https://github.com/NapNeko/NapCatQQ) |
| cc-openclaw-bridge | Claude Code ↔ OpenClaw bidirectional bridge | [GitHub](https://github.com/totorospirit/cc-openclaw-bridge) |

## Architecture

```
ComfyUI generation complete
        │
        ▼
cache_anima_outputs.js (from comfyui-good-anima)
        │
        ▼
send_anima_image.js  ← core script (this repo)
   ├─ --channel qq    → NapCat WebSocket → QQ
   └─ --channel wechat → OpenClaw Gateway → WeChat
```

## Files

```
comfyui-image-delivery/
├── README.md
├── README_EN.md
├── send_anima_image.js          # Core: channel-aware delivery script
├── skill-claude-code/
│   └── SKILL.md                 # Claude Code skill: send original after generation
├── skill-openclaw/
│   └── SKILL.md                 # OpenClaw skill: handle MEDIA directives
└── patches/
    ├── patch-napcat-pictype.ps1  # NapCat picType patch (QQ side)
    └── patch-weixin-hdsize.sh    # WeChat hd_size patch (WeChat side)
```

## Two Root-Cause Bugs

### WeChat: OpenClaw Weixin Plugin missing `hd_size`

`sendImageMessageWeixin()` constructs `ImageItem` with only `mid_size`, omitting `hd_size`. The WeChat client treats it as medium-quality only, displaying a thumbnail.

**Fix**: `patches/patch-weixin-hdsize.sh` — adds `hd_size: uploaded.fileSizeCiphertext` alongside `mid_size` in `send.js`

### QQ: NapCat `picType` mappings commented out

The `Q0e` function has all image type mappings commented out except GIF. ComfyUI's PNG output is incorrectly tagged as JPEG, causing QQ's Highway protocol to mishandle the image and fall back to a thumbnail.

**Fix**: `patches/patch-napcat-pictype.ps1` — uncomments `'png': Wp.NEWPIC_PNG` (1001) and other mappings

## Quick Start

### 1. Deploy the delivery script

```bash
cp send_anima_image.js <comfyui-good-anima>/comfyui-manager/workspace/
```

### 2. Deploy Claude Code skill

```bash
cp -r skill-claude-code <comfyui-good-anima>/comfyui-send-image/
```

### 3. Deploy OpenClaw skill

```bash
cp skill-openclaw/SKILL.md ~/openclaw/workspace/skills/cc-bridge-media/SKILL.md
cp skill-openclaw/SKILL.md ~/openclaw/skills/stable/cc-bridge-media/SKILL.md
touch ~/openclaw/config/openclaw.json  # hot-reload
```

### 4. Apply patches

```bash
# QQ side
powershell -File patches/patch-napcat-pictype.ps1
# WeChat side (inside WSL)
bash patches/patch-weixin-hdsize.sh
# Restart affected services
```

### 5. Set environment variables

```powershell
# NapCat WebSocket Token (required for QQ delivery)
[System.Environment]::SetEnvironmentVariable('NAPCAT_WS_TOKEN', '<your_token>', 'User')
```

## Usage

### Command line

```bash
# Send to QQ
node send_anima_image.js --image <abs-path> --channel qq

# Send to WeChat
node send_anima_image.js --image <abs-path> --channel wechat

# Auto-detect channel from manifest
node send_anima_image.js --manifest <manifest-path> --channel auto
```

### In Claude Code

After image generation, say "send to QQ" or "send to WeChat" and Claude Code will load the `comfyui-send-image` skill and execute delivery.

## Delivery Rules

| Request Source | Behavior |
|---------------|----------|
| QQ bot | Auto-send original to QQ |
| WeChat / OpenClaw | Auto-send original to WeChat |
| Local Claude Code | Wait for explicit user command |

## License

MIT

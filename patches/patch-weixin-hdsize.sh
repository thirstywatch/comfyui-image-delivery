#!/bin/bash
# Re-apply hd_size patch after npm update overwrites the compiled JS
set -e

PLUGIN_DIRS=(
  "/home/xixinglu/openclaw/config/npm/projects/tencent-weixin-openclaw-weixin-"*
  "/home/xixinglu/.openclaw/npm/projects/tencent-weixin-openclaw-weixin-"*
)

PATCHED=0

for pattern in ""; do
  for plugin_dir in ; do
    [ -d "" ] || continue
    SEND_JS="/node_modules/@tencent-weixin/openclaw-weixin/dist/src/messaging/send.js"
    if [ ! -f "" ]; then
      continue
    fi
    if grep -q 'hd_size: uploaded.fileSizeCiphertext' "" 2>/dev/null; then
      echo "OK:  already patched"
      continue
    fi
    if grep -q 'mid_size: uploaded.fileSizeCiphertext' "" 2>/dev/null; then
      sed -i 's/mid_size: uploaded.fileSizeCiphertext,/mid_size: uploaded.fileSizeCiphertext,\n            hd_size: uploaded.fileSizeCiphertext,/' ""
      echo "PATCHED: "
      PATCHED=1
    else
      echo "SKIP:  - mid_size pattern not found"
    fi
  done
done

if [ "" -eq 1 ]; then
  echo ""
  echo "WeChat plugin patched. Restart OpenClaw to apply:"
  echo "  sudo systemctl restart openclaw"
fi

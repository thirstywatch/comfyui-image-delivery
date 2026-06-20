/**
 * send_anima_image.js — ComfyUI 生图后发送原图到 QQ / 微信
 *
 * Usage:
 *   node send_anima_image.js --manifest <path> --channel qq|wechat|auto
 *   node send_anima_image.js --image <abs-path> --channel qq|wechat [--caption <text>]
 *
 * Channel detection (--channel auto):
 *   - Checks CC_CHANNEL env var ("qq" or "wechat")
 *   - Checks manifest for _channel metadata
 *   - Falls back to printing available options
 */

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const os = require("os");

// ── Argument helpers ──────────────────────────────────────────────
function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

// ── Path utilities ────────────────────────────────────────────────
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function exists(p) {
  return fs.existsSync(p);
}

// ── Resolve image path from manifest or --image argument ──────────
function resolveImagePath() {
  const directImage = argValue("--image") || argValue("--file");
  if (directImage) {
    const resolved = path.resolve(directImage);
    if (!exists(resolved)) {
      console.error(`ERROR: image not found: ${resolved}`);
      process.exit(1);
    }
    return { imagePath: resolved, metadata: {} };
  }

  const manifestPath = argValue("--manifest");
  if (!manifestPath) {
    // Try to find the latest manifest
    const runtimeRoot = resolveRuntimeRoot();
    const cacheDir = path.join(runtimeRoot, "cache", "anima");
    if (exists(cacheDir)) {
      const dates = fs.readdirSync(cacheDir).filter(d => /\d{4}-\d{2}-\d{2}/.test(d)).sort().reverse();
      for (const date of dates) {
        const manifests = fs.readdirSync(path.join(cacheDir, date))
          .filter(f => f.endsWith(".manifest.json"))
          .map(f => path.join(cacheDir, date, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        if (manifests.length > 0) {
          const manifest = readJson(manifests[0]);
          if (manifest && manifest.source_local_path) {
            console.error(`Auto-detected manifest: ${manifests[0]}`);
            return { imagePath: manifest.source_local_path, metadata: manifest, manifestPath: manifests[0] };
          }
        }
      }
    }
    console.error("ERROR: --manifest or --image required (no auto-detectable manifests found)");
    process.exit(1);
  }

  const resolvedManifest = path.resolve(manifestPath);
  if (!exists(resolvedManifest)) {
    console.error(`ERROR: manifest not found: ${resolvedManifest}`);
    process.exit(1);
  }

  const manifest = readJson(resolvedManifest);
  if (!manifest) {
    console.error(`ERROR: failed to parse manifest: ${resolvedManifest}`);
    process.exit(1);
  }

  const imagePath = manifest.source_local_path || manifest.cache_local_path;
  if (!imagePath) {
    console.error("ERROR: manifest has no source_local_path or cache_local_path");
    process.exit(1);
  }

  if (!exists(imagePath)) {
    console.error(`ERROR: image file not found: ${imagePath}`);
    process.exit(1);
  }

  return { imagePath, metadata: manifest, manifestPath: resolvedManifest };
}

function resolveRuntimeRoot() {
  const workspace = __dirname;
  return path.resolve(workspace, "..", "..", "runtime", "comfyui-manager");
}

// ── Channel detection ─────────────────────────────────────────────
function detectChannel(metadata) {
  const explicit = argValue("--channel", "auto");
  if (explicit !== "auto") return explicit;

  // Check env var
  if (process.env.CC_CHANNEL === "qq") return "qq";
  if (process.env.CC_CHANNEL === "wechat") return "wechat";

  // Check manifest metadata
  if (metadata._channel) return metadata._channel;
  if (metadata.channel) return metadata.channel;

  return null;
}

// ── WSL path helpers ─────────────────────────────────────────────
function windowsToWslPath(winPath) {
  // E:\AI_DRAW\... → /mnt/e/AI_DRAW/...
  return "/mnt/" + winPath.replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase());
}

// ── WSL health check ─────────────────────────────────────────────
function wslHealthy(timeoutMs = 8000) {
  try {
    const result = spawnSync("wsl", ["echo", "ok"], {
      timeout: timeoutMs,
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 && result.stdout.includes("ok");
  } catch {
    return false;
  }
}

// ── Stage file to WSL workspace (Docker sandbox accessible) ──────
function stageToWslWorkspace(imagePath) {
  const filename = path.basename(imagePath);
  const wslMediaDir = "/home/xixinglu/openclaw/workspace/cc-bridge/media";
  const wslStagedPath = `${wslMediaDir}/${Date.now()}-${filename}`;
  const sandboxPath = `/workspace/cc-bridge/media/${path.basename(wslStagedPath)}`;

  try {
    spawnSync("wsl", [
      "bash", "-c",
      `mkdir -p ${wslMediaDir} && cp "${windowsToWslPath(imagePath)}" "${wslStagedPath}"`
    ], { timeout: 30000, encoding: "utf8", windowsHide: true });
    console.error(`[wechat] Staged to WSL: ${wslStagedPath}`);
    return sandboxPath;
  } catch (err) {
    console.error(`[wechat] Failed to stage file to WSL: ${err.message}`);
    return null;
  }
}

// ── Send to WeChat via cc-openclaw-bridge IPC ─────────────────────
function sendToWeChat(imagePath, caption) {
  // Docker 沙箱无法访问 Windows 路径，必须先暂存到 WSL workspace
  const sandboxPath = stageToWslWorkspace(imagePath);
  if (!sandboxPath) {
    return {
      channel: "wechat",
      status: "error",
      error: "Failed to stage image to WSL workspace",
    };
  }

  const bridgeIpcDir = path.join(os.homedir(), ".cc-openclaw-bridge");
  mkdirp(bridgeIpcDir);

  const id = `anima-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pending = {
    id,
    type: "notify",
    message: caption || "ComfyUI 生图完成",
    media: sandboxPath,  // Docker 沙箱可访问的路径
    caption: caption || "",
    project: "comfyui",
    context: "ComfyUI 生图完成",
    ts: new Date().toISOString(),
  };

  const pendingFile = path.join(bridgeIpcDir, `${id}.json`);
  fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2), "utf8");
  console.error(`[wechat] Pending file: ${pendingFile}`);
  console.error(`[wechat] Sandbox path: ${sandboxPath}`);
  console.error(`[wechat] Original: ${imagePath}`);

  // Probe WSL health before attempting agent trigger
  if (!wslHealthy()) {
    console.error("[wechat] WSL not responding — skipped agent trigger");
    console.error("[wechat] Image will be sent on next heartbeat polling (~30s)");
    return {
      channel: "wechat",
      pending_id: id,
      pending_file: pendingFile,
      sandbox_path: sandboxPath,
      triggered: false,
      note: "WSL unreachable. Image staged to workspace, will be picked up by heartbeat.",
    };
  }

  // Fire-and-forget: async spawn so we don't block on slow WSL
  try {
    const agentMsg = `[CC-Bridge] ComfyUI 图片已生成，请发送给用户\nMEDIA:${sandboxPath}`;
    const child = spawn("wsl", [
      "bash", "-lc",
      `OPENCLAW_CONFIG_PATH=/home/xixinglu/openclaw/openclaw.json ` +
      `OPENCLAW_STATE_DIR=/home/xixinglu/openclaw/config ` +
      `/home/xixinglu/openclaw/node_modules/.bin/openclaw agent ` +
      `--session-key agent:main:main ` +
      `--message "${agentMsg}" ` +
      `--deliver --timeout 30`
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    console.error(`[wechat] Agent triggered (async, pid=${child.pid})`);
  } catch (err) {
    console.error(`[wechat] Agent trigger error (will retry on heartbeat): ${err.message}`);
  }

  return {
    channel: "wechat",
    pending_id: id,
    pending_file: pendingFile,
    sandbox_path: sandboxPath,
    triggered: true,
    note: "File staged to WSL workspace, agent triggered asynchronously.",
  };
}

// ── Send to QQ via NapCat WebSocket ───────────────────────────────
function sendToQQ(imagePath, caption) {
  const napcatToken = process.env.NAPCAT_WS_TOKEN || "";
  const napcatWsUrl = napcatToken
    ? `ws://127.0.0.1:3001?access_token=${napcatToken}`
    : "ws://127.0.0.1:3001";

  // Convert Windows path to file:// URI
  const fileUri = "file:///" + imagePath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:");

  const cqCode = caption
    ? `${caption}\n[CQ:image,file=${fileUri}]`
    : `[CQ:image,file=${fileUri}]`;

  console.error(`[qq] CQ code: ${cqCode}`);
  console.error(`[qq] Image: ${imagePath}`);

  // Determine target from env or args
  const targetType = argValue("--qq-type", process.env.CC_QQ_TYPE || "private");
  const targetId = argValue("--qq-target", process.env.CC_QQ_TARGET || "3280611976");

  const messagePayload = {
    action: targetType === "group" ? "send_group_msg" : "send_private_msg",
    params: {
      message: cqCode,
      auto_escape: false,
    },
  };

  if (targetType === "group") {
    messagePayload.params.group_id = parseInt(targetId) || undefined;
  } else {
    messagePayload.params.user_id = parseInt(targetId) || 3280611976;
  }

  // Use ws library from NapCat (browser WebSocket doesn't support .on())
  let WebSocketLib;
  try {
    const napcatMod = 'C:/Users/Xixinglu/AppData/Local/NapCat/node_modules/ws';
    WebSocketLib = require(napcatMod).WebSocket || require(napcatMod);
  } catch {
    try {
      WebSocketLib = require('ws');
    } catch {
      return fallbackRelayFile(imagePath, caption);
    }
  }

  const ws = new WebSocketLib(napcatWsUrl);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, 20000);

    ws.on("open", () => {
      const payload = JSON.stringify(messagePayload);
      ws.send(payload);
      console.error("[qq] Sent via NapCat WebSocket");
    });

    ws.on("message", (data) => {
      try {
        const resp = JSON.parse(data.toString());
        // Skip lifecycle meta events and notices, wait for actual response
        if (resp.meta_event_type || resp.post_type === "meta_event" || resp.post_type === "notice") return;
        clearTimeout(timeout);
        console.error(`[qq] Response: ${JSON.stringify(resp)}`);
        if (resp.status === "ok" || resp.retcode === 0) {
          resolve({ channel: "qq", status: "sent", message_id: resp.data?.message_id || "" });
        } else {
          resolve({ channel: "qq", status: "error", error: resp.msg || resp.wording || "unknown" });
        }
        ws.close();
      } catch {
        clearTimeout(timeout);
        resolve({ channel: "qq", status: "sent", raw_response: data.toString() });
        ws.close();
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      console.error(`[qq] WebSocket error: ${err.message}`);
      resolve(fallbackRelayFile(imagePath, caption));
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

// ── Fallback: write relay file for manual/background sending ──────
function fallbackRelayFile(imagePath, caption) {
  const relayDir = path.join(os.homedir(), ".cc-openclaw-bridge", "qq-relay");
  mkdirp(relayDir);

  const fileUri = "file:///" + imagePath.replace(/\\/g, "/");
  const relayFile = path.join(relayDir, `qq-send-${Date.now()}.json`);
  const relay = {
    cq_code: `[CQ:image,file=${fileUri}]`,
    image_path: imagePath,
    caption: caption || "",
    ts: new Date().toISOString(),
    instruction: "Send this CQ code via cc-connect / NapCat to deliver the image to QQ",
  };
  fs.writeFileSync(relayFile, JSON.stringify(relay, null, 2), "utf8");

  console.error(`[qq] Relay file written (fallback): ${relayFile}`);
  console.error(`[qq] To send manually, run relay.cjs or have cc-connect pick up this file`);

  return {
    channel: "qq",
    status: "relay_file_created",
    relay_file: relayFile,
    cq_code: relay.cq_code,
    note: "WebSocket send unavailable. Relay file created for manual/background sending.",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(`
Usage: node send_anima_image.js [options]

Options:
  --manifest <path>    Path to manifest JSON (from cache_anima_outputs.js)
  --image <path>       Direct path to image file
  --channel qq|wechat|auto   Target channel (default: auto)
  --caption <text>     Optional text caption
  --qq-type private|group    QQ target type (default: private)
  --qq-target <id>     QQ target user_id or group_id
  --help, -h           Show this help
`);
    process.exit(0);
  }

  const { imagePath, metadata, manifestPath } = resolveImagePath();
  const caption = argValue("--caption") || metadata._caption || "";
  const channel = detectChannel(metadata);

  console.error(`=== send_anima_image ===`);
  console.error(`Image: ${imagePath}`);
  console.error(`Size: ${(fs.statSync(imagePath).size / 1024 / 1024).toFixed(1)} MB`);
  console.error(`Channel: ${channel || "undetected"}`);

  if (!channel) {
    // No channel detected — print instructions for the agent/user
    const result = {
      status: "ready",
      image_path: imagePath,
      image_size_bytes: fs.statSync(imagePath).size,
      manifest_path: manifestPath || "",
      available_channels: ["qq", "wechat"],
      message: "Image ready. Specify --channel qq or --channel wechat to send, or use the MCP tools directly.",
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  let result;
  if (channel === "wechat") {
    result = sendToWeChat(imagePath, caption);
  } else if (channel === "qq") {
    result = await sendToQQ(imagePath, caption);
  } else {
    console.error(`ERROR: unknown channel: ${channel}`);
    process.exit(1);
  }

  const output = {
    status: "sent",
    image_path: imagePath,
    image_size_bytes: fs.statSync(imagePath).size,
    channel,
    ...result,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});

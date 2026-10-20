import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { openStockfish } from "./engine.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const exe = path.join(root, "engine", "stockfish.exe");

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) return;
  fs.copyFileSync(from, to);
}

function copyAssets() {
  const ort = path.join(root, "node_modules", "onnxruntime-web", "dist");
  for (const name of [
    "ort.wasm.bundle.min.mjs",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ]) {
    copyFile(path.join(ort, name), path.join(publicDir, "ort", name));
  }
  copyFile(
    path.join(root, "node_modules", "@scoriiu", "fenshot", "model", "chess-tiles-v2.onnx"),
    path.join(publicDir, "models", "chess-tiles-v2.onnx"),
  );
  const fonts = path.join(root, "node_modules", "@fontsource");
  const faces = [
    ["fraunces", "fraunces-latin-500-normal.woff2"],
    ["fraunces", "fraunces-latin-600-normal.woff2"],
    ["fraunces", "fraunces-latin-700-normal.woff2"],
    ["barlow", "barlow-latin-400-normal.woff2"],
    ["barlow", "barlow-latin-500-normal.woff2"],
    ["barlow", "barlow-latin-600-normal.woff2"],
    ["ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"],
    ["ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2"],
  ];
  for (const [family, file] of faces) {
    copyFile(path.join(fonts, family, "files", file), path.join(publicDir, "fonts", file));
  }
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

copyAssets();

const engine = openStockfish(exe);
let engineName = null;
let engineError = null;
const engineReady = engine.ready
  .then((info) => {
    engineName = info.name;
    console.log(`${info.name} · ${info.threads} threads`);
    return info;
  })
  .catch((err) => {
    engineError = err;
    console.error(err.message);
    return null;
  });

engine.on("exit", ({ code }) => {
  if (code != null) console.error(`Stockfish exited (${code})`);
});

const app = express();
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});
app.get("/health", (_req, res) => {
  res.json({ ok: !engineError, engine: engineName, error: engineError?.message ?? null });
});
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".mjs")) res.setHeader("Content-Type", "text/javascript");
    if (filePath.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
  },
}));

const server = http.createServer(app);
const sockets = new WebSocketServer({ server, path: "/engine" });

sockets.on("connection", (socket) => {
  const send = (payload) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  };
  const onInfo = (msg) => send({ type: "info", ...msg });
  const onBest = (msg) => send({ type: "bestmove", ...msg });
  const onExit = () => send({ type: "error", message: "Stockfish stopped." });
  engine.on("info", onInfo);
  engine.on("bestmove", onBest);
  engine.on("exit", onExit);
  engineReady.then((info) => {
    if (info) send({ type: "ready", name: info.name });
    else if (engineError) send({ type: "error", message: engineError.message });
  });
  socket.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg?.type === "analyze" && typeof msg.fen === "string") {
      engine.analyze(msg.fen, {
        depth: clamp(msg.depth, 1, 40, 16),
        multipv: clamp(msg.multipv, 1, 5, 3),
      });
    } else if (msg?.type === "stop") {
      engine.stop();
    }
  });
  socket.on("close", () => {
    engine.off("info", onInfo);
    engine.off("bestmove", onBest);
    engine.off("exit", onExit);
  });
});

const port = Number(process.env.PORT) || 4173;
server.listen(port, "0.0.0.0", () => {
  console.log(`screenChess is at http://localhost:${port}`);
  if (!fs.existsSync(path.join(publicDir, "app.js"))) {
    console.warn("public/app.js is missing. Start screenChess with npm start so the page script is built.");
  }
});

function shutdown() {
  engine.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

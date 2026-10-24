import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { copyWebAssets } from "./assets.mjs";
import { openStockfish } from "./engine.mjs";
import { embeddedAppRoot } from "./payload.mjs";

const extracted = embeddedAppRoot();
const root = extracted ?? path.dirname(fileURLToPath(import.meta.url));
const packaged = extracted != null;
const publicDir = path.join(root, "public");
const exe = path.join(root, "engine", "stockfish.exe");

if (fs.existsSync(path.join(root, "node_modules", "onnxruntime-web"))) {
  copyWebAssets(root);
}

function openBrowser(url) {
  if (process.platform !== "win32" || process.env.SCREENCHESS_NO_BROWSER === "1") return;
  const child = spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

let engine = null;
let engineName = null;
let engineError = null;
let shuttingDown = false;
let lastFen = null;
let lastDepth = 16;
let lastMultipv = 3;
const fans = { info: new Set(), bestmove: new Set(), ready: new Set() };

function attachEngine(next) {
  engine = next;
  next.ready
    .then((info) => {
      engineName = info.name;
      engineError = null;
      console.log(`${info.name} · ${info.threads} threads`);
      for (const notify of fans.ready) notify(info);
      if (lastFen) next.analyze(lastFen, { depth: lastDepth, multipv: lastMultipv });
      return info;
    })
    .catch((err) => {
      engineError = err;
      console.error(err.message);
      return null;
    });
  next.on("info", (msg) => {
    for (const notify of fans.info) notify(msg);
  });
  next.on("bestmove", (msg) => {
    for (const notify of fans.bestmove) notify(msg);
  });
  next.on("exit", ({ code }) => {
    if (shuttingDown) return;
    console.error(`Stockfish exited (${code}). Starting it again.`);
    attachEngine(openStockfish(exe));
  });
}

attachEngine(openStockfish(exe));

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
  const onReady = (info) => send({ type: "ready", name: info.name });
  fans.info.add(onInfo);
  fans.bestmove.add(onBest);
  fans.ready.add(onReady);
  if (engineName) onReady({ name: engineName });
  else if (engineError) send({ type: "error", message: engineError.message });
  socket.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg?.type === "analyze" && typeof msg.fen === "string") {
      lastFen = msg.fen;
      lastDepth = clamp(msg.depth, 1, 40, 16);
      lastMultipv = clamp(msg.multipv, 1, 5, 3);
      engine.analyze(msg.fen, { depth: lastDepth, multipv: lastMultipv });
    } else if (msg?.type === "stop") {
      lastFen = null;
      engine.stop();
    }
  });
  socket.on("close", () => {
    fans.info.delete(onInfo);
    fans.bestmove.delete(onBest);
    fans.ready.delete(onReady);
  });
});

const portFromEnv = process.env.PORT;
let port = Number(portFromEnv) || 4173;
const firstPort = port;

function announce() {
  const url = `http://localhost:${port}`;
  if (packaged) {
    process.title = "screenChess";
    console.log("");
    console.log("screenChess");
    console.log("Practice only. Cheating in a real game is not condoned.");
    console.log("Stockfish does the chess. It is included under the GNU GPL.");
    console.log("Source: https://github.com/official-stockfish/Stockfish");
    console.log(`License: ${path.join(root, "STOCKFISH-COPYING.txt")}`);
    console.log("");
    console.log("Leave this window open. Close it to quit.");
    console.log(url);
    openBrowser(url);
    return;
  }
  console.log(`screenChess is at ${url}`);
  if (!fs.existsSync(path.join(publicDir, "app.js"))) {
    console.warn("public/app.js is missing. Start screenChess with npm start so the page script is built.");
  }
}

server.on("error", (err) => {
  if (packaged && !portFromEnv && err.code === "EADDRINUSE" && port < firstPort + 20) {
    port += 1;
    server.listen(port, "0.0.0.0");
    return;
  }
  console.error(err.message);
  process.exit(1);
});

server.listen(port, "0.0.0.0", announce);

function shutdown() {
  shuttingDown = true;
  engine.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

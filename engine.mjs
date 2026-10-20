import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function parseInfoLine(line) {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;
  if (line.includes(" lowerbound") || line.includes(" upperbound")) return null;
  const depth = /(?:^|\s)depth (\d+)/.exec(line);
  const multipv = /(?:^|\s)multipv (\d+)/.exec(line);
  const cp = /(?:^|\s)score cp (-?\d+)/.exec(line);
  const mate = /(?:^|\s)score mate (-?\d+)/.exec(line);
  const nps = /(?:^|\s)nps (\d+)/.exec(line);
  const pvIndex = line.indexOf(" pv ");
  if (pvIndex < 0 || (!cp && !mate)) return null;
  const pv = line
    .slice(pvIndex + 4)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!pv.length) return null;
  return {
    depth: depth ? Number(depth[1]) : 0,
    multipv: multipv ? Number(multipv[1]) : 1,
    cp: cp ? Number(cp[1]) : null,
    mate: mate ? Number(mate[1]) : null,
    nps: nps ? Number(nps[1]) : 0,
    pv,
  };
}

export function openStockfish(exePath) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Stockfish was not found at ${exePath}`);
  }

  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const threads = Math.max(1, Math.min(8, cores - 2));
  const listeners = new Map();
  let name = "Stockfish";
  let phase = "boot";
  let booted = false;
  let sawUciok = false;
  let desired = null;
  let active = null;
  let appliedMultipv = 3;
  let buffer = "";

  const proc = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  function on(type, cb) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb);
    return () => listeners.get(type)?.delete(cb);
  }

  function off(type, cb) {
    listeners.get(type)?.delete(cb);
  }

  function emit(type, payload) {
    for (const cb of listeners.get(type) ?? []) cb(payload);
  }

  function send(command) {
    if (phase === "dead") return;
    proc.stdin.write(`${command}\n`);
  }

  let readySettled = false;
  const ready = new Promise((resolve, reject) => {
    const finish = (err, info) => {
      if (readySettled) return;
      readySettled = true;
      if (err) reject(err);
      else resolve(info);
    };
    proc.once("error", (err) => finish(err));
    const stop = on("ready", (info) => {
      stop();
      finish(null, info);
    });
    proc.once("exit", (code) => {
      if (!booted) finish(new Error(`Stockfish exited before it was ready (${code})`));
    });
  });

  function begin() {
    if (!booted || !desired || phase === "dead") return;
    if (appliedMultipv !== desired.multipv) {
      appliedMultipv = desired.multipv;
      phase = "waitready";
      send(`setoption name MultiPV value ${desired.multipv}`);
      send("isready");
      return;
    }
    phase = "search";
    active = {
      fen: desired.fen,
      depth: desired.depth,
      multipv: desired.multipv,
    };
    send(`position fen ${active.fen}`);
    send(`go depth ${active.depth}`);
  }

  function onReadyOk() {
    if (!booted) {
      booted = true;
      phase = "idle";
      emit("ready", { name, threads });
      if (desired) begin();
      return;
    }
    if (phase === "waitready") {
      phase = "idle";
      if (desired) begin();
    }
  }

  function onBestmove(move) {
    if (phase === "dead") return;
    const finished = active;
    active = null;
    phase = "idle";
    if (finished) emit("bestmove", { fen: finished.fen, move });
    const stale =
      desired &&
      (!finished ||
        desired.fen !== finished.fen ||
        desired.depth !== finished.depth ||
        desired.multipv !== finished.multipv);
    if (stale) {
      begin();
      return;
    }
    desired = null;
  }

  function handleLine(line) {
    if (!line || phase === "dead") return;
    if (line.startsWith("id name ")) {
      name = line.slice("id name ".length).trim();
      return;
    }
    if (line === "uciok") {
      if (sawUciok) return;
      sawUciok = true;
      send(`setoption name Threads value ${threads}`);
      send("setoption name Hash value 128");
      send(`setoption name MultiPV value ${appliedMultipv}`);
      send("setoption name UCI_AnalyseMode value true");
      send("isready");
      return;
    }
    if (line === "readyok") {
      onReadyOk();
      return;
    }
    if (line.startsWith("bestmove ")) {
      const token = line.split(/\s+/)[1];
      onBestmove(token && token !== "(none)" ? token : null);
      return;
    }
    const info = parseInfoLine(line);
    if (info && active) emit("info", { ...info, fen: active.fen });
  }

  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      handleLine(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error("[stockfish]", text);
  });

  proc.on("exit", (code) => {
    if (phase === "dead") return;
    phase = "dead";
    emit("exit", { code });
  });

  proc.stdin.on("error", () => {});
  send("uci");

  return {
    ready,
    on,
    off,
    analyze(fen, options = {}) {
      const depth = Number.isFinite(options.depth) ? options.depth : 16;
      const multipv = Number.isFinite(options.multipv) ? options.multipv : 3;
      if (phase === "dead") return;
      if (
        active &&
        phase === "search" &&
        active.fen === fen &&
        active.depth === depth &&
        active.multipv === multipv
      ) {
        return;
      }
      desired = { fen, depth, multipv };
      if (!booted || phase === "stopping" || phase === "waitready" || phase === "boot") return;
      if (phase === "search") {
        phase = "stopping";
        send("stop");
        return;
      }
      begin();
    },
    stop() {
      desired = null;
      if (phase === "search") {
        phase = "stopping";
        send("stop");
      }
    },
    close() {
      desired = null;
      phase = "dead";
      proc.stdin.end();
      proc.kill();
    },
  };
}

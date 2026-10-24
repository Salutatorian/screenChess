import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { copyWebAssets } from "../assets.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.join(root, "build");
const payloadDir = path.join(buildDir, "payload");
const distDir = path.join(root, "dist");
const exePath = path.join(distDir, "screenChess.exe");
const MAGIC = Buffer.from("SCHESS01", "ascii");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function copyLicense(dest) {
  const zip = process.env.STOCKFISH_ZIP
    || path.join(process.env.USERPROFILE || "", "Downloads", "stockfish-windows-x86-64-universal.zip");
  if (!fs.existsSync(zip)) {
    throw new Error(`Stockfish's license zip was not found at ${zip}`);
  }
  const outDir = path.join(buildDir, "license");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  run("tar", ["-xf", zip, "-C", outDir, "stockfish/Copying.txt"]);
  fs.copyFileSync(path.join(outDir, "stockfish", "Copying.txt"), dest);
}

function appendPayload(target, zipPath) {
  const offset = BigInt(fs.statSync(target).size);
  const zip = fs.readFileSync(zipPath);
  const tail = Buffer.alloc(16);
  tail.writeBigUInt64LE(offset, 0);
  MAGIC.copy(tail, 8);
  const fd = fs.openSync(target, "a");
  try {
    fs.writeSync(fd, zip);
    fs.writeSync(fd, tail);
  } finally {
    fs.closeSync(fd);
  }
}

async function smoke(exe) {
  const child = spawn(exe, [], {
    env: { ...process.env, SCREENCHESS_NO_BROWSER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  let log = "";
  const collect = (chunk) => {
    const text = chunk.toString();
    log += text;
    process.stdout.write(text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const started = Date.now();
  let url = "";
  try {
    while (Date.now() - started < 120000) {
      const match = log.match(/http:\/\/localhost:\d+/);
      if (match) {
        url = match[0];
        const response = await fetch(`${url}/health`).catch(() => null);
        if (response?.ok) {
          const body = await response.json();
          if (body.engine) {
            if (!String(body.engine).includes("Stockfish")) {
              throw new Error(`Unexpected engine: ${body.engine}`);
            }
            console.log(`Verified ${body.engine} at ${url}`);
            return;
          }
        }
      }
      if (child.exitCode != null) throw new Error("screenChess.exe quit before it was ready");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("screenChess.exe did not become ready");
  } finally {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

const stockfish = path.join(root, "engine", "stockfish.exe");
if (!fs.existsSync(stockfish)) {
  throw new Error("engine/stockfish.exe is missing. Put the official Stockfish program there first.");
}

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(payloadDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["client/main.js"],
  bundle: true,
  outfile: "public/app.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["onnxruntime-web/wasm"],
  logLevel: "info",
});
copyWebAssets(root);
fs.cpSync(path.join(root, "public"), path.join(payloadDir, "public"), { recursive: true });
fs.mkdirSync(path.join(payloadDir, "engine"), { recursive: true });
fs.copyFileSync(stockfish, path.join(payloadDir, "engine", "stockfish.exe"));
copyLicense(path.join(payloadDir, "STOCKFISH-COPYING.txt"));

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["server.mjs"],
  bundle: true,
  outfile: path.join(buildDir, "server.cjs"),
  format: "cjs",
  platform: "node",
  target: "node20",
  logLevel: "info",
});

const seaConfig = path.join(buildDir, "sea-config.json");
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(buildDir, "server.cjs"),
  output: path.join(buildDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
}, null, 2));
run(process.execPath, ["--experimental-sea-config", seaConfig]);

if (fs.existsSync(exePath)) fs.rmSync(exePath);
fs.copyFileSync(process.execPath, exePath);
run(process.execPath, [
  path.join(root, "node_modules", "postject", "dist", "cli.js"),
  exePath,
  "NODE_SEA_BLOB",
  path.join(buildDir, "sea-prep.blob"),
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
]);

const zipPath = path.join(buildDir, "payload.zip");
run("tar", ["-a", "-c", "-f", zipPath, "-C", payloadDir, "public", "engine", "STOCKFISH-COPYING.txt"]);
appendPayload(exePath, zipPath);

const mb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`Built ${exePath} (${mb} MB)`);
await smoke(exePath);
console.log("screenChess.exe is ready.");

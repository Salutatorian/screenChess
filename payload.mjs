import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAGIC = Buffer.from("SCHESS01", "ascii");

export function embeddedAppRoot() {
  let fd;
  try {
    fd = fs.openSync(process.execPath, "r");
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 24) return null;
    const tail = Buffer.alloc(16);
    fs.readSync(fd, tail, 0, 16, size - 16);
    if (!tail.subarray(8).equals(MAGIC)) return null;
    const zipStart = Number(tail.readBigUInt64LE(0));
    const zipEnd = size - 16;
    if (!Number.isSafeInteger(zipStart) || zipStart < 1 || zipStart >= zipEnd) return null;
    const stamp = `${size}-${zipStart}`;
    const base = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "screenChess");
    const dest = path.join(base, stamp);
    if (fs.existsSync(path.join(dest, ".ready"))) return dest;

    console.log("Preparing screenChess for the first launch. This can take a minute.");
    const zip = Buffer.alloc(zipEnd - zipStart);
    fs.readSync(fd, zip, 0, zip.length, zipStart);
    fs.closeSync(fd);
    fd = undefined;
    if (zip[0] !== 0x50 || zip[1] !== 0x4b) {
      throw new Error("The screenChess package is damaged.");
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const zipPath = path.join(base, "payload.zip");
    fs.writeFileSync(zipPath, zip);
    const unpacked = spawnSync("tar", ["-xf", zipPath, "-C", dest], { stdio: "inherit" });
    fs.rmSync(zipPath, { force: true });
    if (unpacked.status !== 0) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error("Could not unpack screenChess.");
    }
    fs.writeFileSync(path.join(dest, ".ready"), "ok");
    for (const entry of fs.readdirSync(base)) {
      if (entry !== stamp) fs.rmSync(path.join(base, entry), { recursive: true, force: true });
    }
    return dest;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

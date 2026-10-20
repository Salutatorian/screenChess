import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { openStockfish, parseInfoLine } from "../engine.mjs";

const exe = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "engine", "stockfish.exe");
const MATE = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";

test("parses UCI info lines", () => {
  const info = parseInfoLine(
    "info depth 12 seldepth 14 multipv 2 score cp -35 nodes 100 nps 2000 pv e7e5 g1f3",
  );
  assert.equal(info.depth, 12);
  assert.equal(info.multipv, 2);
  assert.equal(info.cp, -35);
  assert.equal(info.mate, null);
  assert.equal(info.nps, 2000);
  assert.deepEqual(info.pv, ["e7e5", "g1f3"]);

  const mate = parseInfoLine("info depth 4 score mate 1 pv a1a8");
  assert.equal(mate.mate, 1);
  assert.deepEqual(mate.pv, ["a1a8"]);
  assert.equal(parseInfoLine("info depth 3 score cp 10 lowerbound pv e2e4"), null);
});

test("Stockfish finds mate in one", { timeout: 60_000 }, async () => {
  const engine = openStockfish(exe);
  try {
    const ready = await engine.ready;
    assert.match(ready.name, /Stockfish/);
    const best = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Stockfish timed out")), 45_000);
      engine.on("bestmove", (msg) => {
        if (msg.fen !== MATE) return;
        clearTimeout(timer);
        resolve(msg);
      });
    });
    engine.analyze(MATE, { depth: 6, multipv: 1 });
    const msg = await best;
    assert.equal(msg.move, "a1a8");
  } finally {
    engine.close();
  }
});

import { Chess } from "chess.js";
import test from "node:test";
import assert from "node:assert/strict";
import { bottomToMove, fenForUser, recommendationForUser, reducePosition, positionFromPlacement } from "../position.mjs";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

test("tracks a legal move and keeps castling history", () => {
  let state = reducePosition(null, START, "w");
  assert.equal(state.fen, `${START} w KQkq - 0 1`);
  assert.equal(state.jumped, false);

  const chess = new Chess(state.fen);
  for (const san of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "O-O"]) {
    chess.move(san);
    state = reducePosition(state, chess.fen().split(" ")[0], "w");
    assert.equal(state.fen, chess.fen());
    assert.equal(state.lastMove.san, san);
    assert.equal(state.jumped, false);
    assert.equal(state.changed, true);
  }
  assert.equal(state.turn, "b");
  assert.equal(state.fen.includes(" KQkq "), false);
  assert.match(state.fen, / kq /);
});

test("keeps the same position still", () => {
  const state = reducePosition(null, START, "w");
  const again = reducePosition(state, START, "w");
  assert.equal(again.changed, false);
  assert.equal(again.fen, state.fen);
});

test("marks a position jump when the frame skips ahead", () => {
  const state = reducePosition(null, START, "w");
  const middlegame = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R";
  const next = reducePosition(state, middlegame, "w");
  assert.equal(next.jumped, true);
  assert.equal(next.lastMove, null);
  assert.equal(next.turn, "w");
});

test("recommends only for the side at the bottom", () => {
  assert.equal(bottomToMove("w", "white"), true);
  assert.equal(bottomToMove("b", "white"), false);
  assert.equal(bottomToMove("b", "black"), true);
  assert.equal(bottomToMove("w", "black"), false);
});

test("arrow is the bottom player's move", () => {
  const start = `${START} w KQkq - 0 1`;
  const whiteBottom = recommendationForUser(start, ["e2e4", "e7e5", "g1f3"], "white");
  assert.equal(whiteBottom.uci, "e2e4");
  assert.equal(whiteBottom.san, "e4");

  const blackToMove = start.replace(" w ", " b ");
  const stillWhite = recommendationForUser(blackToMove, ["e7e5", "e2e4"], "white");
  assert.equal(stillWhite.uci, "e2e4");
  assert.equal(recommendationForUser(blackToMove, ["e7e5", "g1f3"], "black").uci, "e7e5");

  const asBlack = fenForUser(start, "black");
  assert.equal(asBlack.split(" ")[1], "b");
  assert.equal(fenForUser(start, "white"), start);
});

test("picks the only legal side to move", () => {
  const placement = "k3r3/8/8/8/8/8/8/4K3";
  const state = reducePosition(null, placement, "b");
  assert.equal(state.turn, "w");
  assert.equal(positionFromPlacement(placement, "b").error, "illegal");
});

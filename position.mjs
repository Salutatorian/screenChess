import { Chess } from "chess.js";

function expand(placement) {
  const rows = placement.split("/");
  if (rows.length !== 8) return null;
  const board = [];
  for (const row of rows) {
    const rank = [];
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < Number(ch); i += 1) rank.push("");
      } else {
        rank.push(ch);
      }
    }
    if (rank.length !== 8) return null;
    board.push(rank);
  }
  return board;
}

export function inferCastling(placement) {
  const board = expand(placement);
  if (!board) return "-";
  let rights = "";
  if (board[7][4] === "K") {
    if (board[7][7] === "R") rights += "K";
    if (board[7][0] === "R") rights += "Q";
  }
  if (board[0][4] === "k") {
    if (board[0][7] === "r") rights += "k";
    if (board[0][0] === "r") rights += "q";
  }
  return rights || "-";
}

export function placementToFen(placement, turn) {
  return `${placement} ${turn} ${inferCastling(placement)} - 0 1`;
}

function kingSquare(game, color) {
  const piece = color === "w" ? "K" : "k";
  const rows = game.fen().split(" ")[0].split("/");
  for (let rank = 0; rank < rows.length; rank += 1) {
    let file = 0;
    for (const ch of rows[rank]) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      if (ch === piece) return `${"abcdefgh"[file]}${8 - rank}`;
      file += 1;
    }
  }
  return null;
}

function tryGame(placement, turn) {
  let game;
  try {
    game = new Chess(placementToFen(placement, turn));
  } catch {
    return null;
  }
  const opponent = turn === "w" ? "b" : "w";
  const ownKing = kingSquare(game, turn);
  const otherKing = kingSquare(game, opponent);
  if (!ownKing || !otherKing || game.isAttacked(otherKing, turn)) return null;
  return game;
}

function transition(fen, placement) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  for (const move of chess.moves({ verbose: true })) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (chess.fen().split(" ")[0] === placement) {
      return {
        fen: chess.fen(),
        placement,
        turn: chess.turn(),
        lastMove: { from: move.from, to: move.to, san: move.san },
        jumped: false,
        changed: true,
      };
    }
    chess.undo();
  }
  return null;
}

export function userColor(orientation) {
  return orientation === "black" ? "b" : "w";
}

export function bottomToMove(turn, orientation) {
  return turn === userColor(orientation);
}

export function fenForUser(fen, orientation) {
  const user = userColor(orientation);
  const parts = fen.split(" ");
  if (parts.length < 4 || parts[1] === user) return fen;
  parts[1] = user;
  parts[3] = "-";
  const flipped = parts.join(" ");
  try {
    const chess = new Chess(flipped);
    const opponent = user === "w" ? "b" : "w";
    const otherKing = kingSquare(chess, opponent);
    if (!otherKing || chess.isAttacked(otherKing, user)) return fen;
    return chess.fen();
  } catch {
    return fen;
  }
}

export function recommendationForUser(fen, pv, orientation) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const user = userColor(orientation);
  const line = [];
  const parts = [];
  let san = null;
  for (const uci of pv) {
    const mover = chess.turn();
    const moveNo = chess.moveNumber();
    let move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    if (!move) break;
    if (mover !== user && line.length === 0) continue;
    if (!san) san = move.san;
    line.push(uci);
    if (mover === "w") parts.push(`${moveNo}. ${move.san}`);
    else if (parts.length === 0) parts.push(`${moveNo}... ${move.san}`);
    else parts.push(move.san);
  }
  if (!line.length) return null;
  return { uci: line[0], san, line, text: parts.join(" ") };
}

export function positionFromPlacement(placement, turn) {
  const game = tryGame(placement, turn);
  if (!game) return { error: "illegal" };
  return {
    fen: game.fen(),
    placement,
    turn: game.turn(),
    lastMove: null,
    jumped: false,
    changed: true,
  };
}

export function reducePosition(prev, placement, turnPref) {
  if (!placement || !expand(placement)) return { error: "unreadable" };
  if (prev?.fen && prev.placement === placement) {
    return { ...prev, changed: false };
  }
  if (prev?.fen) {
    const hit = transition(prev.fen, placement);
    if (hit) return hit;
    const parts = prev.fen.split(" ");
    parts[1] = parts[1] === "w" ? "b" : "w";
    const flipped = transition(parts.join(" "), placement);
    if (flipped) return flipped;
  }
  const preferred = turnPref === "b" ? "b" : "w";
  const game = tryGame(placement, preferred) || tryGame(placement, preferred === "w" ? "b" : "w");
  if (!game) return { error: "illegal" };
  return {
    fen: game.fen(),
    placement,
    turn: game.turn(),
    lastMove: null,
    jumped: Boolean(prev?.fen),
    changed: true,
  };
}

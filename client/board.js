function pieceMarkup(ch) {
  const white = ch === ch.toUpperCase();
  const fill = white ? "#f4efe4" : "#171412";
  const ink = white ? "#2a231b" : "#e2b86a";
  const cut = white ? "#2a231b" : "#f4efe4";
  const kind = ch.toLowerCase();
  const bodies = {
    p: `
      <circle cx="20" cy="13.5" r="5" fill="${fill}" stroke="${ink}" stroke-width="1.6"/>
      <path d="M13.2 29.2h13.6l-1.7-8.4c-1.7.9-3.5 1.3-5.1 1.3s-3.4-.4-5.1-1.3z" fill="${fill}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M11 31.4h18v2.2H11z" fill="${ink}"/>`,
    r: `
      <path d="M11 11h4.2v3.3h2.5V11H22v3.3h2.5V11H29v6H11z" fill="${fill}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M13.4 16.8h13.2V26H13.4z" fill="${fill}" stroke="${ink}" stroke-width="1.4"/>
      <path d="M11 28.6h18v2.6H11z" fill="${fill}" stroke="${ink}" stroke-width="1.4"/>`,
    n: `
      <path d="M12 30.2 14.2 19.4 18 16.8 16.6 12.4 20.4 9.2 23.2 12.6 26.2 10.6 30.4 17.2 27.6 20.2 31 23.2 26.2 25.4 24.8 30.2z" fill="${fill}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="22.4" cy="14.2" r="1.05" fill="${cut}"/>
      <path d="M11.2 30.6h18.6v2.4H11.2z" fill="${ink}"/>`,
    b: `
      <path d="M20 6.2c4.6 4 7.6 8.4 7.6 12.6 0 3.3-2.4 5.4-7.6 5.4s-7.6-2.1-7.6-5.4c0-4.2 3-8.6 7.6-12.6z" fill="${fill}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M18.7 11.2h2.6v7.2h-2.6z" fill="${cut}"/>
      <path d="M15.6 25h8.8v3.1h-8.8z" fill="${fill}" stroke="${ink}" stroke-width="1.4"/>
      <path d="M11.4 29h17.2v2.5H11.4z" fill="${ink}"/>`,
    q: `
      <circle cx="9" cy="13.2" r="2.1" fill="${fill}" stroke="${ink}" stroke-width="1.3"/>
      <circle cx="20" cy="8.6" r="2.1" fill="${fill}" stroke="${ink}" stroke-width="1.3"/>
      <circle cx="31" cy="13.2" r="2.1" fill="${fill}" stroke="${ink}" stroke-width="1.3"/>
      <path d="M8.2 15.2 12.6 25.6h14.8L31.8 15.2 26.2 19.2 20 11.4 13.8 19.2z" fill="${fill}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M12.2 26.2h15.6v2.5H12.2z" fill="${fill}" stroke="${ink}" stroke-width="1.3"/>
      <path d="M10.6 29.2h18.8v2.4H10.6z" fill="${ink}"/>`,
    k: `
      <path d="M18.3 4.8h3.4V8h3.5v3.2h-3.5v3.6h-3.4v-3.6h-3.5V8h3.5z" fill="${ink}"/>
      <path d="M12.2 17.8h15.6l-1.8 8H14z" fill="${fill}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M14 26.2h12v2.5H14z" fill="${fill}" stroke="${ink}" stroke-width="1.3"/>
      <path d="M11 29.2h18v2.4H11z" fill="${ink}"/>`,
  };
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${bodies[kind] ?? ""}</svg>`;
}

function toXY(square, orientation) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  if (orientation === "black") return { x: 7 - file, y: rank };
  return { x: file, y: 7 - rank };
}

function pieceAt(fen, square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const row = fen.split(" ")[0].split("/")[8 - rank];
  if (!row) return null;
  let cursor = 0;
  for (const ch of row) {
    if (ch >= "1" && ch <= "8") {
      cursor += Number(ch);
      continue;
    }
    if (cursor === file) return ch;
    cursor += 1;
  }
  return null;
}

function squaresOf(fen, orientation) {
  const rows = fen.split(" ")[0].split("/");
  const list = [];
  for (let r = 0; r < rows.length; r += 1) {
    let file = 0;
    for (const ch of rows[r]) {
      if (ch >= "1" && ch <= "8") {
        file += Number(ch);
        continue;
      }
      const square = `${"abcdefgh"[file]}${8 - r}`;
      const pos = toXY(square, orientation);
      list.push({ type: ch, square, x: pos.x, y: pos.y });
      file += 1;
    }
  }
  return list;
}

export function createBoard(root) {
  root.innerHTML = `
    <div class="squares"></div>
    <div class="pieces"></div>
    <svg class="arrows" viewBox="0 0 8 8" aria-hidden="true">
      <defs>
        <marker id="relayArrow" markerWidth="3.2" markerHeight="3.2" refX="1.2" refY="1.6" orient="auto">
          <path d="M0 0 L3.2 1.6 L0 3.2 Z" fill="#ff5a36"></path>
        </marker>
      </defs>
      <path class="shaft" marker-end="url(#relayArrow)"></path>
    </svg>
  `;
  const squares = root.querySelector(".squares");
  const piecesLayer = root.querySelector(".pieces");
  const shaft = root.querySelector(".shaft");
  const squareEls = [];
  for (let i = 0; i < 64; i += 1) {
    const el = document.createElement("div");
    squares.append(el);
    squareEls.push(el);
  }

  let pieces = [];
  let fen = null;
  let orientation = "white";
  let arrow = null;

  function paintSquares(nextOrientation, lastMove) {
    const last = new Set();
    if (lastMove?.from) last.add(lastMove.from);
    if (lastMove?.to) last.add(lastMove.to);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const file = nextOrientation === "black" ? 7 - x : x;
        const rank = nextOrientation === "black" ? y : 7 - y;
        const square = `${"abcdefgh"[file]}${rank + 1}`;
        const el = squareEls[y * 8 + x];
        el.className = `sq ${(x + y) % 2 === 0 ? "light" : "dark"}`;
        if (last.has(square)) el.classList.add("last");
        el.replaceChildren();
        if (x === 0) {
          const label = document.createElement("i");
          label.className = "rank";
          label.textContent = String(rank + 1);
          el.append(label);
        }
        if (y === 7) {
          const label = document.createElement("i");
          label.className = "file";
          label.textContent = "abcdefgh"[file];
          el.append(label);
        }
      }
    }
  }

  function layout(next) {
    const wantedByType = new Map();
    for (const item of next) {
      if (!wantedByType.has(item.type)) wantedByType.set(item.type, []);
      wantedByType.get(item.type).push(item);
    }
    const used = new Set();
    const kept = [];
    for (const [type, wanted] of wantedByType) {
      const pool = pieces.filter((piece) => piece.type === type);
      const pairs = [];
      for (const piece of pool) {
        for (const target of wanted) {
          pairs.push({
            piece,
            target,
            distance: Math.abs(piece.x - target.x) + Math.abs(piece.y - target.y),
          });
        }
      }
      pairs.sort((a, b) => a.distance - b.distance);
      const matched = new Set();
      for (const pair of pairs) {
        if (used.has(pair.piece) || matched.has(pair.target)) continue;
        used.add(pair.piece);
        matched.add(pair.target);
        pair.piece.x = pair.target.x;
        pair.piece.y = pair.target.y;
        pair.piece.el.style.setProperty("--x", pair.target.x);
        pair.piece.el.style.setProperty("--y", pair.target.y);
        kept.push(pair.piece);
      }
      for (const target of wanted) {
        if (matched.has(target)) continue;
        const el = document.createElement("div");
        el.className = "piece fresh";
        el.innerHTML = pieceMarkup(target.type);
        el.style.setProperty("--x", target.x);
        el.style.setProperty("--y", target.y);
        piecesLayer.append(el);
        kept.push({ el, type: target.type, x: target.x, y: target.y });
        el.addEventListener("animationend", () => el.classList.remove("fresh"), { once: true });
      }
    }
    for (const piece of pieces) {
      if (!used.has(piece)) piece.el.remove();
    }
    pieces = kept;
  }

  function refreshArrow() {
    const ghost = piecesLayer.querySelector(".ghost");
    if (!arrow || !fen) {
      shaft.setAttribute("d", "");
      ghost?.remove();
      return;
    }
    const from = arrow.slice(0, 2);
    const to = arrow.slice(2, 4);
    const start = toXY(from, orientation);
    const end = toXY(to, orientation);
    const x1 = start.x + 0.5;
    const y1 = start.y + 0.5;
    const x2 = end.x + 0.5;
    const y2 = end.y + 0.5;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const tipX = x2 - (dx / length) * 0.42;
    const tipY = y2 - (dy / length) * 0.42;
    shaft.setAttribute("d", `M ${x1} ${y1} L ${tipX} ${tipY}`);
    const type = pieceAt(fen, from);
    if (!type) {
      ghost?.remove();
      return;
    }
    const el = ghost ?? document.createElement("div");
    el.className = "piece ghost";
    el.innerHTML = pieceMarkup(type);
    el.style.setProperty("--x0", start.x);
    el.style.setProperty("--y0", start.y);
    el.style.setProperty("--x1", end.x);
    el.style.setProperty("--y1", end.y);
    piecesLayer.append(el);
  }

  function show(nextFen, nextOrientation, lastMove, animate = true) {
    fen = nextFen;
    const orientChanged = orientation !== nextOrientation;
    orientation = nextOrientation === "black" ? "black" : "white";
    if (!animate || orientChanged) root.classList.add("no-anim");
    paintSquares(orientation, lastMove);
    layout(squaresOf(fen, orientation));
    refreshArrow();
    const side = orientation === "black" ? "black" : "white";
    root.setAttribute("aria-label", `Copied board with ${side} at the bottom`);
    if (!animate || orientChanged) requestAnimationFrame(() => root.classList.remove("no-anim"));
  }

  function clear() {
    fen = null;
    arrow = null;
    for (const piece of pieces) piece.el.remove();
    pieces = [];
    piecesLayer.querySelector(".ghost")?.remove();
    shaft.setAttribute("d", "");
    paintSquares("white", null);
    root.setAttribute("aria-label", "Empty board, waiting for a chessboard on screen");
  }

  clear();

  return {
    show,
    clear,
    setArrow(uci) {
      arrow = uci || null;
      refreshArrow();
    },
  };
}

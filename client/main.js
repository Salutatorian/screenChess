import { Chess } from "chess.js";
import { createRecognizer, flipPlacement, resolveOrientation } from "@scoriiu/fenshot";
import { createBoard } from "./board.js";
import { fenForUser, positionFromPlacement, recommendationForUser, reducePosition } from "../position.mjs";

const DETECT_MAX = 1600;

const screen = document.querySelector("#screen");
const video = document.querySelector("#video");
const still = document.querySelector("#still");
const overlay = document.querySelector("#overlay");
const cropEl = document.querySelector("#crop");
const empty = document.querySelector("#emptyScreen");
const readStatus = document.querySelector("#readStatus");
const conf = document.querySelector("#conf");
const sideLabel = document.querySelector("#sideLabel");
const shareBtn = document.querySelector("#shareBtn");
const fileBtn = document.querySelector("#fileBtn");
const fileInput = document.querySelector("#file");
const cropBtn = document.querySelector("#cropBtn");
const liveBtn = document.querySelector("#liveBtn");
const engineId = document.querySelector("#engineId");
const lamp = document.querySelector("#lamp");
const bestMove = document.querySelector("#bestMove");
const scoreLine = document.querySelector("#scoreLine");
const pv = document.querySelector("#pv");
const watchBtn = document.querySelector("#watchBtn");
const backBtn = document.querySelector("#backBtn");
const turnSeg = document.querySelector("#turnSeg");
const orientSeg = document.querySelector("#orientSeg");
const depth = document.querySelector("#depth");
const depthVal = document.querySelector("#depthVal");
const evalBar = document.querySelector("#eval");
const evalFill = document.querySelector("#evalFill");

const board = createBoard(document.querySelector("#board"));
const scratch = document.createElement("canvas");
const recognizer = createRecognizer({
  modelUrl: "/models/chess-tiles-v2.onnx",
  wasmPaths: "/ort/",
});

let position = null;
let turnPref = "w";
let orientMode = "auto";
let orientation = "white";
let shownOrientation = "white";
let boardHasPosition = false;
let live = true;
let sourceKind = null;
let fileMode = false;
let stream = null;
let fileUrl = null;
let crop = null;
let lastCorners = null;
let lastOutlineOk = true;
let committedRaw = null;
let pendingRaw = null;
let pendingCount = 0;
let misses = 0;
let shaky = 0;
let loopRun = 0;
let scanning = false;
let scanAgain = false;
let previewToken = 0;
let previewing = false;
let mainPv = null;
let arrow = null;
let engineFen = null;
let ws = null;
let wsReady = false;
let depthTimer = 0;
const lines = new Map();
let drag = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatus(text, kind = "") {
  if (readStatus.textContent === text && readStatus.dataset.kind === kind) return;
  readStatus.textContent = text;
  readStatus.dataset.kind = kind;
}

function sourceSize() {
  if (sourceKind === "video" && video.videoWidth) return { w: video.videoWidth, h: video.videoHeight };
  if (sourceKind === "image" && still.naturalWidth) return { w: still.naturalWidth, h: still.naturalHeight };
  return null;
}

function containFit(el, sw, sh) {
  const ew = el.clientWidth;
  const eh = el.clientHeight;
  const scale = Math.min(ew / sw, eh / sh);
  return { scale, ox: (ew - sw * scale) / 2, oy: (eh - sh * scale) / 2 };
}

function clampCrop(box, size) {
  const w = Math.max(64, Math.min(box.w, size.w));
  const h = Math.max(64, Math.min(box.h, size.h));
  return {
    x: Math.min(Math.max(0, box.x), size.w - w),
    y: Math.min(Math.max(0, box.y), size.h - h),
    w,
    h,
  };
}

function eventToSource(event) {
  const size = sourceSize();
  if (!size) return null;
  const rect = screen.getBoundingClientRect();
  const fit = containFit(screen, size.w, size.h);
  return {
    x: (event.clientX - rect.left - fit.ox) / fit.scale,
    y: (event.clientY - rect.top - fit.oy) / fit.scale,
  };
}

function placeCropBox() {
  const size = sourceSize();
  if (!crop || !size) {
    cropEl.hidden = true;
    return;
  }
  const fit = containFit(screen, size.w, size.h);
  cropEl.hidden = false;
  cropEl.style.left = `${fit.ox + crop.x * fit.scale}px`;
  cropEl.style.top = `${fit.oy + crop.y * fit.scale}px`;
  cropEl.style.width = `${crop.w * fit.scale}px`;
  cropEl.style.height = `${crop.h * fit.scale}px`;
}

function drawOutline() {
  const ctx = overlay.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = screen.clientWidth;
  const h = screen.clientHeight;
  overlay.width = Math.max(1, Math.round(w * dpr));
  overlay.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const size = sourceSize();
  if (!lastCorners || !size) return;
  const fit = containFit(screen, size.w, size.h);
  const x = fit.ox + lastCorners.x0 * fit.scale;
  const y = fit.oy + lastCorners.y0 * fit.scale;
  const rw = (lastCorners.x1 - lastCorners.x0) * fit.scale;
  const rh = (lastCorners.y1 - lastCorners.y0) * fit.scale;
  ctx.strokeStyle = lastOutlineOk ? "#e0b15a" : "#ff5a36";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));
}

function mapCorners(corners, width, height, origin) {
  const scale = Math.min(1, DETECT_MAX / Math.max(width, height));
  return {
    x0: origin.x + corners.x0 / scale,
    y0: origin.y + corners.y0 / scale,
    x1: origin.x + corners.x1 / scale,
    y1: origin.y + corners.y1 / scale,
  };
}

function applyOrientation(raw) {
  const detected = resolveOrientation(raw);
  if (orientMode === "auto" || detected.orientation === orientMode) return detected;
  return { placement: flipPlacement(detected.placement), orientation: orientMode };
}

function syncTurnButtons() {
  const turn = position?.turn ?? null;
  for (const button of turnSeg.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(turn !== null && button.dataset.turn === turn));
  }
  sideLabel.textContent = turn === "w" ? "White to move" : turn === "b" ? "Black to move" : "—";
}

function syncOrientButtons() {
  for (const button of orientSeg.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.orient === orientMode));
  }
}

function terminalText(fen) {
  try {
    const chess = new Chess(fen);
    if (chess.isCheckmate()) return "Checkmate";
    if (chess.isStalemate()) return "Stalemate";
    if (chess.isDraw()) return "Draw";
  } catch {
    return null;
  }
  return null;
}

function whiteScore(msg) {
  const turn = (engineFen || position?.fen || "").split(" ")[1] || "w";
  if (msg.mate != null) return { mate: turn === "w" ? msg.mate : -msg.mate, cp: null };
  return { mate: null, cp: turn === "w" ? msg.cp : -msg.cp };
}

function formatEval(msg) {
  const score = whiteScore(msg);
  if (score.mate != null) {
    if (score.mate === 0) return "Mate";
    return score.mate > 0 ? `+M${score.mate}` : `−M${-score.mate}`;
  }
  const pawns = score.cp / 100;
  const body = Math.abs(pawns).toFixed(2);
  if (pawns > 0) return `+${body}`;
  if (pawns < 0) return `−${body}`;
  return "0.00";
}

function formatNps(nps) {
  if (nps >= 1_000_000) return `${(nps / 1_000_000).toFixed(1)} Mn/s`;
  if (nps >= 1_000) return `${Math.round(nps / 1_000)} kn/s`;
  return `${nps} n/s`;
}

function setEval(msg) {
  if (!msg || !position) {
    evalFill.style.height = "50%";
    evalBar.setAttribute("aria-label", "No evaluation yet");
    return;
  }
  const score = whiteScore(msg);
  let pct = 50;
  if (score.mate != null) pct = score.mate > 0 ? 100 : score.mate < 0 ? 0 : 50;
  else pct = 100 / (1 + Math.exp(-0.00368208 * score.cp));
  evalFill.style.height = `${pct}%`;
  evalBar.setAttribute("aria-label", `White evaluation ${formatEval(msg)}`);
}

function renderLines() {
  pv.replaceChildren();
  const fen = engineFen || position?.fen;
  if (!fen) return;
  for (const key of [...lines.keys()].sort((a, b) => a - b)) {
    const msg = lines.get(key);
    const rec = recommendationForUser(fen, msg.pv, orientation);
    if (!rec) continue;
    const row = document.createElement("div");
    row.className = "pv-line";
    const score = document.createElement("span");
    score.textContent = formatEval(msg);
    const text = document.createElement("span");
    text.textContent = rec.text;
    row.append(score, text);
    pv.append(row);
  }
}

function showUserMove(pv) {
  const fen = engineFen || position?.fen;
  if (!fen || !pv?.length) return;
  const rec = recommendationForUser(fen, pv, orientation);
  if (!rec) return;
  mainPv = rec.line;
  arrow = rec.uci;
  if (!previewing) board.setArrow(rec.uci);
  bestMove.textContent = rec.san;
  watchBtn.disabled = previewing;
}

function sendAnalyze() {
  if (!wsReady || !position?.fen) return;
  engineFen = fenForUser(position.fen, orientation);
  lamp.classList.add("searching");
  ws.send(JSON.stringify({
    type: "analyze",
    fen: engineFen,
    depth: Number(depth.value),
    multipv: 3,
  }));
}

function sendStop() {
  lamp.classList.remove("searching");
  if (wsReady) ws.send(JSON.stringify({ type: "stop" }));
}

function stopPreview() {
  previewToken += 1;
  previewing = false;
  backBtn.hidden = true;
  watchBtn.disabled = !mainPv?.length;
  if (position?.fen) {
    board.show(position.fen, orientation, position.lastMove, false);
    if (arrow) board.setArrow(arrow);
  }
}

function publish(announce) {
  if (previewing) stopPreview();
  const orientChanged = shownOrientation !== orientation;
  board.show(position.fen, orientation, position.lastMove, boardHasPosition && !orientChanged);
  boardHasPosition = true;
  shownOrientation = orientation;
  syncTurnButtons();
  lines.clear();
  mainPv = null;
  arrow = null;
  board.setArrow(null);
  renderLines();
  setEval(null);
  const over = terminalText(position.fen);
  if (over) {
    bestMove.textContent = over;
    scoreLine.textContent = "Game over";
    watchBtn.disabled = true;
    sendStop();
    if (announce) setStatus(over);
    return;
  }
  watchBtn.disabled = true;
  if (announce) {
    if (position.jumped) setStatus("New position. If the eval looks backwards, switch who is to move.", "warn");
    else if (position.lastMove) setStatus(`Copied ${position.lastMove.san}.`);
    else setStatus("Position copied.");
  }
  bestMove.textContent = "…";
  scoreLine.textContent = "Searching";
  sendAnalyze();
}

function commit(raw, reset = false) {
  if (!reset && raw === committedRaw && position) return;
  const oriented = applyOrientation(raw);
  const prev = reset || position?.error ? null : position;
  const bottom = oriented.orientation === "black" ? "b" : "w";
  const next = reducePosition(prev, oriented.placement, bottom);
  if (next.error) {
    setStatus("That read is not a legal position. Frame the board a little tighter.", "warn");
    return;
  }
  const changed = reset || !position || position.fen !== next.fen;
  position = next;
  committedRaw = raw;
  orientation = oriented.orientation;
  if (changed) publish(true);
}

async function grab() {
  const size = sourceSize();
  if (!size) return null;
  const el = sourceKind === "video" ? video : still;
  if (!crop) return { bitmap: await createImageBitmap(el), origin: { x: 0, y: 0 } };
  const w = Math.max(1, Math.round(crop.w));
  const h = Math.max(1, Math.round(crop.h));
  scratch.width = w;
  scratch.height = h;
  scratch.getContext("2d", { willReadFrequently: true }).drawImage(el, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  return { bitmap: await createImageBitmap(scratch), origin: { x: crop.x, y: crop.y } };
}

async function scan() {
  if (!sourceKind) return;
  const shot = await grab();
  if (!shot) return;
  const width = shot.bitmap.width;
  const height = shot.bitmap.height;
  let result;
  try {
    result = await recognizer.recognize(shot.bitmap);
  } finally {
    shot.bitmap.close();
  }
  if (!result?.plausible) {
    misses += 1;
    if (misses === 8) {
      setStatus("No board in this frame. Share the chess window, or frame the board.", "warn");
      lastCorners = null;
      drawOutline();
    }
    return;
  }
  misses = 0;
  lastCorners = mapCorners(result.corners, width, height, shot.origin);
  conf.textContent = `${Math.round(result.meanConfidence * 100)}%`;
  if (!result.reliable) {
    shaky += 1;
    lastOutlineOk = false;
    drawOutline();
    if (shaky === 4) setStatus("Low confidence. Frame the board so the box sits on the squares.", "warn");
    return;
  }
  shaky = 0;
  lastOutlineOk = true;
  drawOutline();
  if (result.placement === pendingRaw) pendingCount += 1;
  else {
    pendingRaw = result.placement;
    pendingCount = 1;
  }
  const ready = sourceKind === "image" || pendingCount >= 2 || result.minConfidence >= 0.9;
  if (!ready) {
    setStatus("Settling the read…");
    return;
  }
  commit(result.placement);
}

async function requestScan() {
  if (scanning) {
    scanAgain = true;
    return;
  }
  scanning = true;
  try {
    do {
      scanAgain = false;
      await scan();
    } while (scanAgain);
  } catch (err) {
    setStatus(err.message || "Could not read that frame.", "warn");
  } finally {
    scanning = false;
  }
}

async function loop() {
  const token = ++loopRun;
  while (token === loopRun && live && sourceKind === "video") {
    if (video.readyState >= 2) await requestScan();
    else await sleep(150);
    if (token !== loopRun || !live || sourceKind !== "video") break;
    if (fileMode && video.paused) break;
    await sleep(40);
  }
}

function stopLoop() {
  loopRun += 1;
}

function stopSource() {
  stopLoop();
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = null;
  still.removeAttribute("src");
  video.hidden = true;
  still.hidden = true;
  empty.hidden = false;
  sourceKind = null;
  fileMode = false;
  crop = null;
  cropEl.hidden = true;
  cropBtn.setAttribute("aria-pressed", "false");
  cropBtn.disabled = true;
  lastCorners = null;
  drawOutline();
}

async function shareScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("This browser cannot share a screen.", "warn");
    return;
  }
  let media;
  try {
    media = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
  } catch (err) {
    if (err.name !== "NotAllowedError") setStatus(err.message, "warn");
    return;
  }
  stopSource();
  stream = media;
  sourceKind = "video";
  fileMode = false;
  video.hidden = false;
  still.hidden = true;
  empty.hidden = true;
  video.controls = false;
  video.srcObject = media;
  cropBtn.disabled = false;
  await video.play();
  media.getVideoTracks()[0].addEventListener("ended", () => {
    setStatus("Screen share ended.");
    stopLoop();
  });
  setStatus("Watching the screen. Share the chess window, not this page.");
  if (live) loop();
}

async function loadImage(file) {
  stopSource();
  fileUrl = URL.createObjectURL(file);
  sourceKind = "image";
  still.hidden = false;
  empty.hidden = true;
  still.src = fileUrl;
  cropBtn.disabled = false;
  await still.decode();
  setStatus("Reading the still.");
  await requestScan();
}

async function loadVideo(file) {
  stopSource();
  fileUrl = URL.createObjectURL(file);
  sourceKind = "video";
  fileMode = true;
  video.hidden = false;
  empty.hidden = true;
  video.controls = true;
  video.src = fileUrl;
  cropBtn.disabled = false;
  setStatus("Playing the recording.");
  try {
    await video.play();
  } catch {
    setStatus("Press play on the recording.");
    return;
  }
  if (live) loop();
}

function openFile(file) {
  if (!file) return;
  if (file.type.startsWith("image/")) loadImage(file);
  else loadVideo(file);
}

function toggleCrop() {
  const size = sourceSize();
  if (!size) return;
  if (crop) {
    crop = null;
    cropBtn.setAttribute("aria-pressed", "false");
    cropEl.hidden = true;
  } else {
    const box = lastCorners
      ? {
          x: lastCorners.x0,
          y: lastCorners.y0,
          w: lastCorners.x1 - lastCorners.x0,
          h: lastCorners.y1 - lastCorners.y0,
        }
      : {
          x: (size.w - Math.min(size.w, size.h) * 0.76) / 2,
          y: (size.h - Math.min(size.w, size.h) * 0.76) / 2,
          w: Math.min(size.w, size.h) * 0.76,
          h: Math.min(size.w, size.h) * 0.76,
        };
    crop = clampCrop(box, size);
    cropBtn.setAttribute("aria-pressed", "true");
    placeCropBox();
  }
  pendingRaw = null;
  pendingCount = 0;
  requestScan();
}

async function playLine() {
  if (!mainPv?.length || !position?.fen || previewing) return;
  const token = ++previewToken;
  const moves = mainPv.slice(0, 12);
  const startFen = engineFen || position.fen;
  previewing = true;
  backBtn.hidden = false;
  watchBtn.disabled = true;
  board.setArrow(null);
  const chess = new Chess(startFen);
  for (const uci of moves) {
    if (token !== previewToken) return;
    let move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    if (!move) break;
    board.show(chess.fen(), orientation, { from: move.from, to: move.to }, true);
    await sleep(680);
  }
  if (token !== previewToken) return;
  await sleep(520);
  if (token !== previewToken) return;
  stopPreview();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/engine`);
  ws = socket;
  socket.addEventListener("open", () => {
    wsReady = true;
    if (position?.fen && !terminalText(position.fen)) sendAnalyze();
  });
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "ready") {
      engineId.textContent = msg.name;
      lamp.classList.add("ready");
      return;
    }
    if (msg.type === "error") {
      engineId.textContent = "Engine offline";
      lamp.classList.remove("ready", "searching");
      setStatus(msg.message, "warn");
      return;
    }
    if (!engineFen || msg.fen !== engineFen) return;
    if (msg.type === "info") {
      lines.set(msg.multipv, msg);
      if (msg.multipv === 1 && msg.pv?.[0]) {
        showUserMove(msg.pv);
        const speed = msg.nps ? ` · ${formatNps(msg.nps)}` : "";
        scoreLine.textContent = `${formatEval(msg)} for you · depth ${msg.depth}${speed}`;
        setEval(msg);
      }
      renderLines();
      lamp.classList.add("searching");
      return;
    }
    if (msg.type === "bestmove") {
      lamp.classList.remove("searching");
      if (msg.move) showUserMove(mainPv?.[0] === msg.move ? mainPv : [msg.move]);
    }
  });
  socket.addEventListener("close", () => {
    if (ws !== socket) return;
    wsReady = false;
    lamp.classList.remove("searching");
    setTimeout(connect, 1000);
  });
}

shareBtn.addEventListener("click", shareScreen);
fileBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  openFile(file);
});
cropBtn.addEventListener("click", toggleCrop);
liveBtn.addEventListener("click", () => {
  live = !live;
  liveBtn.setAttribute("aria-pressed", String(live));
  liveBtn.textContent = live ? "Live" : "Paused";
  if (live && sourceKind === "video") loop();
  else stopLoop();
});
watchBtn.addEventListener("click", playLine);
backBtn.addEventListener("click", stopPreview);
turnSeg.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !position?.placement) return;
  const next = positionFromPlacement(position.placement, button.dataset.turn);
  if (next.error) {
    setStatus("That side cannot be to move in this position.", "warn");
    return;
  }
  turnPref = button.dataset.turn;
  position = next;
  publish(false);
  setStatus(turnPref === "w" ? "White to move." : "Black to move.");
});
orientSeg.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  orientMode = button.dataset.orient;
  syncOrientButtons();
  if (committedRaw) commit(committedRaw, true);
});
depth.addEventListener("input", () => {
  depthVal.textContent = depth.value;
  clearTimeout(depthTimer);
  depthTimer = setTimeout(() => {
    if (position?.fen && !terminalText(position.fen)) sendAnalyze();
  }, 160);
});

video.addEventListener("play", () => {
  if (live && sourceKind === "video") loop();
});
video.addEventListener("seeked", () => requestScan());
video.addEventListener("error", () => setStatus("That recording could not be played.", "warn"));

cropEl.addEventListener("pointerdown", (event) => {
  if (!crop) return;
  const point = eventToSource(event);
  if (!point) return;
  drag = {
    handle: event.target.closest("[data-h]")?.dataset.h ?? "move",
    start: point,
    orig: { ...crop },
  };
  cropEl.setPointerCapture(event.pointerId);
  event.preventDefault();
});
cropEl.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const point = eventToSource(event);
  const size = sourceSize();
  if (!point || !size) return;
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  const next = { ...drag.orig };
  if (drag.handle === "move") {
    next.x += dx;
    next.y += dy;
  }
  if (drag.handle === "se" || drag.handle === "ne") next.w += dx;
  if (drag.handle === "sw" || drag.handle === "nw") {
    next.x += dx;
    next.w -= dx;
  }
  if (drag.handle === "se" || drag.handle === "sw") next.h += dy;
  if (drag.handle === "ne" || drag.handle === "nw") {
    next.y += dy;
    next.h -= dy;
  }
  crop = clampCrop(next, size);
  placeCropBox();
});
function endDrag(event) {
  if (!drag) return;
  drag = null;
  if (cropEl.hasPointerCapture(event.pointerId)) cropEl.releasePointerCapture(event.pointerId);
  pendingRaw = null;
  pendingCount = 0;
  requestScan();
}
cropEl.addEventListener("pointerup", endDrag);
cropEl.addEventListener("pointercancel", endDrag);

document.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer?.items ?? []].some((item) => item.kind === "file")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  screen.classList.remove("drag");
  openFile(file);
});
screen.addEventListener("dragover", () => screen.classList.add("drag"));
screen.addEventListener("dragleave", () => screen.classList.remove("drag"));

window.addEventListener("paste", (event) => {
  for (const item of event.clipboardData?.items ?? []) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    loadImage(file);
    return;
  }
});

new ResizeObserver(() => {
  placeCropBox();
  drawOutline();
}).observe(screen);

async function checkAssets() {
  const [model, wasm] = await Promise.all([
    fetch("/models/chess-tiles-v2.onnx"),
    fetch("/ort/ort-wasm-simd-threaded.wasm"),
  ]);
  if (!model.ok || !wasm.ok) setStatus("The board reader files are missing. Restart screenChess.", "warn");
}

async function probeReader() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  try {
    const bitmap = await createImageBitmap(canvas);
    try {
      await recognizer.recognize(bitmap);
    } finally {
      bitmap.close();
    }
    document.documentElement.dataset.reader = "ready";
  } catch (err) {
    document.documentElement.dataset.reader = "error";
    setStatus(err.message || "The board reader failed to start.", "warn");
  }
}

if (!crossOriginIsolated) {
  setStatus("Open this page from the screenChess server so the board reader can start.", "warn");
} else {
  probeReader();
}
if (!navigator.mediaDevices?.getDisplayMedia) shareBtn.disabled = true;
syncTurnButtons();
syncOrientButtons();
cropBtn.disabled = true;
connect();
checkAssets();
document.documentElement.dataset.booted = "1";

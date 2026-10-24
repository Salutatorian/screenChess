import fs from "node:fs";
import path from "node:path";

const wasmFiles = [
  "ort.wasm.bundle.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

const fontFiles = [
  ["fraunces", "fraunces-latin-500-normal.woff2"],
  ["fraunces", "fraunces-latin-600-normal.woff2"],
  ["fraunces", "fraunces-latin-700-normal.woff2"],
  ["barlow", "barlow-latin-400-normal.woff2"],
  ["barlow", "barlow-latin-500-normal.woff2"],
  ["barlow", "barlow-latin-600-normal.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2"],
];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) return;
  fs.copyFileSync(from, to);
}

export function copyWebAssets(root) {
  const publicDir = path.join(root, "public");
  const ort = path.join(root, "node_modules", "onnxruntime-web", "dist");
  for (const name of wasmFiles) {
    copyFile(path.join(ort, name), path.join(publicDir, "ort", name));
  }
  copyFile(
    path.join(root, "node_modules", "@scoriiu", "fenshot", "model", "chess-tiles-v2.onnx"),
    path.join(publicDir, "models", "chess-tiles-v2.onnx"),
  );
  const fonts = path.join(root, "node_modules", "@fontsource");
  for (const [family, file] of fontFiles) {
    copyFile(path.join(fonts, family, "files", file), path.join(publicDir, "fonts", file));
  }
}

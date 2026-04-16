// FILE: src/services/card/fonts.ts
// Font loading for satori card rendering.
// Strategy: system fonts → cached download → fetch from CDN.
// satori requires fonts as ArrayBuffer (TTF/OTF/WOFF only, NOT WOFF2).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCacheDir } from "../../utils/paths.js";

export interface FontData {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
}

const SYSTEM_FONT_PATHS = [
  // macOS
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  // Linux (Debian/Ubuntu)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  // Linux (Arch/Fedora)
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  // Windows
  "C:\\Windows\\Fonts\\arial.ttf",
];

const FONT_CDN_REGULAR =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-400-normal.woff";
const FONT_CDN_BOLD =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-700-normal.woff";

/**
 * Read a file and return its contents as an ArrayBuffer.
 */
function readAsArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Try to find a usable system font.
 */
function trySystemFont(): ArrayBuffer | null {
  for (const fontPath of SYSTEM_FONT_PATHS) {
    if (existsSync(fontPath)) {
      return readAsArrayBuffer(fontPath);
    }
  }
  return null;
}

/**
 * Read cached font from .unfade/cache/fonts/.
 */
function getCachedFont(name: string): ArrayBuffer | null {
  try {
    const cacheDir = join(getCacheDir(), "fonts");
    const path = join(cacheDir, name);
    if (existsSync(path)) {
      return readAsArrayBuffer(path);
    }
  } catch {
    // Cache dir may not exist yet
  }
  return null;
}

/**
 * Write font data to cache.
 */
function cacheFont(name: string, data: ArrayBuffer): void {
  try {
    const cacheDir = join(getCacheDir(), "fonts");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, name), Buffer.from(data));
  } catch {
    // Non-critical — caching is best-effort
  }
}

/**
 * Download a font from URL and return as ArrayBuffer.
 */
async function downloadFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Font download failed: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

/**
 * Load fonts for satori card rendering.
 * Priority: cached → system → CDN download (cached for next time).
 */
export async function loadFonts(): Promise<FontData[]> {
  // 1. Try cached Inter fonts
  const cachedRegular = getCachedFont("inter-400.woff");
  const cachedBold = getCachedFont("inter-700.woff");
  if (cachedRegular && cachedBold) {
    return [
      { name: "Inter", data: cachedRegular, weight: 400, style: "normal" },
      { name: "Inter", data: cachedBold, weight: 700, style: "normal" },
    ];
  }

  // 2. Try system font (single weight fallback)
  const systemFont = trySystemFont();
  if (systemFont) {
    return [{ name: "Arial", data: systemFont, weight: 400, style: "normal" }];
  }

  // 3. Download from CDN and cache
  const [regular, bold] = await Promise.all([
    downloadFont(FONT_CDN_REGULAR),
    downloadFont(FONT_CDN_BOLD),
  ]);
  cacheFont("inter-400.woff", regular);
  cacheFont("inter-700.woff", bold);

  return [
    { name: "Inter", data: regular, weight: 400, style: "normal" },
    { name: "Inter", data: bold, weight: 700, style: "normal" },
  ];
}

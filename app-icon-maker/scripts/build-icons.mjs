#!/usr/bin/env node
/**
 * build-icons.mjs — App icon asset pipeline (iOS + Android + Web)
 *
 * Usage:
 *   node scripts/build-icons.mjs --master art.png --name "Nimbus" --out ./icon-pack
 *   node scripts/build-icons.mjs --fg symbol.svg --bg "#0B1220" --name "Nimbus"
 *   node scripts/build-icons.mjs --fg symbol.svg --bg "linear-gradient(135deg,#6D5BFF,#22D3EE)"
 *
 * Output: full iOS AppIcon.appiconset (with dark/tinted), Android mipmap set with
 * adaptive + monochrome layers, Play Store 512, web/PWA icons, previews, README, ZIP.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { svgToVectorDrawable } from './svg-to-vector.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------ */
/* deps                                                                */
/* ------------------------------------------------------------------ */
async function loadDeps() {
  try {
    return { sharp: require('sharp'), archiver: require('archiver') };
  } catch {
    console.error('[deps] missing, running npm install ...');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--no-audit', '--no-fund'], { cwd: SKILL_ROOT, stdio: 'inherit' });
    return { sharp: require('sharp'), archiver: require('archiver') };
  }
}
const { sharp, archiver } = await loadDeps();

/* ------------------------------------------------------------------ */
/* args                                                                */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`
app-icon-maker — build-icons.mjs

  --master <file>     Full 1024x1024 artwork (png/jpg/webp/svg). Simple mode.
  --fg <file>         Foreground layer, transparent background. SVG → real Android
                      VectorDrawable (recommended); PNG → bitmap drawable fallback.
  --bg <value>        Background: "#0B1220" | "linear-gradient(135deg,#a,#b)" | <image file>
  --name <string>     App name, used for metadata/README (default: "App")
  --out <dir>         Output directory (default: ./icon-pack)
  --fit <0-1>         Adaptive-icon safe-zone fill, default 0.5
  --shape <s>         Legacy icon mask: rounded|squircle|circle|square (default: squircle)
  --radius <0-0.5>    Corner radius for rounded mask (default: 0.225)
  --dark-fg <file>    Optional dedicated dark-mode foreground
  --dark-bg <value>   Optional dark-mode background
  --platform <p>      all|ios|android|web (default: all)
  --no-zip            Skip ZIP packaging
`);
  process.exit(0);
}

const NAME = String(args.name || 'App');
const SLUG = String(args.slug || NAME).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
const OUT = path.resolve(String(args.out || './icon-pack'));
const FIT = Number(args.fit || 0.5);
const SHAPE = String(args.shape || 'squircle');
const RADIUS = Number(args.radius || 0.225);
const PLATFORM = String(args.platform || 'all');
const want = (p) => PLATFORM === 'all' || PLATFORM === p;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const rgb = (hex) => {
  const h = hex.replace('#', '').trim();
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(s)) return { r: 11, g: 18, b: 32 };
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
};
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const darken = (hexColor, factor = 0.55) => {
  const c = rgb(hexColor);
  return hex({ r: c.r * factor, g: c.g * factor, b: c.b * factor });
};

const svgGradient = (size, from, to, angle = 135) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
     <defs><linearGradient id="g" gradientTransform="rotate(${angle - 90} 0.5 0.5)">
       <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
     </linearGradient></defs>
     <rect width="${size}" height="${size}" fill="url(#g)"/></svg>`;

function parseGradient(spec) {
  const m = spec.match(/^linear-gradient\(\s*([0-9.]+)deg\s*,\s*([^,]+)\s*,\s*([^)]+)\)$/i);
  if (!m) return null;
  return { angle: Number(m[1]) || 135, from: m[2].trim(), to: m[3].trim() };
}

async function renderBackground(spec, size) {
  if (!spec) return null;
  const s = String(spec);
  const grad = parseGradient(s);
  if (grad) {
    return sharp(Buffer.from(svgGradient(size, grad.from, grad.to, grad.angle))).png().toBuffer();
  }
  if (/\.(png|jpe?g|webp|svg)$/i.test(s)) {
    const buf = await fs.readFile(path.resolve(s));
    return sharp(buf).resize(size, size, { fit: 'cover', position: 'centre' }).png().toBuffer();
  }
  const c = rgb(s);
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...c, alpha: 1 } } })
    .png().toBuffer();
}

async function loadArt(file, size = 1024) {
  const buf = await fs.readFile(path.resolve(String(file)));
  const isSvg = /\.svg$/i.test(String(file)) || buf.slice(0, 5).toString() === '<svg ';
  let p = sharp(buf, { density: 384 });
  const meta = await p.metadata();
  if (!meta.width || !meta.height) throw new Error(`Cannot read image: ${file}`);
  if (Math.abs(meta.width - size) > 1 || Math.abs(meta.height - size) > 1) {
    p = p.resize(size, size, { fit: 'cover', position: 'centre' });
  }
  return p.png().toBuffer();
}

/** trim transparent margins, fall back to the full canvas */
async function trimArt(buf) {
  try {
    const out = await sharp(buf).trim({ threshold: 12 }).png().toBuffer();
    const m = await sharp(out).metadata();
    if (!m.width || !m.height) throw new Error('empty');
    return out;
  } catch {
    return buf;
  }
}

/** place art so its visible content occupies `fit` of the canvas, optically centered */
async function placeFit(artBuf, canvas, fit) {
  const trimmed = await trimArt(artBuf);
  const m = await sharp(trimmed).metadata();
  const scale = (canvas * fit) / Math.max(m.width, m.height);
  const w = Math.max(1, Math.round(m.width * scale));
  const h = Math.max(1, Math.round(m.height * scale));
  const resized = await sharp(trimmed).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const blank = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png().toBuffer();
  return sharp(blank).composite([{ input: resized, gravity: 'centre' }]).png().toBuffer();
}

async function maskShape(buf, size, shape, radius = RADIUS) {
  if (!shape || shape === 'square') return buf;
  let d;
  if (shape === 'circle') {
    const r = size / 2;
    d = `<circle cx="${r}" cy="${r}" r="${r}"/>`;
  } else if (shape === 'rounded') {
    d = `<rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * radius)}"/>`;
  } else {
    // squircle: superellipse (|x|^n + |y|^n = 1), n≈5 reads as an iOS-like continuous corner
    const n = 5, c = size / 2, r = size / 2;
    const pts = [];
    const steps = 240;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const ct = Math.cos(t), st = Math.sin(t);
      pts.push(`${(c + r * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n)).toFixed(2)},${(c + r * Math.sign(st) * Math.pow(Math.abs(st), 2 / n)).toFixed(2)}`);
    }
    d = `<polygon points="${pts.join(' ')}"/>`;
  }
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="#fff">${d}</g></svg>`;
  return sharp(buf).composite([{ input: Buffer.from(mask), blend: 'dest-in' }]).png().toBuffer();
}

async function pngNoAlpha(buf, size, bg = '#ffffff') {
  return sharp(buf)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .flatten({ background: bg })
    .removeAlpha()
    .png({ compressionLevel: 9, effort: 8 })
    .toBuffer();
}

async function pngRGBA(buf, size) {
  return sharp(buf).resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, effort: 8 }).toBuffer();
}

/** black silhouette from the alpha channel (Android 13 themed icons) */
async function monochrome(artBuf, canvas, fit) {
  const placed = await placeFit(artBuf, canvas, fit);
  const { data, info } = await sharp(placed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const a = data[i * 4 + 3];
    out[i * 4] = 0; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0;
    out[i * 4 + 3] = a < 24 ? 0 : a; // clean up faint halo
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

const write = async (rel, buf) => {
  const p = path.join(OUT, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, buf);
  return p;
};

/* ------------------------------------------------------------------ */
/* android drawable xml helpers                                        */
/* ------------------------------------------------------------------ */
const argbHex = (hexColor, alpha = 1) => {
  const c = rgb(hexColor);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return ('#' + a + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')).toUpperCase();
};

/** solid colour → <shape> drawable (no density variants needed) */
const solidBgDrawable = (color) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by app-icon-maker · adaptive-icon background layer -->
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="${argbHex(color)}"/>
</shape>
`;

/** linear gradient → vector drawable (exact CSS angle, no 45° quantisation) */
function gradientBgDrawable(grad, sizeDp = 108) {
  const rad = (grad.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = (Math.abs(dx) + Math.abs(dy)) * sizeDp;
  const c = sizeDp / 2;
  const x1 = c - (dx * len) / 2, y1 = c - (dy * len) / 2;
  const x2 = c + (dx * len) / 2, y2 = c + (dy * len) / 2;
  const n = (v) => (Math.round(v * 1000) / 1000).toString();
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by app-icon-maker · adaptive-icon background layer (${grad.angle}°) -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${sizeDp}dp"
    android:height="${sizeDp}dp"
    android:viewportWidth="${sizeDp}"
    android:viewportHeight="${sizeDp}">
    <path android:pathData="M 0 0 L ${sizeDp} 0 L ${sizeDp} ${sizeDp} L 0 ${sizeDp} Z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="${n(x1)}"
                android:startY="${n(y1)}"
                android:endX="${n(x2)}"
                android:endY="${n(y2)}"
                android:tileMode="clamp">
                <item android:offset="0" android:color="${argbHex(grad.from)}"/>
                <item android:offset="1" android:color="${argbHex(grad.to)}"/>
            </gradient>
        </aapt:attr>
    </path>
</vector>
`;
}

/** raster (or unsupported-SVG) fallback: a bitmap drawable pointing at a drawable-nodpi asset */
const bitmapDrawable = (assetName) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by app-icon-maker · bitmap fallback layer (see drawable-nodpi/${assetName}.png) -->
<bitmap xmlns:android="http://schemas.android.com/apk/res/android"
    android:src="@drawable/${assetName}"
    android:gravity="fill"/>
`;

/**
 * Remove a previous build's Android res tree so density-era leftovers
 * (ic_launcher_foreground.png etc.) never survive next to the new layout.
 * Only ever runs inside a directory that this script owns.
 */
async function cleanAndroidRes(resRel) {
  const owned = await Promise.all(['preview.html', 'source/icon-spec.json'].map((m) =>
    fs.access(path.join(OUT, m)).then(() => true, () => false)));
  if (!owned.some(Boolean)) return false;
  const subs = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi',
    'mipmap-anydpi-v26', 'drawable', 'drawable-nodpi', 'drawable-anydpi', 'values'];
  for (const sub of subs) await fs.rm(path.join(OUT, resRel, sub), { recursive: true, force: true });
  await fs.rm(path.join(OUT, 'android/play-store-icon-512.png'), { force: true });
  return true;
}

/* ------------------------------------------------------------------ */
/* specs                                                               */
/* ------------------------------------------------------------------ */
const IOS = [
  { idiom: 'iphone', size: '20x20', scale: '2x', px: 40 },
  { idiom: 'iphone', size: '20x20', scale: '3x', px: 60 },
  { idiom: 'iphone', size: '29x29', scale: '2x', px: 58 },
  { idiom: 'iphone', size: '29x29', scale: '3x', px: 87 },
  { idiom: 'iphone', size: '40x40', scale: '2x', px: 80 },
  { idiom: 'iphone', size: '40x40', scale: '3x', px: 120 },
  { idiom: 'iphone', size: '60x60', scale: '2x', px: 120 },
  { idiom: 'iphone', size: '60x60', scale: '3x', px: 180 },
  { idiom: 'ipad', size: '20x20', scale: '1x', px: 20 },
  { idiom: 'ipad', size: '20x20', scale: '2x', px: 40 },
  { idiom: 'ipad', size: '29x29', scale: '1x', px: 29 },
  { idiom: 'ipad', size: '29x29', scale: '2x', px: 58 },
  { idiom: 'ipad', size: '40x40', scale: '1x', px: 40 },
  { idiom: 'ipad', size: '40x40', scale: '2x', px: 80 },
  { idiom: 'ipad', size: '76x76', scale: '1x', px: 76 },
  { idiom: 'ipad', size: '76x76', scale: '2x', px: 152 },
  { idiom: 'ipad', size: '83.5x83.5', scale: '2x', px: 167 },
  { idiom: 'ios-marketing', size: '1024x1024', scale: '1x', px: 1024 },
];

// legacy bitmap densities (API < 26). Adaptive layers are 108dp vectors and live in
// res/drawable — no per-density PNGs for foreground/background/monochrome any more.
const ANDROID = [
  { name: 'mdpi', legacy: 48 },
  { name: 'hdpi', legacy: 72 },
  { name: 'xhdpi', legacy: 96 },
  { name: 'xxhdpi', legacy: 144 },
  { name: 'xxxhdpi', legacy: 192 },
];

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */
async function main() {
  const t0 = Date.now();
  await fs.mkdir(OUT, { recursive: true });

  /* --- 1. master ------------------------------------------------- */
  let master;      // 1024 RGBA, may contain alpha
  let fgBuf = null; // 1024 RGBA transparent foreground
  const bgSpec = args.bg ? String(args.bg) : null;

  if (args.fg) {
    fgBuf = await loadArt(args.fg, 1024);
    let bg = bgSpec ? await renderBackground(bgSpec, 1024) : null;
    if (!bg) {
      // fall back to a neutral dark surface so opaque outputs are never white-clipped
      bg = await renderBackground('#0B1220', 1024);
      console.warn('[warn] no --bg given, using #0B1220');
    }
    master = await sharp(bg).composite([{ input: fgBuf, gravity: 'centre' }]).png().toBuffer();
  } else if (args.master) {
    master = await loadArt(args.master, 1024);
    // keep it square + opaque for iOS
    const bg = bgSpec ? rgb(bgSpec) : { r: 255, g: 255, b: 255 };
    master = await sharp(master).flatten({ background: bg }).png().toBuffer();
  } else {
    console.error('ERROR: pass --master <image> or --fg <layer> [--bg <color|gradient|image>]');
    process.exit(1);
  }

  /* --- 1b. foreground → Android VectorDrawable ------------------- */
  let fgVector = null;
  let monoVector = null;
  let vectorNote = null;
  if (args.fg) {
    const fgPath = path.resolve(String(args.fg));
    try {
      const text = (await fs.readFile(fgPath)).toString('utf8');
      if (!/\.svg$/i.test(fgPath) && !text.trimStart().startsWith('<svg')) throw new Error('not an SVG file');
      fgVector = svgToVectorDrawable(text, { sizeDp: 108, fit: FIT });
      monoVector = svgToVectorDrawable(text, { sizeDp: 108, fit: FIT, monochrome: true });
      for (const w of new Set([...fgVector.warnings, ...monoVector.warnings])) console.warn(`[vector] ${w}`);
      console.log(`[android] foreground → VectorDrawable (${fgVector.paths} paths)`);
    } catch (e) {
      vectorNote = e.message;
      fgVector = null;
      monoVector = null;
      console.warn(`[android] vector conversion skipped (${e.message}) → bitmap drawable fallback`);
    }
  }

  // average corner colour → default adaptive background
  let cornerBg = '#0B1220';
  {
    const { data, info } = await sharp(master).resize(16, 16, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pick = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    const pts = [pick(1, 1), pick(14, 1), pick(1, 14), pick(14, 14)];
    const avg = [0, 1, 2].map((c) => pts.reduce((s, p) => s + p[c], 0) / pts.length);
    cornerBg = hex({ r: avg[0], g: avg[1], b: avg[2] });
  }
  if (bgSpec && /^#|^rgb/i.test(bgSpec)) cornerBg = bgSpec;

  const report = { name: NAME, createdAt: new Date().toISOString(), files: [], platforms: {} };
  const addFile = (rel, size, note = '') => report.files.push({ path: rel, bytes: size, note });

  /* --- 2. iOS ---------------------------------------------------- */
  const iosDir = 'ios/AppIcon.appiconset';
  let iosMaster = await sharp(master).flatten({ background: cornerBg }).removeAlpha().png().toBuffer();

  // dark + tinted appearance variants (iOS 18+)
  let darkMaster, tintedMaster;
  if (fgBuf) {
    const darkBgSpec = args['dark-bg'] ? String(args['dark-bg'])
      : (bgSpec && /^#|^rgb/i.test(bgSpec) ? darken(cornerBg, 0.5) : bgSpec);
    const darkBg = darkBgSpec ? await renderBackground(darkBgSpec, 1024) : null;
    const base = darkBg || (await sharp(master).modulate({ brightness: 0.55 }).png().toBuffer());
    darkMaster = await sharp(base).composite([{ input: fgBuf, gravity: 'centre' }])
      .flatten({ background: darken(cornerBg, 0.4) }).removeAlpha().png().toBuffer();
  } else {
    darkMaster = await sharp(master).modulate({ brightness: 0.6, saturation: 0.85 })
      .flatten({ background: darken(cornerBg, 0.4) }).removeAlpha().png().toBuffer();
  }
  tintedMaster = await sharp(await sharp(master).grayscale().linear(1.18, -22).png().toBuffer())
    .flatten({ background: '#111111' }).removeAlpha().png().toBuffer();

  const iosManifest = [];
  if (want('ios')) {
    for (const s of IOS) {
      const name = `icon-${s.idiom}-${s.size}@${s.scale}.png`;
      const buf = await pngNoAlpha(iosMaster, s.px, cornerBg);
      await write(`${iosDir}/${name}`, buf);
      addFile(`${iosDir}/${name}`, buf.length, `${s.px}x${s.px}`);
      iosManifest.push({ filename: name, idiom: s.idiom, scale: s.scale, size: s.size });
    }
    // Apple rejects any alpha channel: flatten + removeAlpha above guarantees RGB.
    const contents = {
      images: iosManifest,
      info: { author: 'xcode', version: 1 },
    };
    await write(`${iosDir}/Contents.json`, Buffer.from(JSON.stringify(contents, null, 2)));
    report.platforms.ios = { appiconset: `${iosDir}/Contents.json`, images: iosManifest.length };

    // Xcode 14+ single-size catalog (optional drop-in)
    const uniDir = 'ios/AppIcon-Universal.appiconset';
    const uni = [];
    for (const [kind, buf] of [['', iosMaster], ['-dark', darkMaster], ['-tinted', tintedMaster]]) {
      const name = `icon-1024${kind}.png`;
      const out = await pngNoAlpha(buf, 1024, cornerBg);
      await write(`${uniDir}/${name}`, out);
      addFile(`${uniDir}/${name}`, out.length, '1024x1024');
    }
    uni.push({ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' });
    uni.push({ appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'icon-1024-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' });
    uni.push({ appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'icon-1024-tinted.png', idiom: 'universal', platform: 'ios', size: '1024x1024' });
    await write(`${uniDir}/Contents.json`, Buffer.from(JSON.stringify({ images: uni, info: { author: 'xcode', version: 1 } }, null, 2)));
    report.platforms.ios.universal = `${uniDir}/Contents.json`;
  }

  /* --- 3. Android ------------------------------------------------ */
  const adaptiveSrc = fgBuf || master;
  const bgGradient = bgSpec ? parseGradient(bgSpec) : null;
  const bgIsImage = !!(bgSpec && !bgGradient && !/^#|^rgb/i.test(bgSpec));
  const solidBg = args.fg && bgSpec && /^#|^rgb/i.test(bgSpec) ? bgSpec : cornerBg;

  if (want('android')) {
    const res = 'android/app/src/main/res';
    const DRAWABLE = `${res}/drawable`;
    const NODPI = `${res}/drawable-nodpi`;
    const cleaned = await cleanAndroidRes(res);

    for (const d of ANDROID) {
      // API < 26 only needs the two legacy bitmaps — adaptive layers are XML below
      const sq = await pngRGBA(iosMaster, d.legacy);
      const rounded = await maskShape(sq, d.legacy, SHAPE);
      await write(`${res}/mipmap-${d.name}/ic_launcher.png`, rounded);
      addFile(`${res}/mipmap-${d.name}/ic_launcher.png`, rounded.length, `${d.legacy}x${d.legacy}`);

      const round = await maskShape(await pngRGBA(iosMaster, d.legacy), d.legacy, 'circle');
      await write(`${res}/mipmap-${d.name}/ic_launcher_round.png`, round);
      addFile(`${res}/mipmap-${d.name}/ic_launcher_round.png`, round.length, `${d.legacy}x${d.legacy}`);
    }

    // ---- adaptive layers: res/drawable/*.xml ----------------------
    // foreground
    if (fgVector) {
      await write(`${DRAWABLE}/ic_launcher_foreground.xml`, Buffer.from(fgVector.xml));
      addFile(`${DRAWABLE}/ic_launcher_foreground.xml`, Buffer.byteLength(fgVector.xml), `vector ${fgVector.paths} paths`);
    } else {
      const art = await placeFit(adaptiveSrc, 432, FIT);
      await write(`${NODPI}/ic_launcher_foreground_img.png`, art);
      addFile(`${NODPI}/ic_launcher_foreground_img.png`, art.length, '432x432 bitmap fallback');
      const xml = bitmapDrawable('ic_launcher_foreground_img');
      await write(`${DRAWABLE}/ic_launcher_foreground.xml`, Buffer.from(xml));
      addFile(`${DRAWABLE}/ic_launcher_foreground.xml`, Buffer.byteLength(xml), 'bitmap drawable');
    }

    // monochrome (Android 13+ themed icons)
    let hasMono = false;
    if (monoVector) {
      await write(`${DRAWABLE}/ic_launcher_monochrome.xml`, Buffer.from(monoVector.xml));
      addFile(`${DRAWABLE}/ic_launcher_monochrome.xml`, Buffer.byteLength(monoVector.xml), 'vector silhouette');
      hasMono = true;
    } else if (fgBuf) {
      const mono = await monochrome(fgBuf, 432, FIT);
      await write(`${NODPI}/ic_launcher_monochrome_img.png`, mono);
      addFile(`${NODPI}/ic_launcher_monochrome_img.png`, mono.length, '432x432 bitmap fallback');
      const xml = bitmapDrawable('ic_launcher_monochrome_img');
      await write(`${DRAWABLE}/ic_launcher_monochrome.xml`, Buffer.from(xml));
      addFile(`${DRAWABLE}/ic_launcher_monochrome.xml`, Buffer.byteLength(xml), 'bitmap drawable');
      hasMono = true;
    } else {
      console.warn('[android] no monochrome layer — pass --fg <transparent svg/png> to enable themed icons');
    }

    // background
    if (bgGradient) {
      const xml = gradientBgDrawable(bgGradient);
      await write(`${DRAWABLE}/ic_launcher_background.xml`, Buffer.from(xml));
      addFile(`${DRAWABLE}/ic_launcher_background.xml`, Buffer.byteLength(xml), `vector gradient ${bgGradient.angle}°`);
    } else if (bgIsImage) {
      const bgPng = await renderBackground(bgSpec, 432);
      await write(`${NODPI}/ic_launcher_background_img.png`, bgPng);
      addFile(`${NODPI}/ic_launcher_background_img.png`, bgPng.length, '432x432 bitmap fallback');
      const xml = bitmapDrawable('ic_launcher_background_img');
      await write(`${DRAWABLE}/ic_launcher_background.xml`, Buffer.from(xml));
      addFile(`${DRAWABLE}/ic_launcher_background.xml`, Buffer.byteLength(xml), 'bitmap drawable');
    } else {
      const xml = solidBgDrawable(solidBg);
      await write(`${DRAWABLE}/ic_launcher_background.xml`, Buffer.from(xml));
      addFile(`${DRAWABLE}/ic_launcher_background.xml`, Buffer.byteLength(xml), `shape ${solidBg}`);
    }

    // ---- adaptive-icon manifest (mipmap-anydpi-v26 → @drawable/*) --
    const monoLine = hasMono ? '\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>' : '';
    const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>${monoLine}
</adaptive-icon>
`;
    await write(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, Buffer.from(adaptiveXml));
    await write(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, Buffer.from(adaptiveXml));
    addFile(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, Buffer.byteLength(adaptiveXml), 'adaptive icon');
    addFile(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, Buffer.byteLength(adaptiveXml), 'adaptive icon');

    // Play Store listing icon: 512x512, 32-bit PNG, <= 1MB
    const store = await pngRGBA(iosMaster, 512);
    if (store.length > 1024 * 1024) throw new Error('Play Store icon exceeds 1MB');
    await write('android/play-store-icon-512.png', store);
    addFile('android/play-store-icon-512.png', store.length, '512x512');

    report.platforms.android = {
      res,
      densities: ANDROID.length,
      adaptive: fgVector ? 'vector' : 'bitmap',
      background: bgGradient ? 'gradient-vector' : bgIsImage ? 'bitmap' : 'solid-shape',
      monochrome: hasMono,
      fallbackReason: vectorNote || undefined,
      cleanedPrevBuild: cleaned,
    };
  }

  /* --- 4. web / PWA ---------------------------------------------- */
  if (want('web')) {
    const web = 'web';
    const sizes = [16, 32, 48, 96, 192, 512];
    const icoEntries = [];
    for (const s of sizes) {
      const buf = await pngRGBA(iosMaster, s);
      await write(`${web}/icon-${s}.png`, buf);
      if (s <= 48) icoEntries.push({ size: s, buf });
    }
    const touch = await pngNoAlpha(iosMaster, 180, cornerBg);
    await write(`${web}/apple-touch-icon-180.png`, touch);
    const maskable = await pngRGBA(await placeFit(iosMaster, 512, 0.8), 512);
    await write(`${web}/icon-512-maskable.png`, maskable);
    await write(`${web}/favicon.ico`, buildIco(icoEntries.reverse()));
    const manifest = {
      name: NAME,
      short_name: NAME,
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    await write(`${web}/manifest.webmanifest`, Buffer.from(JSON.stringify(manifest, null, 2)));
    report.platforms.web = { icons: sizes.length + 2 };
  }

  /* --- 5. source + previews + docs -------------------------------- */
  await write('source/master-1024.png', await pngRGBA(master, 1024));
  if (fgBuf) await write('source/foreground-1024.png', fgBuf);
  for (const f of [args.master, args.fg].filter(Boolean)) {
    const buf = await fs.readFile(path.resolve(String(f)));
    await write(`source/${path.basename(String(f))}`, buf);
  }
  await write('source/icon-spec.json', Buffer.from(JSON.stringify(report, null, 2)));

  await writePreview(iosMaster, report, cornerBg);
  await write('preview.html', Buffer.from(previewHtml(report, cornerBg)));
  await write('README.md', Buffer.from(readme(report, cornerBg)));
  if (args.zip !== false && args['no-zip'] !== true) {
    const zipPath = await zipPack();
    console.log(`\nZIP: ${zipPath}`);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${secs}s — ${report.files.length} assets → ${OUT}`);
  console.log(JSON.stringify(report.platforms, null, 2));
}

/* ------------------------------------------------------------------ */
/* ico                                                                 */
/* ------------------------------------------------------------------ */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);
    dir.writeUInt8(0, b + 2); dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4); dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(e.buf.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

/* ------------------------------------------------------------------ */
/* previews                                                            */
/* ------------------------------------------------------------------ */
async function writePreview(master, report, bg) {
  const b64 = (await pngRGBA(master, 512)).toString('base64');
  const img = (x, y, size, radius) =>
    `<g transform="translate(${x},${y})">
       <defs><clipPath id="c${x}${y}"><rect width="${size}" height="${size}" rx="${radius.toFixed(1)}"/></clipPath></defs>
       <image href="data:image/png;base64,${b64}" width="${size}" height="${size}" clip-path="url(#c${x}${y})"/>
       <rect width="${size}" height="${size}" rx="${radius.toFixed(1)}" fill="none" stroke="#00000012"/>
     </g>`;
  const label = (x, y, s, text) =>
    `<text x="${x + s / 2}" y="${y}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial" font-size="10" fill="#6B7280">${text}</text>`;

  let row = '', x = 80;
  const iosY = 296;
  iosSizesPreview.forEach((s) => {
    row += img(x, iosY, s, s * 0.2237);
    row += label(x, iosY + s + 18, s, `${s}`);
    x += s + 36;
  });
  let andRow = ''; x = 80;
  const andY = 580;
  androidSizesPreview.forEach((s) => {
    andRow += img(x, andY, s, s * 0.18);
    andRow += label(x, andY + s + 18, s, `${s}`);
    x += s + 40;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="872" viewBox="0 0 1240 872">
    <rect width="1240" height="872" fill="#F6F7F9"/>
    <text x="80" y="88" font-family="Segoe UI, Helvetica, Arial" font-size="34" font-weight="700" fill="#111827">${escapeXml(NAME)}</text>
    <text x="80" y="120" font-family="Segoe UI, Helvetica, Arial" font-size="14" fill="#6B7280">App icon asset pack · iOS + Android + Web · ${report.files.length} files</text>
    <g transform="translate(920,60)">
      <rect width="240" height="240" rx="22" fill="#fff" stroke="#E5E7EB"/>
      <g><defs><clipPath id="hero"><rect x="20" y="20" width="200" height="200" rx="44"/></clipPath></defs>
      <image href="data:image/png;base64,${b64}" x="20" y="20" width="200" height="200" clip-path="url(#hero)"/></g>
    </g>
    <text x="80" y="272" font-family="Segoe UI, Helvetica, Arial" font-size="12" font-weight="600" fill="#374151">iOS — AppIcon.appiconset (system squircle mask)</text>
    ${row}
    <text x="80" y="556" font-family="Segoe UI, Helvetica, Arial" font-size="12" font-weight="600" fill="#374151">Android — legacy ic_launcher (rounded mask)</text>
    ${andRow}
    <g transform="translate(80,836)" font-family="Segoe UI, Helvetica, Arial">
      <rect width="14" height="14" rx="3" fill="${bg}"/>
      <text x="22" y="11" font-size="11" fill="#6B7280">background ${bg}</text>
      <text x="220" y="11" font-size="11" fill="#6B7280">generated by app-icon-maker</text>
    </g>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await write('preview.png', png);
}
const iosSizesPreview = [180, 120, 87, 60, 40, 29, 20];
const androidSizesPreview = [192, 144, 96, 72, 48];

const escapeXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function previewHtml(report, bg) {
  const ios = report.files.filter((f) => f.path.startsWith('ios/AppIcon.appiconset/icon-'));
  const and = report.files.filter((f) => /ic_launcher(_round)?\.png$/.test(f.path));
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(NAME)} — Icon Pack</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--line:#e5e7eb;--tx:#111827;--mut:#6b7280;--accent:#4f46e5}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.6 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:48px 24px 80px}
  h1{font-size:32px;margin:0 0 6px;letter-spacing:-.02em}
  .sub{color:var(--mut);margin-bottom:32px}
  .hero{display:flex;gap:28px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px;margin-bottom:36px}
  .hero img{width:120px;height:120px;border-radius:27px;box-shadow:0 8px 24px rgba(0,0,0,.12)}
  .hero .meta{display:flex;gap:28px;flex-wrap:wrap;color:var(--mut);font-size:13px}
  h2{font-size:16px;margin:36px 0 14px;display:flex;align-items:center;gap:10px}
  h2 span{font:500 12px/1 monospace;color:var(--mut)}
  .grid{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-end}
  .item{text-align:center;color:var(--mut);font-size:11px}
  .item img{display:block;background:#fff;border:1px solid var(--line);image-rendering:auto}
  .sq img{border-radius:22.37%}
  .rd img{border-radius:50%}
  code{background:#eef2ff;color:#4338ca;padding:2px 6px;border-radius:5px;font-size:12px}
</style></head>
<body><div class="wrap">
  <h1>${escapeXml(NAME)}</h1>
  <div class="sub">App icon asset pack · 背景色 <code>${bg}</code> · ${report.files.length} 个文件</div>
  <div class="hero">
    <img src="ios/AppIcon-Universal.appiconset/icon-1024.png" alt="icon">
    <div class="meta">
      <div>iOS：${report.platforms.ios?.images ?? 0} 张 AppIcon + 单尺寸 1024 三态</div>
      <div>Android：drawable 三层矢量 + 5 密度传统位图</div>
      <div>Web/PWA：favicon + manifest</div>
    </div>
  </div>

  <h2>iOS <span>AppIcon.appiconset</span></h2>
  <div class="grid sq">
    ${ios.map((f) => `<div class="item"><img src="${f.path}" width="${Math.min(f.bytes && 96, 96)}" height="96"><div>${f.note}</div></div>`).join('')}
  </div>

  <h2>Android <span>mipmap-*</span></h2>
  <div class="grid rd">
    ${and.map((f) => `<div class="item"><img src="${f.path}" width="${Math.min(parseInt(f.note) || 48, 96)}"><div>${f.note}</div></div>`).join('')}
  </div>
</div></body></html>`;
}

/* ------------------------------------------------------------------ */
/* readme                                                              */
/* ------------------------------------------------------------------ */
function readme(report, bg) {
  const and = report.platforms.android;
  const bitmapLayers = and ? [and.adaptive === 'bitmap' ? '前景' : null, and.background === 'bitmap' ? '背景' : null].filter(Boolean) : [];
  const bitmapNote = bitmapLayers.length
    ? `\n> ${bitmapLayers.join('、')}层是**位图 drawable**（${and.fallbackReason || '输入为位图'}），素材在 \`drawable-nodpi/\`，XML 只是包装。想要真正可缩放的矢量，用 \`--fg\` 传 SVG。\n`
    : '';
  return `# ${NAME} — App 图标资源包

由 **app-icon-maker** 生成 · ${new Date(report.createdAt).toISOString().slice(0, 10)} · 主色背景 \`${bg}\`

## 目录结构

\`\`\`
${SLUG}-icon-pack/
├── ios/
│   ├── AppIcon.appiconset/          # 传统全尺寸（iPhone + iPad + 1024），Xcode 全版本可用
│   └── AppIcon-Universal.appiconset/# Xcode 14+ 单尺寸 1024，含 dark / tinted 外观
├── android/
│   ├── app/src/main/res/
│   │   ├── drawable/                # ic_launcher_background / _foreground / _monochrome（自适应图标三层）
│   │   ├── mipmap-mdpi … xxxhdpi/   # 仅 ic_launcher.png + ic_launcher_round.png（API < 26 传统图标）
│   │   └── mipmap-anydpi-v26/       # ic_launcher.xml / ic_launcher_round.xml，引用 @drawable/*
│   └── play-store-icon-512.png      # Google Play 商店图标
├── web/                             # favicon.ico / apple-touch-icon / manifest
├── source/                          # 1024 母版 + 设计源文件 + icon-spec.json
├── preview.png / preview.html       # 效果预览
└── README.md
\`\`\`
${bitmapNote ? `${bitmapNote}\n` : '\n'}## iOS 接入

**方式 A（推荐，Xcode 14+ / iOS 26 兼容）**

1. 打开 \`Assets.xcassets\` → 选中 \`AppIcon\`
2. 右侧属性检查器把 **Single Size** 勾上
3. 把 \`ios/AppIcon-Universal.appiconset/\` 里的 \`icon-1024.png\`、\`icon-1024-dark.png\`、\`icon-1024-tinted.png\` 拖入对应槽位（或直接整包替换 \`AppIcon.appiconset\`）

**方式 B（兼容老版本 Xcode）**

删除工程内 \`AppIcon.appiconset\`，把本包的 \`ios/AppIcon.appiconset\` 整个拖进 \`Assets.xcassets\`。

> 图标已去除 alpha 通道、未预烘焙圆角 —— iOS 自动裁切 squircle，不要自己加圆角。
> iOS 26 Liquid Glass 若要分层光影，用 Xcode 26 的 Icon Composer 打开 \`source/\` 里的分层素材导出 \`.icon\`；不导出也能正常上架（系统按传统图标渲染）。

## Android 接入

把 \`android/app/src/main/res/\` 下的目录整体合并进工程同名目录（Flutter / RN / Capacitor 都是 \`android/app/src/main/res/\`）。

\`AndroidManifest.xml\` 无需改动，只要 \`android:icon="@mipmap/ic_launcher"\` 与 \`android:roundIcon="@mipmap/ic_launcher_round"\`。

- **自适应图标（API 26+）**：\`mipmap-anydpi-v26/ic_launcher.xml\` 只负责组合，三层素材都在 \`res/drawable/\`：
  - \`ic_launcher_background.xml\` — 纯色 \`<shape>\` 或渐变 \`<vector>\`（角度精确，不做 45° 量化）
  - \`ic_launcher_foreground.xml\` — 108dp 矢量前景，内容位于中央 72dp 安全区（本包按 ${(FIT * 100).toFixed(0)}% 摆放）
  - \`ic_launcher_monochrome.xml\` — Android 13+ 主题图标轮廓，系统自动上色
- **传统图标（API < 26）**：\`mipmap-mdpi … xxxhdpi\` 里只有 \`ic_launcher.png\` 与 \`ic_launcher_round.png\`，不再有分块的前景/背景位图
- **Play 商店**：\`play-store-icon-512.png\`（512×512，32-bit PNG，< 1MB）

改配色直接编辑 \`drawable/ic_launcher_background.xml\` 即可，不需要重新导出位图。

## Web / PWA

\`\`\`html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<link rel="manifest" href="/manifest.webmanifest">
\`\`\`

## 校验

\`\`\`bash
node <skill>/scripts/verify.mjs ${OUT}
\`\`\`

## 备注

- 所有位图均由 1024 母版以 Lanczos3 重采样，不是放大糊图。
- \`source/icon-spec.json\` 记录每个文件的尺寸与用途，可用于 CI 断言。
- 若需改配色/符号，修改 \`source/\` 里的源文件后用同一命令重新生成即可。
`;
}

/* ------------------------------------------------------------------ */
/* zip                                                                 */
/* ------------------------------------------------------------------ */
async function zipPack() {
  const zipPath = path.join(path.dirname(OUT), `${SLUG}-icon-pack.zip`);
  const output = (await import('node:fs')).createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const done = new Promise((res, rej) => { output.on('close', res); archive.on('error', rej); });
  archive.pipe(output);
  archive.directory(OUT, `${SLUG}-icon-pack`);
  await archive.finalize();
  await done;
  return zipPath;
}

await main().catch((e) => { console.error('BUILD FAILED:', e.message); process.exit(1); });

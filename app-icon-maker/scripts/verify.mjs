#!/usr/bin/env node
/**
 * verify.mjs — assert an icon pack against platform requirements.
 *   node scripts/verify.mjs ./icon-pack
 * Exit code 0 = all pass, 1 = at least one hard failure.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const DIR = path.resolve(process.argv[2] || './icon-pack');
const IOS_EXPECT = {
  'icon-iphone-20x20@2x.png': 40, 'icon-iphone-20x20@3x.png': 60,
  'icon-iphone-29x29@2x.png': 58, 'icon-iphone-29x29@3x.png': 87,
  'icon-iphone-40x40@2x.png': 80, 'icon-iphone-40x40@3x.png': 120,
  'icon-iphone-60x60@2x.png': 120, 'icon-iphone-60x60@3x.png': 180,
  'icon-ipad-20x20@1x.png': 20, 'icon-ipad-20x20@2x.png': 40,
  'icon-ipad-29x29@1x.png': 29, 'icon-ipad-29x29@2x.png': 58,
  'icon-ipad-40x40@1x.png': 40, 'icon-ipad-40x40@2x.png': 80,
  'icon-ipad-76x76@1x.png': 76, 'icon-ipad-76x76@2x.png': 152,
  'icon-ipad-83.5x83.5@2x.png': 167, 'icon-ios-marketing-1024x1024@1x.png': 1024,
};
const ANDROID_EXPECT = {
  mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192,
};
const RES = 'android/app/src/main/res';

/** crude but effective: reject soup that aapt would choke on */
function xmlSanity(text) {
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const tags = [...stripped.matchAll(/<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g)];
  if (!tags.length) return 'no tags found';
  let depth = 0;
  for (const t of tags) {
    if (t[1] === '/') depth--;
    else if (!t[4]) depth++;
    if (depth < 0) return `unexpected </${t[2]}>`;
  }
  return depth === 0 ? null : `${depth} unclosed tag(s)`;
}

const results = [];
const check = (ok, level, label, detail = '') => {
  results.push({ ok, level, label, detail });
  const mark = ok ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ' — ' + detail : ''}`);
};

async function meta(p) {
  const m = await sharp(p).metadata();
  return { w: m.width, h: m.height, alpha: m.hasAlpha, channels: m.channels, size: (await fs.stat(p)).size };
}

const exists = (p) => fs.access(path.join(DIR, p)).then(() => true, () => false);

async function main() {
  const hasIos = await exists('ios');
  const hasAndroid = await exists('android');

  const iosDir = path.join(DIR, 'ios/AppIcon.appiconset');
  let contents;
  if (!hasIos) check(false, 'warn', 'iOS assets', 'skipped (platform-limited build)');
  else {
    try { contents = JSON.parse(await fs.readFile(path.join(iosDir, 'Contents.json'), 'utf8')); }
    catch { check(false, 'error', 'iOS Contents.json exists'); }
  }

  if (contents) {
    const files = new Set();
    for (const img of contents.images) {
      const f = path.join(iosDir, img.filename);
      files.add(img.filename);
      try {
        const m = await meta(f);
        const [w, h] = img.size.split('x').map(Number);
        const scale = Number(img.scale.replace('x', ''));
        const expect = Math.round(w * scale);
        check(m.w === expect && m.h === expect, 'error', `iOS ${img.filename}`, `${m.w}x${m.h} (expected ${expect})`);
        // App Store requires an opaque icon (no alpha channel) for every slot
        check(m.alpha === false || m.channels === 3, 'error', `iOS ${img.filename} opaque`, `channels=${m.channels}`);
        if (img.idiom === 'ios-marketing') {
          check(m.size <= 1024 * 1024 * 5, 'warn', 'iOS 1024 size', `${(m.size / 1024 / 1024).toFixed(2)} MB`);
        }
      } catch {
        check(false, 'error', `iOS ${img.filename} readable`);
      }
    }
    const missing = Object.keys(IOS_EXPECT).filter((f) => !files.has(f));
    check(missing.length === 0, 'error', 'iOS full size matrix', missing.length ? `missing ${missing.join(', ')}` : `${files.size} images`);
  }

  /* ---- Android ------------------------------------------------ */
  if (!hasAndroid) {
    check(false, 'warn', 'Android assets', 'skipped (platform-limited build)');
  } else {
  // 1. legacy bitmaps: exactly ic_launcher.png + ic_launcher_round.png per density
  const ALLOWED_DENSITY_FILES = new Set(['ic_launcher.png', 'ic_launcher_round.png']);
  for (const [d, px] of Object.entries(ANDROID_EXPECT)) {
    const base = path.join(DIR, `${RES}/mipmap-${d}`);
    for (const name of ALLOWED_DENSITY_FILES) {
      try {
        const m = await meta(path.join(base, name));
        check(m.w === px && m.h === px, 'error', `Android ${d}/${name}`, `${m.w}x${m.h} (expected ${px})`);
      } catch { check(false, 'error', `Android ${d}/${name} exists`); }
    }
    try {
      const entries = (await fs.readdir(base)).filter((f) => !f.startsWith('.'));
      const extra = entries.filter((f) => !ALLOWED_DENSITY_FILES.has(f));
      check(extra.length === 0, 'error', `mipmap-${d} only keeps the 2 legacy bitmaps`,
        extra.length ? `unexpected ${extra.join(', ')}` : `${entries.length} files`);
    } catch { /* reported above */ }
  }

  // 2. adaptive layers live in res/drawable as XML
  const DRAWABLES = {
    'ic_launcher_background.xml': 'error',
    'ic_launcher_foreground.xml': 'error',
    'ic_launcher_monochrome.xml': 'warn',
  };
  for (const [name, level] of Object.entries(DRAWABLES)) {
    const p = path.join(DIR, `${RES}/drawable/${name}`);
    try {
      const xml = await fs.readFile(p, 'utf8');
      const root = (xml.match(/<([a-z-]+)[\s>]/g) || []).filter((t) => !t.startsWith('<?'));
      const kind = (root[0] || '').replace(/[<\s>]/g, '');
      if (!['vector', 'shape', 'bitmap', 'layer-list', 'ripple'].includes(kind)) {
        check(false, 'error', `drawable/${name}`, `unexpected root <${kind}>`);
        continue;
      }
      const problem = xmlSanity(xml);
      check(!problem, 'error', `drawable/${name} well-formed`, problem || `${kind}, ${xml.length} bytes`);
      if (kind === 'vector') {
        const vw = (xml.match(/android:viewportWidth="([\d.]+)"/) || [])[1];
        check(vw === '108', 'warn', `drawable/${name} viewport`, `viewportWidth=${vw}`);
        check(/android:pathData="/.test(xml), 'error', `drawable/${name} has geometry`);
      }
      if (/aapt:attr/.test(xml)) {
        check(/xmlns:aapt=/.test(xml), 'error', `drawable/${name} declares xmlns:aapt`);
      }
    } catch {
      if (level === 'warn') check(false, 'warn', `drawable/${name}`, 'absent (no monochrome layer)');
      else check(false, 'error', `drawable/${name}`, 'missing');
    }
  }

  // 3. adaptive-icon manifests must point at @drawable/*, never @mipmap/ic_launcher_*
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const p = path.join(DIR, `${RES}/mipmap-anydpi-v26/${f}`);
    try {
      const xml = await fs.readFile(p, 'utf8');
      check(/@drawable\/ic_launcher_background/.test(xml), 'error', `anydpi-v26/${f} background → @drawable`);
      check(/@drawable\/ic_launcher_foreground/.test(xml), 'error', `anydpi-v26/${f} foreground → @drawable`);
      check(!/@mipmap\/ic_launcher_(foreground|background|monochrome)/.test(xml), 'error',
        `anydpi-v26/${f} has no @mipmap layer refs`);
    } catch { check(false, 'error', `anydpi-v26/${f} exists`); }
  }

  // 4. values/ic_launcher_background.xml is obsolete once the colour lives in a drawable
  try {
    await fs.access(path.join(DIR, `${RES}/values/ic_launcher_background.xml`));
    check(false, 'warn', 'values/ic_launcher_background.xml', 'leftover colour resource (background now in drawable/)');
  } catch { /* clean */ }

  // 5. Play Store icon
  try {
    const store = await meta(path.join(DIR, 'android/play-store-icon-512.png'));
    check(store.w === 512 && store.h === 512, 'error', 'Play Store icon dims', `${store.w}x${store.h}`);
    check(store.size <= 1024 * 1024, 'error', 'Play Store icon <= 1MB', `${(store.size / 1024).toFixed(0)} KB`);
  } catch { check(false, 'error', 'android/play-store-icon-512.png', 'missing'); }
  }

  const fails = results.filter((r) => !r.ok && r.level === 'error').length;
  const warns = results.filter((r) => !r.ok && r.level === 'warn').length;
  console.log(`\n${results.length - fails - warns} passed, ${warns} warnings, ${fails} failures`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

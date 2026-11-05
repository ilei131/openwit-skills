#!/usr/bin/env node
/**
 * svg-to-vector.mjs — convert a foreground SVG into an Android VectorDrawable.
 *
 * Why: modern Android icon sets ship adaptive layers as `res/drawable/*.xml`
 * vectors instead of per-density PNGs. Vectors are resolution-free, ~1–3 KB, and
 * can be tinted/recolored by the system (needed for monochrome/themed icons).
 *
 * Scope: the subset of SVG that icon art actually uses — path / rect / circle /
 * ellipse / line / polygon / polyline, <g> with transforms, presentation
 * attributes + style="", fill-rule, opacity, linear/radial gradients.
 * Anything outside that (filters, masks, patterns, <use>, <text>, CSS <style>
 * blocks, clip-path) throws SvgUnsupported so the caller can fall back to a
 * bitmap drawable instead of shipping a broken vector.
 *
 * All transforms (including skew) are baked into the path coordinates, and arcs
 * are converted to cubics, so the output only ever contains M/L/C/Q/Z.
 */
import fs from 'node:fs/promises';

export class SvgUnsupported extends Error {}

/* tag names are lower-cased by the parser — keep these sets lower-case too */
const UNSUPPORTED_TAGS = new Set([
  'image', 'text', 'tspan', 'textpath', 'foreignobject', 'filter', 'fegaussianblur',
  'mask', 'pattern', 'use', 'symbol', 'switch', 'marker', 'style', 'script',
  'animate', 'animatetransform', 'animatemotion', 'mpath',
]);
const SKIP_TAGS = new Set([
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title', 'desc',
  'metadata', 'sodipodi:namedview', 'namedview',
]);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']);
const CONTAINERS = new Set(['svg', 'g', 'a']);

/* ------------------------------------------------------------------ */
/* shapes / colors                                                     */
/* ------------------------------------------------------------------ */
const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  silver: '#c0c0c0', gray: '#808080', grey: '#808080', maroon: '#800000', olive: '#808000',
  green: '#008000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500',
  pink: '#ffc0cb', gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', brown: '#a52a2a',
};

function parseColor(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return s === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : null;
  if (NAMED_COLORS[s]) return parseColor(NAMED_COLORS[s]);
  if (s === 'currentcolor') return { r: 0, g: 0, b: 0, a: 1 };
  const rgbMatch = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,\s/]+/).filter(Boolean).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    return { r, g, b, a: Number.isFinite(a) ? a : 1 };
  }
  let h = s.replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const argb = (c, alpha = 1) => {
  const to = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${to(clamp01(alpha) * 255)}${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
};

/* ------------------------------------------------------------------ */
/* xml                                                                 */
/* ------------------------------------------------------------------ */
const decodeEntities = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, g) => {
  if (g === 'lt') return '<';
  if (g === 'gt') return '>';
  if (g === 'amp') return '&';
  if (g === 'quot') return '"';
  if (g === 'apos') return "'";
  const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : m;
});

function parseAttrs(str) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  return attrs;
}

function parseXml(text) {
  const clean = String(text)
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  while (i < clean.length) {
    const lt = clean.indexOf('<', i);
    if (lt < 0) break;
    const gt = clean.indexOf('>', lt);
    if (gt < 0) break;
    const raw = clean.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!raw || raw.startsWith('!')) continue;
    if (raw.startsWith('/')) { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = body.match(/^([\w:.-]+)([\s\S]*)$/);
    if (!m) continue;
    const node = { name: m[1].toLowerCase(), attrs: parseAttrs(m[2]), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/* ------------------------------------------------------------------ */
/* 2d matrix  [a, b, c, d, e, f]  →  x' = a·x + c·y + e, y' = b·x + d·y + f */
/* ------------------------------------------------------------------ */
const IDENTITY = [1, 0, 0, 1, 0, 0];

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const applyM = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

function parseTransform(str) {
  if (!str) return IDENTITY;
  let out = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const v = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t = null;
    switch (m[1]) {
      case 'matrix': if (v.length >= 6) t = v.slice(0, 6); break;
      case 'translate': t = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
      case 'scale': t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = ((v[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        const r = [cos, sin, -sin, cos, 0, 0];
        if (v.length >= 3) {
          const [cx, cy] = [v[1], v[2]];
          t = mul(mul([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
        } else t = r;
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: break;
    }
    if (t) out = mul(out, t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* path data → normalized command list (M/L/C/Q/Z, absolute)           */
/* ------------------------------------------------------------------ */
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenizePath(d) {
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) {
    if (m[1]) tokens.push({ cmd: m[1] });
    else tokens.push({ num: Number(m[2]) });
  }
  return tokens;
}

/** SVG elliptical arc → cubic segments [c1x,c1y,c2x,c2y,x,y] */
function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  const line = () => [[x1 + (x2 - x1) / 3, y1 + (y2 - y1) / 3, x1 + (2 * (x2 - x1)) / 3, y1 + (2 * (y2 - y1)) / 3, x2, y2]];
  if (Math.abs(x1 - x2) < 1e-12 && Math.abs(y1 - y2) < 1e-12) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return line();

  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dxh = (x1 - x2) / 2, dyh = (y1 - y2) / 2;
  const x1p = cosP * dxh + sinP * dyh;
  const y1p = -sinP * dxh + cosP * dyh;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (!!largeArc === !!sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const angle = (ax, ay, bx, by) => {
    const dot = ax * bx + ay * by;
    const len = (Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1;
    return Math.acos(Math.min(1, Math.max(-1, dot / len))) * (ax * by - ay * bx < 0 ? -1 : 1);
  };
  const theta1 = angle(1, 0, ux, uy);
  let dtheta = angle(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / n;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  let th = theta1;
  for (let i = 0; i < n; i++) {
    const th2 = th + delta;
    const c1 = Math.cos(th), s1 = Math.sin(th), c2 = Math.cos(th2), s2 = Math.sin(th2);
    const last = i === n - 1;
    const p3x = last ? x2 : cx + rx * cosP * c2 - ry * sinP * s2;
    const p3y = last ? y2 : cy + rx * sinP * c2 + ry * cosP * s2;
    const d1x = -rx * cosP * s1 - ry * sinP * c1;
    const d1y = -rx * sinP * s1 + ry * cosP * c1;
    const d2x = -rx * cosP * s2 - ry * sinP * c2;
    const d2y = -rx * sinP * s2 + ry * cosP * c2;
    const p0x = cx + rx * cosP * c1 - ry * sinP * s1;
    const p0y = cy + rx * sinP * c1 + ry * cosP * s1;
    out.push([p0x + t * d1x, p0y + t * d1y, p3x - t * d2x, p3y - t * d2y, p3x, p3y]);
    th = th2;
  }
  return out;
}

function parsePathData(d) {
  if (!d) return [];
  const tokens = tokenizePath(d);
  const segs = [];
  let cur = null;
  for (const t of tokens) {
    if (t.cmd) { cur = { cmd: t.cmd, nums: [] }; segs.push(cur); }
    else if (cur) cur.nums.push(t.num);
    else throw new SvgUnsupported('path data must start with a command');
  }

  const cmds = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCubicCtrl = null, lastQuadCtrl = null;

  for (const seg of segs) {
    const C = seg.cmd.toUpperCase();
    const rel = seg.cmd !== C;
    if (C === 'Z') { cmds.push({ c: 'Z' }); cx = sx; cy = sy; lastCubicCtrl = lastQuadCtrl = null; continue; }
    const arity = ARITY[C];
    if (!arity) throw new SvgUnsupported(`unsupported path command "${seg.cmd}"`);
    if (!seg.nums.length || seg.nums.length % arity !== 0) throw new SvgUnsupported(`bad arguments for "${seg.cmd}"`);

    for (let k = 0; k < seg.nums.length; k += arity) {
      const v = seg.nums.slice(k, k + arity);
      const first = k === 0;
      if (C === 'M') {
        const x = rel ? cx + v[0] : v[0];
        const y = rel ? cy + v[1] : v[1];
        if (first) { cmds.push({ c: 'M', p: [x, y] }); sx = x; sy = y; }
        else cmds.push({ c: 'L', p: [x, y] });
        cx = x; cy = y; lastCubicCtrl = lastQuadCtrl = null;
      } else if (C === 'L' || C === 'H' || C === 'V') {
        let x = cx, y = cy;
        if (C === 'L') { x = rel ? cx + v[0] : v[0]; y = rel ? cy + v[1] : v[1]; }
        else if (C === 'H') x = rel ? cx + v[0] : v[0];
        else y = rel ? cy + v[0] : v[0];
        cmds.push({ c: 'L', p: [x, y] });
        cx = x; cy = y; lastCubicCtrl = lastQuadCtrl = null;
      } else if (C === 'C' || C === 'S') {
        let c1, c2, x, y;
        if (C === 'C') {
          c1 = [rel ? cx + v[0] : v[0], rel ? cy + v[1] : v[1]];
          c2 = [rel ? cx + v[2] : v[2], rel ? cy + v[3] : v[3]];
          x = rel ? cx + v[4] : v[4]; y = rel ? cy + v[5] : v[5];
        } else {
          c1 = lastCubicCtrl ? [2 * cx - lastCubicCtrl[0], 2 * cy - lastCubicCtrl[1]] : [cx, cy];
          c2 = [rel ? cx + v[0] : v[0], rel ? cy + v[1] : v[1]];
          x = rel ? cx + v[2] : v[2]; y = rel ? cy + v[3] : v[3];
        }
        cmds.push({ c: 'C', p: [...c1, ...c2, x, y] });
        lastCubicCtrl = c2; lastQuadCtrl = null; cx = x; cy = y;
      } else if (C === 'Q' || C === 'T') {
        let c1, x, y;
        if (C === 'Q') {
          c1 = [rel ? cx + v[0] : v[0], rel ? cy + v[1] : v[1]];
          x = rel ? cx + v[2] : v[2]; y = rel ? cy + v[3] : v[3];
        } else {
          c1 = lastQuadCtrl ? [2 * cx - lastQuadCtrl[0], 2 * cy - lastQuadCtrl[1]] : [cx, cy];
          x = rel ? cx + v[0] : v[0]; y = rel ? cy + v[1] : v[1];
        }
        cmds.push({ c: 'Q', p: [...c1, x, y] });
        lastQuadCtrl = c1; lastCubicCtrl = null; cx = x; cy = y;
      } else if (C === 'A') {
        const x = rel ? cx + v[5] : v[5];
        const y = rel ? cy + v[6] : v[6];
        for (const cubic of arcToCubics(cx, cy, v[0], v[1], v[2], !!v[3], !!v[4], x, y)) {
          cmds.push({ c: 'C', p: cubic });
        }
        cx = x; cy = y; lastCubicCtrl = lastQuadCtrl = null;
      }
    }
  }
  // drop empty / trailing junk
  return cmds.filter((c) => c.c === 'Z' || (c.p && c.p.every((n) => Number.isFinite(n))));
}

/* ------------------------------------------------------------------ */
/* shapes → commands (local user space)                                */
/* ------------------------------------------------------------------ */
const KAPPA = 0.5522847498307936;

function roundRectPath(x, y, w, h, rx, ry) {
  if (w <= 0 || h <= 0) return [];
  if (!rx && !ry) return [{ c: 'M', p: [x, y] }, { c: 'L', p: [x + w, y] }, { c: 'L', p: [x + w, y + h] }, { c: 'L', p: [x, y + h] }, { c: 'Z' }];
  rx = Math.min(rx || ry, w / 2);
  ry = Math.min(ry || rx, h / 2);
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { c: 'M', p: [x + rx, y] },
    { c: 'L', p: [x + w - rx, y] },
    { c: 'C', p: [x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry] },
    { c: 'L', p: [x + w, y + h - ry] },
    { c: 'C', p: [x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h] },
    { c: 'L', p: [x + rx, y + h] },
    { c: 'C', p: [x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry] },
    { c: 'L', p: [x, y + ry] },
    { c: 'C', p: [x, y + ry - ky, x + rx - kx, y, x + rx, y] },
    { c: 'Z' },
  ];
}

function ellipsePath(cx, cy, rx, ry) {
  if (rx <= 0 || ry <= 0) return [];
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [
    { c: 'M', p: [cx - rx, cy] },
    { c: 'C', p: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
    { c: 'C', p: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
    { c: 'C', p: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
    { c: 'C', p: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
    { c: 'Z' },
  ];
}

function shapeToCommands(node) {
  const a = node.attrs;
  const num = (key, dflt = 0) => {
    const raw = a[key];
    if (raw == null || raw === '') return dflt;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : dflt;
  };
  switch (node.name) {
    case 'path':
      if (!a.d) return [];
      return parsePathData(a.d);
    case 'rect':
      return roundRectPath(num('x'), num('y'), num('width'), num('height'), num('rx'), num('ry'));
    case 'circle':
      return ellipsePath(num('cx'), num('cy'), num('r'), num('r'));
    case 'ellipse':
      return ellipsePath(num('cx'), num('cy'), num('rx'), num('ry'));
    case 'line':
      return [{ c: 'M', p: [num('x1'), num('y1')] }, { c: 'L', p: [num('x2'), num('y2')] }];
    case 'polyline':
    case 'polygon': {
      const pts = String(a.points || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (pts.length < 4) return [];
      const cmds = [{ c: 'M', p: [pts[0], pts[1]] }];
      for (let i = 2; i + 1 < pts.length; i += 2) cmds.push({ c: 'L', p: [pts[i], pts[i + 1]] });
      if (node.name === 'polygon') cmds.push({ c: 'Z' });
      return cmds;
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* bbox                                                                */
/* ------------------------------------------------------------------ */
const emptyBox = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const addPt = (b, x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };

function addCubicToBox(b, x0, y0, x1, y1, x2, y2, x3, y3) {
  addPt(b, x0, y0); addPt(b, x3, y3);
  const extrema = (p0, p1, p2, p3) => {
    const A = -p0 + 3 * p1 - 3 * p2 + p3;
    const B = 2 * (p0 - 2 * p1 + p2);
    const C = p1 - p0;
    const ts = [];
    if (Math.abs(A) < 1e-9) { if (Math.abs(B) > 1e-9) ts.push(-C / B); }
    else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) { const r = Math.sqrt(disc); ts.push((-B + r) / (2 * A), (-B - r) / (2 * A)); }
    }
    return ts.filter((t) => t > 0 && t < 1);
  };
  const bez = (p0, p1, p2, p3, t) => {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
  };
  for (const t of extrema(x0, x1, x2, x3)) addPt(b, bez(x0, x1, x2, x3, t), bez(y0, y1, y2, y3, t));
  for (const t of extrema(y0, y1, y2, y3)) addPt(b, bez(x0, x1, x2, x3, t), bez(y0, y1, y2, y3, t));
}

function commandsBox(cmds) {
  const b = emptyBox();
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const c of cmds) {
    const p = c.p;
    if (c.c === 'M') { cx = p[0]; cy = p[1]; sx = cx; sy = cy; addPt(b, cx, cy); }
    else if (c.c === 'L') { cx = p[0]; cy = p[1]; addPt(b, cx, cy); }
    else if (c.c === 'C') { addCubicToBox(b, cx, cy, p[0], p[1], p[2], p[3], p[4], p[5]); cx = p[4]; cy = p[5]; }
    else if (c.c === 'Q') {
      // elevate quadratic to cubic
      addCubicToBox(b, cx, cy,
        cx + (2 / 3) * (p[0] - cx), cy + (2 / 3) * (p[1] - cy),
        p[2] + (2 / 3) * (p[0] - p[2]), p[3] + (2 / 3) * (p[1] - p[3]), p[2], p[3]);
      cx = p[2]; cy = p[3];
    } else if (c.c === 'Z') { cx = sx; cy = sy; }
  }
  return b;
}

/* ------------------------------------------------------------------ */
/* styles                                                             */
/* ------------------------------------------------------------------ */
const DEFAULT_STYLE = {
  fill: '#000000', fillOpacity: 1, fillRule: 'nonzero',
  stroke: 'none', strokeOpacity: 1, strokeWidth: 1,
  strokeLinecap: 'butt', strokeLinejoin: 'miter', strokeMiterLimit: 4,
};

const STYLE_PROPS = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'display', 'visibility', 'color']);

function parseStyleAttr(str) {
  const out = {};
  for (const part of String(str).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function mergeStyle(parent, node) {
  const decl = {};
  for (const [k, v] of Object.entries(node.attrs)) if (STYLE_PROPS.has(k)) decl[k] = v;
  if (node.attrs.style) Object.assign(decl, parseStyleAttr(node.attrs.style));
  const s = { ...parent };
  if (decl['color']) s.color = decl['color'];
  if (decl.fill !== undefined) s.fill = decl.fill;
  if (decl['fill-opacity'] !== undefined) s.fillOpacity = Number(decl['fill-opacity']);
  if (decl['fill-rule'] !== undefined) s.fillRule = decl['fill-rule'];
  if (decl.stroke !== undefined) s.stroke = decl.stroke;
  if (decl['stroke-opacity'] !== undefined) s.strokeOpacity = Number(decl['stroke-opacity']);
  if (decl['stroke-width'] !== undefined) { const v = parseFloat(decl['stroke-width']); if (Number.isFinite(v)) s.strokeWidth = v; }
  if (decl['stroke-linecap'] !== undefined) s.strokeLinecap = decl['stroke-linecap'];
  if (decl['stroke-linejoin'] !== undefined) s.strokeLinejoin = decl['stroke-linejoin'];
  if (decl['stroke-miterlimit'] !== undefined) { const v = parseFloat(decl['stroke-miterlimit']); if (Number.isFinite(v)) s.strokeMiterLimit = v; }
  s.hidden = decl.display === 'none' || decl.visibility === 'hidden';
  return s;
}

/* ------------------------------------------------------------------ */
/* gradients                                                           */
/* ------------------------------------------------------------------ */
function readStops(node) {
  const stops = [];
  for (const child of node.children) {
    if (child.name !== 'stop') continue;
    const offRaw = child.attrs.offset ?? '0';
    let offset = offRaw.endsWith('%') ? parseFloat(offRaw) / 100 : parseFloat(offRaw);
    if (!Number.isFinite(offset)) offset = 0;
    const st = child.attrs.style ? parseStyleAttr(child.attrs.style) : {};
    const color = parseColor(st['stop-color'] ?? child.attrs['stop-color'] ?? '#000000') || { r: 0, g: 0, b: 0, a: 1 };
    const opacity = Number(st['stop-opacity'] ?? child.attrs['stop-opacity'] ?? 1);
    stops.push({ offset: clamp01(offset), color, alpha: Number.isFinite(opacity) ? clamp01(opacity) : 1 });
  }
  return stops.sort((a, b) => a.offset - b.offset);
}

function gradientToAndroid(node, matrix, bbox, warnings) {
  const a = node.attrs;
  const stops = readStops(node);
  if (stops.length < 2) return null;
  const units = (a.gradientUnits || 'objectBoundingBox').trim();
  const isRadial = node.name === 'radialgradient';
  if (a.gradientTransform) warnings.add('gradientTransform ignored (approximate gradient)');

  const mapPt = (x, y) => (units === 'userSpaceOnUse' ? applyM(matrix, x, y) : [bbox.x0 + x * (bbox.x1 - bbox.x0), bbox.y0 + y * (bbox.y1 - bbox.y0)]);

  const items = stops.map((s) => `                <item android:offset="${round(s.offset)}" android:color="${argb(s.color, s.color.a * s.alpha)}"/>`).join('\n');

  let head;
  if (isRadial) {
    const f = (v, d) => { const n = parseFloat(a[v]); return Number.isFinite(n) ? n : d; };
    const [cx, cy] = mapPt(f('cx', 0.5), f('cy', 0.5));
    let r = f('r', 0.5);
    if (units === 'userSpaceOnUse') r *= scaleOf(matrix);
    else {
      const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
      r *= Math.sqrt((w * w + h * h) / 2);
    }
    if (!(r > 0.01)) return null;
    head = `            <gradient
                android:type="radial"
                android:centerX="${round(cx)}"
                android:centerY="${round(cy)}"
                android:gradientRadius="${round(r)}"
                android:tileMode="clamp">`;
  } else {
    const f = (v, d) => { const n = parseFloat(a[v]); return Number.isFinite(n) ? n : d; };
    const [x1, y1] = mapPt(f('x1', 0), f('y1', 0));
    const [x2, y2] = mapPt(f('x2', 1), f('y2', 0));
    if (Math.abs(x2 - x1) < 0.01 && Math.abs(y2 - y1) < 0.01) return null;
    head = `            <gradient
                android:type="linear"
                android:startX="${round(x1)}"
                android:startY="${round(y1)}"
                android:endX="${round(x2)}"
                android:endY="${round(y2)}"
                android:tileMode="clamp">`;
  }
  return `${head}\n${items}\n            </gradient>`;
}

/* ------------------------------------------------------------------ */
/* transform baked into commands                                       */
/* ------------------------------------------------------------------ */
function transformCommands(cmds, m) {
  return cmds.map((c) => {
    if (c.c === 'Z') return c;
    const p = c.p;
    const out = [];
    for (let i = 0; i < p.length; i += 2) {
      const [x, y] = applyM(m, p[i], p[i + 1]);
      out.push(x, y);
    }
    return { c: c.c, p: out };
  });
}

const round = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

function serializeCommands(cmds) {
  return cmds.map((c) => (c.c === 'Z' ? 'Z' : `${c.c} ${c.p.map(round).join(' ')}`)).join(' ');
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */
/**
 * @param {string} svgText
 * @param {{ sizeDp?: number, fit?: number, monochrome?: boolean }} opts
 *        fit: 0 = keep the artwork's own placement; 0.66 = scale the trimmed
 *        content to 66% of the canvas and centre it (adaptive safe zone).
 * @returns {{ xml: string, paths: number, warnings: string[] }}
 */
export function svgToVectorDrawable(svgText, opts = {}) {
  const sizeDp = Number(opts.sizeDp || 108);
  const fit = Number(opts.fit || 0);
  const monochrome = !!opts.monochrome;
  const warnings = new Set();

  const tree = parseXml(svgText);
  const svg = tree.children.find((n) => n.name === 'svg');
  if (!svg) throw new SvgUnsupported('no <svg> element');

  // gradient lookup
  const gradientNodes = new Map();
  (function collect(node) {
    for (const c of node.children) {
      if ((c.name === 'lineargradient' || c.name === 'radialgradient') && c.attrs.id) gradientNodes.set(c.attrs.id, c);
      collect(c);
    }
  })(svg);

  // viewport → dp mapping
  let vbX = 0, vbY = 0, vbW, vbH;
  if (svg.attrs.viewBox) {
    const p = svg.attrs.viewBox.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) [vbX, vbY, vbW, vbH] = p;
  }
  if (!(vbW > 0 && vbH > 0)) {
    vbW = parseFloat(svg.attrs.width) || sizeDp;
    vbH = parseFloat(svg.attrs.height) || sizeDp;
    vbX = 0; vbY = 0;
  }
  if (!(vbW > 0 && vbH > 0)) throw new SvgUnsupported('cannot determine viewport size');
  const k = Math.min(sizeDp / vbW, sizeDp / vbH);
  const base = [k, 0, 0, k, (sizeDp - vbW * k) / 2 - vbX * k, (sizeDp - vbH * k) / 2 - vbY * k];

  const records = [];
  const visual = emptyBox();

  function paintRef(raw) {
    if (raw == null) return { kind: 'none' };
    const s = String(raw).trim();
    if (!s || s.toLowerCase() === 'none') return { kind: 'none' };
    const m = s.match(/^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/i);
    if (m) {
      const node = gradientNodes.get(m[1]);
      if (!node) throw new SvgUnsupported(`unresolved paint reference #${m[1]}`);
      return { kind: 'gradient', node };
    }
    const c = parseColor(s);
    if (!c) throw new SvgUnsupported(`unsupported color "${s}"`);
    return { kind: 'color', color: c };
  }

  function visit(node, ctx) {
    const name = node.name;
    if (SKIP_TAGS.has(name)) return;
    if (UNSUPPORTED_TAGS.has(name)) throw new SvgUnsupported(`<${name}> is not supported`);
    if (!CONTAINERS.has(name) && !SHAPES.has(name)) {
      if (node.children.length) throw new SvgUnsupported(`<${name}> is not supported`);
      return;
    }

    if (node.attrs['clip-path']) throw new SvgUnsupported('clip-path is not supported');
    if (node.attrs.filter) throw new SvgUnsupported('filter is not supported');

    const style = mergeStyle(ctx.style, node);
    if (style.hidden) return;

    const opacityAttr = node.attrs.opacity !== undefined ? Number(node.attrs.opacity) : 1;
    const opacity = ctx.opacity * (Number.isFinite(opacityAttr) ? clamp01(opacityAttr) : 1);

    const m = node.attrs.transform ? mul(ctx.m, parseTransform(node.attrs.transform)) : ctx.m;

    if (SHAPES.has(name)) {
      const local = shapeToCommands(node);
      if (!local.length) return;
      const cmds = transformCommands(local, m);
      const box = commandsBox(cmds);
      if (!Number.isFinite(box.x0)) return;

      const strokeW = style.strokeWidth * scaleOf(m);
      for (const [x, y] of [[box.x0, box.y0], [box.x1, box.y1]]) addPt(visual, x, y);
      if (strokeW > 0 && style.stroke !== 'none') {
        addPt(visual, box.x0 - strokeW / 2, box.y0 - strokeW / 2);
        addPt(visual, box.x1 + strokeW / 2, box.y1 + strokeW / 2);
      }

      let fill = paintRef(style.fill);
      let stroke = paintRef(style.stroke);
      if (monochrome) {
        // keep the silhouette semantics: filled parts stay filled, stroke-only parts stay strokes
        const white = { r: 255, g: 255, b: 255, a: 1 };
        fill = fill.kind === 'none' ? fill : { kind: 'color', color: white };
        stroke = stroke.kind === 'none' ? stroke : { kind: 'color', color: white };
      }
      if (fill.kind === 'none' && stroke.kind === 'none') return;

      records.push({
        cmds,
        box,
        matrix: m,
        fill,
        stroke,
        fillAlpha: monochrome ? 1 : clamp01(style.fillOpacity * opacity),
        strokeAlpha: monochrome ? 1 : clamp01(style.strokeOpacity * opacity),
        fillType: style.fillRule === 'evenodd' ? 'evenOdd' : 'nonZero',
        strokeWidth: strokeW,
        strokeLinecap: style.strokeLinecap,
        strokeLinejoin: style.strokeLinejoin,
        strokeMiterLimit: style.strokeMiterLimit,
      });
      return;
    }

    for (const child of node.children) visit(child, { m, style, opacity });
  }

  const rootStyle = mergeStyle(DEFAULT_STYLE, svg);
  for (const child of svg.children) visit(child, { m: base, style: rootStyle, opacity: 1 });

  if (!records.length) throw new SvgUnsupported('no drawable geometry found');

  // fit / centre the trimmed content inside the canvas
  let fitMatrix = IDENTITY;
  if (fit > 0 && fit < 1 && Number.isFinite(visual.x0)) {
    const w = Math.max(1e-6, visual.x1 - visual.x0);
    const h = Math.max(1e-6, visual.y1 - visual.y0);
    const s = (sizeDp * fit) / Math.max(w, h);
    const cx = (visual.x0 + visual.x1) / 2;
    const cy = (visual.y0 + visual.y1) / 2;
    fitMatrix = [s, 0, 0, s, sizeDp / 2 - s * cx, sizeDp / 2 - s * cy];
  }
  for (const rec of records) {
    rec.cmds = transformCommands(rec.cmds, fitMatrix);
    rec.box = commandsBox(rec.cmds);
    rec.matrix = mul(fitMatrix, rec.matrix);
    rec.strokeWidth *= scaleOf(fitMatrix);
  }

  // serialize
  let usesAapt = false;
  const body = [];
  for (const rec of records) {
    const attrs = [`android:pathData="${serializeCommands(rec.cmds)}"`];
    const children = [];

    const paintChild = (paint, attrName, alpha, kind) => {
      if (paint.kind === 'none') return false;
      if (paint.kind === 'color') {
        attrs.push(`${attrName}="${argb(paint.color, paint.color.a * alpha)}"`);
        return false;
      }
      const grad = gradientToAndroid(paint.node, rec.matrix, rec.box, warnings);
      if (!grad) {
        warnings.add(`degenerate gradient on ${kind}, replaced by flat colour`);
        attrs.push(`${attrName}="#FFFFFFFF"`);
        return false;
      }
      if (alpha < 0.999) warnings.add('gradient with opacity is approximated');
      children.push(`        <aapt:attr name="${attrName}">\n${grad}\n        </aapt:attr>`);
      return true;
    };

    const fillAapt = paintChild(rec.fill, 'android:fillColor', rec.fillAlpha, 'fill');
    // colour paints already carry their alpha in the ARGB value — only gradients need fillAlpha
    if (fillAapt && rec.fillAlpha < 0.999) attrs.push(`android:fillAlpha="${round(rec.fillAlpha)}"`);
    if (rec.fill.kind !== 'none' && rec.fillType === 'evenOdd') attrs.push('android:fillType="evenOdd"');

    if (rec.stroke.kind !== 'none' && rec.strokeWidth > 0) {
      const strokeAapt = paintChild(rec.stroke, 'android:strokeColor', rec.strokeAlpha, 'stroke');
      if (strokeAapt && rec.strokeAlpha < 0.999) attrs.push(`android:strokeAlpha="${round(rec.strokeAlpha)}"`);
      attrs.push(`android:strokeWidth="${round(rec.strokeWidth)}"`);
      if (rec.strokeLinecap && rec.strokeLinecap !== 'butt') attrs.push(`android:strokeLineCap="${rec.strokeLinecap}"`);
      if (rec.strokeLinejoin && rec.strokeLinejoin !== 'miter') attrs.push(`android:strokeLineJoin="${rec.strokeLinejoin}"`);
      if (rec.strokeMiterLimit && rec.strokeMiterLimit !== 4) attrs.push(`android:strokeMiterLimit="${round(rec.strokeMiterLimit)}"`);
    }

    if (children.length) {
      usesAapt = true;
      body.push(`    <path ${attrs.join(' ')}>\n${children.join('\n')}\n    </path>`);
    } else {
      body.push(`    <path ${attrs.join(' ')}/>`);
    }
  }

  const aaptNs = usesAapt ? '\n    xmlns:aapt="http://schemas.android.com/aapt"' : '';
  const zoneNote = fit > 0 && fit < 1
    ? `content centred in the inner ${Math.round(fit * 100)}% of the 108dp canvas`
    : 'artwork mapped 1:1 into the 108dp canvas';
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by app-icon-maker · ${zoneNote} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"${aaptNs}
    android:width="${sizeDp}dp"
    android:height="${sizeDp}dp"
    android:viewportWidth="${sizeDp}"
    android:viewportHeight="${sizeDp}">
${body.join('\n')}
</vector>
`;

  return { xml, paths: records.length, warnings: [...warnings] };
}

/** Convenience: read a file and convert. */
export async function svgFileToVectorDrawable(file, opts) {
  const text = await fs.readFile(file, 'utf8');
  return svgToVectorDrawable(text, opts);
}

import fs from 'node:fs/promises';
import sharp from 'sharp';

const f = (v) => Math.round(v * 100) / 100;
const P = (p) => `${f(p[0])} ${f(p[1])}`;

const quad = (p0, p1, p2, n = 24) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]]);
  }
  return out;
};
const cub = (p0, p1, p2, p3, n = 36) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],
              u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]]);
  }
  return out;
};
const arc = (cx, cy, r, a0, a1, n = 64) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
};
const area = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i+1) % pts.length]; s += a[0]*b[1] - b[0]*a[1]; }
  return s / 2;
};
const ring = (pts, sign) => {
  const q = area(pts) * sign > 0 ? pts : [...pts].reverse();
  return 'M' + q.map(P).join('L') + 'Z';
};
const CW = (pts) => ring(pts, -1);
const CCW = (pts) => ring(pts, 1);

/* ---------- 锁孔：圆 + 楔形柄，单一闭合轮廓（顺时针向上绕过顶部） ---------- */
const keyhole = (cx, cy, r, topW, botW, botY, roundness = 24) => {
  const dy = Math.sqrt(r * r - topW * topW);
  const aL = Math.atan2(dy, -topW);           // 左下接点
  const aR = Math.atan2(dy, topW);            // 右下接点
  return [
    ...arc(cx, cy, r, aL, aR + 2 * Math.PI, 96),   // 角度递增 → 经左/上/右绕到右下
    [cx + botW, botY],
    ...quad([cx + botW, botY], [cx, botY + roundness], [cx - botW, botY], 14),
  ];
};

/* ================= A · 盾牌 + 锁孔 ================= */
const shieldPts = [
  [344, 260],
  [680, 260],
  ...quad([680, 260], [724, 260], [724, 304]),
  [724, 470],
  ...cub([724, 470], [724, 632], [640, 748], [512, 800]),
  ...cub([512, 800], [384, 748], [300, 632], [300, 470]),
  [300, 304],
  ...quad([300, 304], [300, 260], [344, 260]),
];
const A = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path fill="#FFFFFF" fill-rule="nonzero" d="${CW(shieldPts)}
           ${CCW(keyhole(512, 444, 92, 46, 35, 626))}"/>
</svg>`;

/* ================= B · 挂锁 ================= */
const bodyPts = (() => {
  const x0 = 296, x1 = 728, y0 = 452, y1 = 816, r = 64, H = Math.PI / 2;
  const pts = [];
  const corner = (cx, cy, a0, a1) => { for (let i = 0; i <= 12; i++) { const a = a0 + (a1-a0)*i/12; pts.push([cx + r*Math.cos(a), cy + r*Math.sin(a)]); } };
  corner(x1-r, y0+r, -H, 0); corner(x1-r, y1-r, 0, H);
  corner(x0+r, y1-r, H, 2*H); corner(x0+r, y0+r, 2*H, 3*H);
  return pts;
})();
const shackle = 'M 366 502 L 366 392 A 146 146 0 0 1 658 392 L 658 502';
const B = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path fill="none" stroke="#FFFFFF" stroke-width="94" stroke-linecap="round" d="${shackle}"/>
  <path fill="#FFFFFF" fill-rule="nonzero" d="${CW(bodyPts)}
           ${CCW(keyhole(512, 596, 62, 32, 26, 714, 20))}"/>
</svg>`;

await fs.writeFile('/tmp/passA.svg', A);
await fs.writeFile('/tmp/passB.svg', B);

/* ---------- 用真实构建规则渲染：trim → 50% → 居中 ---------- */
const SIZE = 1024;
const fitted = async (file) => {
  const full = await sharp(file, { density: 384 }).resize(SIZE, SIZE, { fit: 'contain' }).png().toBuffer();
  const trimmed = await sharp(full).trim({ threshold: 1 }).png().toBuffer();
  const m = await sharp(trimmed).metadata();
  const s = (SIZE * 0.5) / Math.max(m.width, m.height);
  const art = await sharp(trimmed).resize(Math.round(m.width*s), Math.round(m.height*s), { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
    .composite([{ input: art, gravity: 'centre' }]).png().toBuffer();
};

const bgSvg = (c1, c2) => {
  const rad = (145 * Math.PI) / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  const len = (Math.abs(dx) + Math.abs(dy)) * SIZE, c = SIZE / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${c-dx*len/2}" y1="${c-dy*len/2}" x2="${c+dx*len/2}" y2="${c+dy*len/2}">
    <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/></svg>`;
};

const compose = async (file) =>
  sharp(Buffer.from(bgSvg('#0F172A', '#4338CA'))).composite([{ input: await fitted(file) }]).png().toBuffer();

const iA = await compose('/tmp/passA.svg');
const iB = await compose('/tmp/passB.svg');

const mask = (n = 5) => {
  const r = 512, pts = [];
  for (let i = 0; i < 300; i++) { const t = i/300*Math.PI*2, ct = Math.cos(t), st = Math.sin(t);
    pts.push(`${(512 + r*Math.sign(ct)*Math.pow(Math.abs(ct), 2/n)).toFixed(1)},${(512 + r*Math.sign(st)*Math.pow(Math.abs(st), 2/n)).toFixed(1)}`); }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><polygon points="${pts.join(' ')}" fill="#fff"/></svg>`;
};
const sq = (buf) => sharp(buf).composite([{ input: Buffer.from(mask()), blend: 'dest-in' }]).png().toBuffer();

const sizes = [20, 29, 40, 60, 120];
const strip = async (buf) => {
  const tiles = await Promise.all(sizes.map((s) => sharp(buf).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer()));
  const W = 20 + sizes.reduce((a, s) => a + s + 20, 0);
  const comps = []; let x = 20;
  for (let i = 0; i < sizes.length; i++) { comps.push({ input: tiles[i], top: Math.round((150-sizes[i])/2), left: x }); x += sizes[i]+20; }
  return sharp({ create: { width: W, height: 150, channels: 4, background: '#f4f4f6' } }).composite(comps).png().toBuffer();
};

const SHOW = 300, pad = 26;
const bigA = await sharp(await sq(iA)).resize(SHOW, SHOW).png().toBuffer();
const bigB = await sharp(await sq(iB)).resize(SHOW, SHOW).png().toBuffer();
const sA = await strip(await sq(iA)), sB = await strip(await sq(iB));
await sharp({ create: { width: SHOW*2 + pad*3, height: SHOW + 150*2 + pad*4, channels: 4, background: '#e9ecf1' } })
  .composite([
    { input: bigA, top: pad, left: pad },
    { input: sA, top: pad + SHOW + pad, left: pad },
    { input: bigB, top: pad, left: pad*2 + SHOW },
    { input: sB, top: pad + SHOW + pad, left: pad*2 + SHOW },
  ]).png().toFile('/tmp/pass-variants.png');
console.log('ok');

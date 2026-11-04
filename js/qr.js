'use strict';
/* QR-Code-Erzeuger (eigener Code nach ISO/IEC 18004): Byte-Modus (UTF-8), Fehlerkorrektur L/M/Q/H, Version 1–40,
   automatische Wahl der kleinsten passenden Version und der Maske mit der geringsten Strafpunktzahl.
   qrMatrix(text, ecl, forceMask) → { size, version, mask, dark(x, y) } – x nach rechts, y nach unten, ohne Ruhezone. */

const QR_ECL = { L: { i: 0, f: 1 }, M: { i: 1, f: 0 }, Q: { i: 2, f: 3 }, H: { i: 3, f: 2 } };
// Fehlerkorrektur-Bytes je Block und Anzahl Blöcke je Version (Index 0 frei), Reihenfolge L, M, Q, H
const QR_ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]];
const QR_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]];

function qrRawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
  return r;
}
const qrDataCodewords = (ver, e) => Math.floor(qrRawModules(ver) / 8) - QR_ECC_PER_BLOCK[e][ver] * QR_BLOCKS[e][ver];
function qrAlignPos(ver) {
  if (ver === 1) return [];
  const na = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2, out = [6];
  for (let p = ver * 4 + 10; out.length < na; p -= step) out.splice(1, 0, p);
  return out;
}
function qrMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function qrRsDivisor(n) {
  const r = new Array(n).fill(0); r[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { r[j] = qrMul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; }
    root = qrMul(root, 2);
  }
  return r;
}
function qrRsRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= qrMul(c, f); }); }
  return r;
}
const qrUtf8 = s => Array.from(new TextEncoder().encode(String(s)));

function qrMatrix(text, ecl = 'M', forceMask = null) {
  const E = QR_ECL[ecl] || QR_ECL.M, e = E.i, bytes = qrUtf8(text);
  let ver = 1;
  const bitsFor = v => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  while (ver <= 40 && bitsFor(ver) > qrDataCodewords(ver, e) * 8) ver++;
  if (ver > 40) throw Error(t('Text zu lang für einen QR-Code'));
  // Bitstrom: Byte-Modus, Länge, Daten, Abschluss, Füllbytes
  const cap = qrDataCodewords(ver, e) * 8, bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // Blöcke mit Fehlerkorrektur, verschränkt
  const nb = QR_BLOCKS[e][ver], el = QR_ECC_PER_BLOCK[e][ver], raw = Math.floor(qrRawModules(ver) / 8);
  const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = qrRsDivisor(el), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += dat.length;
    const ecc = qrRsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const cw = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) cw.push(b[i]); });

  const size = ver * 4 + 17, mod = [], fn = [];
  for (let y = 0; y < size; y++) { mod.push(new Uint8Array(size)); fn.push(new Uint8Array(size)); }
  const setF = (x, y, d) => { mod[y][x] = d ? 1 : 0; fn[y][x] = 1; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
    }
  const al = qrAlignPos(ver), last = al.length - 1;
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const d = (E.f << 3) | mask;
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = i => (b >>> i) & 1;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, 1);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const v = (b >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, v); setF(c, a, v); }
  }
  // Datenbits im Zickzack von unten rechts
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y][x] && bi < cw.length * 8) { mod[y][x] = (cw[bi >>> 3] >>> (7 - (bi & 7))) & 1; bi++; }
    }
  }
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] ^= 1; };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    if (forceMask != null && m !== forceMask) continue;
    applyMask(m); drawFormat(m);
    const p = qrPenalty(mod, size);
    if (p < bestP) { bestP = p; best = m; }
    applyMask(m);   // XOR nimmt die Maske wieder weg
  }
  applyMask(best); drawFormat(best);
  return { size, version: ver, mask: best, ecl, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y][x] === 1 };
}

// Strafpunkte (Regeln 1–4 der Norm): lange Reihen, 2×2-Flächen, Suchmuster-ähnliche Folgen, Hell/Dunkel-Verhältnis
function qrPenalty(mod, size) {
  let p = 0, dark = 0;
  const line = get => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else { if (run >= 5) p += 3 + run - 5; run = 1; }
    }
    const pat = [1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 7 <= size; i++) {
      if (!pat.every((v, k) => get(i + k) === v)) continue;
      const light = (a, b) => { for (let k = a; k < b; k++) if (k >= 0 && k < size && get(k)) return false; return true; };
      if (light(i - 4, i) || light(i + 7, i + 11)) p += 40;
    }
  };
  for (let y = 0; y < size; y++) line(x => mod[y][x]);
  for (let x = 0; x < size; x++) line(y => mod[y][x]);
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
    const c = mod[y][x];
    if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += mod[y][x];
  const total = size * size;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

// WLAN-Zugang als QR-Text (Standardformat der Handy-Kameras); \ ; , : " werden maskiert
function qrWifiText(ssid, pass, sec) {
  const esc = s => String(s || '').replace(/([\\;,:"])/g, '\\$1');
  const T = sec === 'nopass' || !pass ? 'nopass' : sec || 'WPA';
  return 'WIFI:T:' + T + ';S:' + esc(ssid) + ';' + (T === 'nopass' ? '' : 'P:' + esc(pass) + ';') + ';';
}

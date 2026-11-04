'use strict';
/* Modelle erstellen und Teil schneiden (js/qr.js, js/makers.js, js/cut.js):
   QR-Code gegen Referenz-Matrizen, geschlossene Netze (jede Kante genau einmal in Gegenrichtung), Volumen und Maße
   von Schild, Anhänger, QR-Schild, Lithophane (flach, stehend, gebogen), Bild-Relief und Schnitten.
   Mit Orca-CLI (ORCA=<Pfad>, sonst Standardpfad; fehlt sie, entfällt der Teil) werden Schild, QR-Schild, Lithophane
   und Schnittstücke als 3MF geslict: zweiter Slot bekommt Filament, Höhen stimmen.
   Aufruf: node tests/makers.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const fflate = require('../vendor/fflate.min.js');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextDecoder, TextEncoder });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'earcut.min.js'), 'utf8'), ctx, { filename: 'earcut.min.js' });
const ORCA = process.env.ORCA || (process.platform === 'darwin' ? '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer' : 'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe');
for (const f of ['util', 'data', 'stl', 'store', 'engine', 'orca-templates', 'orient', 'holes', 'font-hershey', 'engrave', 'brim-ears', 'export3mf-settings', 'export3mf-mesh', 'export3mf-pack', 'export3mf-relayout', 'export3mf', 'purge', 'qr', 'makers', 'cut'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const K = vm.runInContext('({qrMatrix, qrWifiText, signModel, KEYCHAIN_DEFAULTS, qrSignModel, lithophaneModel, reliefModel, maskRegions, rgbaToGray, imageGrid, cutMesh, makeGeom, compute, getMat, store, exportTemplate, build3mf})', ctx);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('ok   ' + name + (detail !== undefined ? ' (' + detail + ')' : '')); } else { fail++; console.log('FEHL ' + name + (detail !== undefined ? ': ' + detail : '')); } }
const r1 = v => Math.round(v * 10) / 10;

function volume(pos) {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}
// geschlossen: jede gerichtete Kante kommt so oft vor wie ihre Gegenrichtung (überlappende geschlossene Körper erlaubt)
function openEdges(pos) {
  const m = new Map(), q = i => Math.round(pos[i] * 1e4) + ',' + Math.round(pos[i + 1] * 1e4) + ',' + Math.round(pos[i + 2] * 1e4);
  for (let o = 0; o < pos.length; o += 9) {
    const v = [q(o), q(o + 3), q(o + 6)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;   // entartet (Fläche 0)
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; m.set(a + '>' + b, (m.get(a + '>' + b) || 0) + 1); }
  }
  let bad = 0;
  for (const [k, n] of m) { const [a, b] = k.split('>'); if ((m.get(b + '>' + a) || 0) !== n) bad++; }
  return bad;
}
function bbox(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], pos[i]); mx[k] = Math.max(mx[k], pos[i]); }
  return { mn, mx, size: [0, 1, 2].map(k => mx[k] - mn[k]) };
}
function bodiesClosed(part) {
  if (!part.bodies) return openEdges(part.pos) === 0;
  let s = 0;
  return part.bodies.every(b => { const p = part.pos.subarray(s * 9, (s + b.count) * 9); s += b.count; return openEdges(p) === 0 && volume(p) > 0; });
}

/* ---------- QR ---------- */
const qrHash = q => { let s = ''; for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) s += q.dark(x, y) ? '1' : '0'; return crypto.createHash('sha1').update(s).digest('hex'); };
// Referenz: npm „qrcode“ 1.5.4 (Byte-Modus, gleiche Maske erzwungen)
for (const [tx, e, mask, v, sha] of [
  ['Hallo', 'M', 0, 1, '56ec9ba4627ef3116824fc13c56796624e9873b3'],
  ['https://github.com/TMA84/druck-konfigurator/releases', 'Q', 4, 5, '6c722181654aef3cd9065135523c7a22b6c1785d'],
  ['x'.repeat(130), 'L', 0, 6, '1676a643851b39ba09aa2ea4b8c57af411bcde7f'],
  ['x'.repeat(200), 'L', 0, 9, 'd0d673e2e5ae6fb3fc1cb2bc6fd93581bcddd5ae']]) {
  const q = K.qrMatrix(tx, e, mask);
  check('QR ' + e + ' v' + v + ' wie Referenz', q.version === v && qrHash(q) === sha, 'v' + q.version);
}
const qa = K.qrMatrix('Hallo Welt');
check('QR: Maske automatisch gewählt', qa.mask >= 0 && qa.mask < 8 && qa.size === 21, 'Maske ' + qa.mask);
check('QR: Umlaute (UTF-8) passen', K.qrMatrix('Grüße äöü €', 'M').version === 2);
check('QR: WLAN-Text maskiert', K.qrWifiText('Mein;Netz', 'ge:heim', 'WPA') === 'WIFI:T:WPA;S:Mein\\;Netz;P:ge\\:heim;;');
check('QR: WLAN ohne Passwort', K.qrWifiText('Gast', '', 'WPA') === 'WIFI:T:nopass;S:Gast;;');
let tooLong = false; try { K.qrMatrix('x'.repeat(3000), 'H'); } catch (e) { tooLong = true; }
check('QR: zu langer Text wird abgelehnt', tooLong);

/* ---------- Schild, Anhänger ---------- */
const sign = K.signModel({ lines: ['Tobias', 'Werkstatt'], hole: 'corners', border: true });
const sp = sign.parts[0];
check('Schild: ein Teil mit zwei Körpern', sign.parts.length === 1 && sp.bodies && sp.bodies.length === 2 && sp.bodies[1].extruder === 2);
check('Schild: Körper geschlossen, Volumen positiv', bodiesClosed(sp));
const sb = bbox(sp.pos);
check('Schild: liegt auf dem Bett, Höhe Platte + Schrift', Math.abs(sb.mn[2]) < 1e-6 && Math.abs(sb.mx[2] - 4) < 1e-4, r1(sb.mx[2]) + ' mm');
check('Schild: Maße wie gemeldet', Math.abs(sb.size[0] - sign.size[0]) < 1e-3 && Math.abs(sb.size[1] - sign.size[1]) < 1e-3, r1(sign.size[0]) + ' × ' + r1(sign.size[1]));
const plate = sp.pos.subarray(0, sp.bodies[0].count * 9), holeArea = 4 * Math.PI * 4;
check('Schild: Platte mit 4 Löchern (Volumen)', Math.abs(volume(plate) - (sign.size[0] * sign.size[1] - holeArea) * 3) / volume(plate) < 0.02, r1(volume(plate)) + ' mm³');
const key = K.signModel({ ...K.KEYCHAIN_DEFAULTS, lines: ['Kobra'], keychain: true });
check('Anhänger: geschlossen, mit Loch links', bodiesClosed(key.parts[0]) && /Anhänger/.test(key.name), r1(key.size[0]) + ' × ' + r1(key.size[1]));
let empty = false; try { K.signModel({ lines: ['  '] }); } catch (e) { empty = true; }
check('Schild: leerer Text wird abgelehnt', empty);

/* ---------- QR-Schild ---------- */
const qs = K.qrSignModel({ text: 'https://example.com', caption: 'Scan mich', hole: 'top' });
const qp = qs.parts[0];
check('QR-Schild: zwei Körper, geschlossen', qp.bodies && qp.bodies.length === 2 && bodiesClosed(qp), 'Version ' + qs.qr.version);
// erhabene Fläche = dunkle Module × Modulfläche (plus Beschriftung) – ohne Beschriftung genau
const qn = K.qrSignModel({ text: 'https://example.com', module: 2 }), qm = K.qrMatrix('https://example.com', 'M');
let dark = 0; for (let y = 0; y < qm.size; y++) for (let x = 0; x < qm.size; x++) dark += qm.dark(x, y) ? 1 : 0;
const deco = qn.parts[0].pos.subarray(qn.parts[0].bodies[0].count * 9);
check('QR-Schild: erhabene Module = dunkle Module', Math.abs(volume(deco) - dark * 4 * (1 + 0.02)) < dark * 0.05, dark + ' Module, ' + r1(volume(deco)) + ' mm³');

/* ---------- Bilder ---------- */
// Testbild: Ring (dunkel) mit hellem Innenkreis und dunklem Punkt in der Mitte, Verlauf links → rechts für das Lithophane
const W = 120, H = 80, ring = new Float32Array(W * H), grad = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const r = Math.hypot(x - 60, y - 40);
  ring[y * W + x] = (r < 30 && r > 18) || r < 6 ? 0 : 1;
  grad[y * W + x] = x / (W - 1);
}
const regs = K.maskRegions(W, H, (x, y) => ring[y * W + x] < 0.5);
check('Umrisse: Ring mit Loch + Punkt', regs.length === 2 && regs.filter(r => r.holes.length === 1).length === 1, regs.length + ' Flächen');
for (const mode of ['plate', 'cutout']) {
  const rel = K.reliefModel(ring, W, H, { width: 60, mode });
  const p = rel.parts[0];
  check('Relief ' + mode + ': geschlossen', bodiesClosed(p) && (mode === 'plate' ? p.bodies.length === 2 : !p.bodies), r1(rel.size[0]) + ' × ' + r1(rel.size[1]) + ' mm');
}
const inv = K.reliefModel(ring, W, H, { width: 60, mode: 'cutout', invert: true });
check('Relief: Umkehren nimmt die hellen Flächen', inv.parts[0].pos.length > 0 && Math.abs(inv.size[0] - 60) < 0.6, r1(inv.size[0]) + ' mm');
let blank = false; try { K.reliefModel(new Float32Array(W * H).fill(1), W, H, {}); } catch (e) { blank = true; }
check('Relief: leeres Bild wird abgelehnt', blank);

for (const [label, o] of [['flach liegend', { standing: false }], ['stehend', {}], ['gebogen', { shape: 'curved', angle: 120 }]]) {
  const li = K.lithophaneModel(grad, W, H, { width: 100, frame: 3, ...o }), p = li.parts[0].pos, b = bbox(p);
  const open = openEdges(p), vol = volume(p);
  // Verlauf: Dicke von 3 (schwarz) bis 0,8 (weiß) → im Mittel 1,9 mm plus Rahmen
  const area = 100 * 100 * (H - 1) / (W - 1);
  check('Lithophane ' + label + ': geschlossen, Volumen plausibel', open === 0 && vol > area * 1.8 && vol < area * 2.4, r1(vol) + ' mm³, offen ' + open);
  check('Lithophane ' + label + ': auf dem Bett', Math.abs(b.mn[2]) < 1e-6, r1(b.size[0]) + ' × ' + r1(b.size[1]) + ' × ' + r1(b.size[2]));
}
const gr = K.imageGrid('litho', 100, 0.75);
check('Raster: Lithophane 0,2 mm je Punkt', gr.w === 500 && gr.h === 375, gr.w + ' × ' + gr.h);
const big = K.imageGrid('litho', 250, 1);
check('Raster: begrenzt', big.w * big.h <= 260000, big.w + ' × ' + big.h);
const g4 = K.rgbaToGray(Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 128, 128, 128, 255]), 2, 2);
check('Graustufen: durchsichtig = weiß', g4[0] === 0 && g4[1] === 1 && g4[2] === 1 && Math.abs(g4[3] - 0.502) < 0.01);

/* ---------- Schneiden ---------- */
function boxPos(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return Float32Array.from([[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].flatMap(t => t.flatMap(i => v[i])));
}
const cube = boxPos(0, 0, 0, 20, 20, 20);
for (const axis of [0, 1, 2]) {
  const c = K.cutMesh(cube, axis, 7);
  check('Schnitt Würfel Achse ' + 'XYZ'[axis] + ': beide Stücke geschlossen', openEdges(c.lo) === 0 && openEdges(c.hi) === 0 && c.loops === 1 && !c.open);
  check('Schnitt Würfel Achse ' + 'XYZ'[axis] + ': Volumen 7/13', Math.abs(volume(c.lo) - 2800) < 1 && Math.abs(volume(c.hi) - 5200) < 1, r1(volume(c.lo)) + ' / ' + r1(volume(c.hi)));
}
// Rahmen (Platte mit Loch) quer geschnitten: Deckel mit Loch
const frame = K.signModel({ lines: ['A'], hole: 'corners' }).parts[0];
const fp = frame.pos.subarray(0, frame.bodies[0].count * 9);
const fc = K.cutMesh(fp, 2, 1.5);
check('Schnitt Platte mit 4 Löchern waagerecht: geschlossen', openEdges(fc.lo) === 0 && openEdges(fc.hi) === 0 && fc.loops === 1, Math.round(volume(fc.lo)) + ' + ' + Math.round(volume(fc.hi)) + ' = ' + Math.round(volume(fp)));
check('Schnitt Platte: Volumen bleibt', Math.abs(volume(fc.lo) + volume(fc.hi) - volume(fp)) < 0.5 && Math.abs(volume(fc.lo) - volume(fc.hi)) < 0.5);
// zwei Säulen nebeneinander (U-Form von oben geschnitten): zwei Umrisse
const two = new Float32Array([...boxPos(0, 0, 0, 5, 5, 20), ...boxPos(10, 0, 0, 15, 5, 20)]);
const tc = K.cutMesh(two, 2, 10);
check('Schnitt zwei Körper: zwei Umrisse, geschlossen', tc.loops === 2 && openEdges(tc.lo) === 0 && openEdges(tc.hi) === 0);
// QR-Module (viele Umrisse auf gemeinsamen Linien) waagerecht geschnitten
const qcut = K.cutMesh(deco, 2, 3);
check('Schnitt QR-Module: Deckel dicht trotz Kanten auf einer Linie', openEdges(qcut.lo) === 0 && openEdges(qcut.hi) === 0 && !qcut.open, qcut.loops + ' Umrisse');
// Ecke genau auf der Ebene
const onPlane = K.cutMesh(cube, 2, 20 - 1e-9);
check('Schnitt in Höhe einer Kante: kein Fehler', openEdges(onPlane.lo) === 0, 'Stücke ' + onPlane.lo.length / 9 + ' / ' + onPlane.hi.length / 9 + ' Dreiecke');
// gedrehte Kugel-ähnliche Form: Lithophane gebogen senkrecht geschnitten
const lc = K.lithophaneModel(grad, W, H, { width: 100, shape: 'curved' }).parts[0].pos, lcut = K.cutMesh(lc, 0, 3.3);
check('Schnitt gebogenes Lithophane: geschlossen', openEdges(lcut.lo) === 0 && openEdges(lcut.hi) === 0 && !lcut.open, lcut.loops + ' Umriss(e)');

/* ---------- Orca ---------- */
function job(name, part, slots) {
  const geom = K.makeGeom(name, part.pos);
  let start = 0;
  const bodies = part.bodies ? part.bodies.map((b, i) => { const o = { name: b.name, start, count: b.count, slot: i ? slots[1] : null, partId: null }; start += b.count; return o; }) : null;
  return { geom, bodies, slot: slots[0] };
}
const inp = { printer: 'kobra_s1', material: 'pla_hs', nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const tpl = K.exportTemplate('kobra_s1', '0.4');
const cubeHalves = K.cutMesh(boxPos(0, 0, 0, 20, 20, 20), 2, 8);
const cases = {
  schild: [job('Schild', sign.parts[0], [0, 1])],
  qr: [job('QR', qs.parts[0], [0, 1])],
  litho: [job('Litho', K.lithophaneModel(grad, W, H, { width: 40, frame: 2 }).parts[0], [0])],
  schnitt: [job('unten', { pos: cubeHalves.lo }, [0]), job('oben', { pos: (() => { const p = Float32Array.from(cubeHalves.hi); for (let i = 2; i < p.length; i += 3) p[i] -= 8; return p; })() }, [0])]
};
if (!fs.existsSync(ORCA)) console.log('\n(Orca-CLI nicht gefunden: ' + ORCA + ' – Slicen übersprungen)');
else {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'makers-'));
  for (const [label, jobs] of Object.entries(cases)) {
    const r = K.compute(inp, jobs[0].geom, { getMat: K.getMat, settings: K.store.settings });
    jobs.forEach(j => { j.r = r; });
    const { bytes } = K.build3mf(tpl, r, jobs, 0, fflate);
    const dir = path.join(OUT, label); fs.mkdirSync(dir);
    const file = path.join(dir, 'export.3mf'); fs.writeFileSync(file, bytes);
    try { execFileSync(ORCA, ['--slice', '0', '--outputdir', dir, file], { stdio: 'pipe', timeout: 300000 }); }
    catch (e) { check('Orca ' + label + ': geslict', false, (e.stderr || e.message).toString().slice(0, 300)); continue; }
    const gf = fs.readdirSync(dir).find(f => f.endsWith('.gcode'));
    if (!gf) { check('Orca ' + label + ': G-Code', false); continue; }
    const text = fs.readFileSync(path.join(dir, gf), 'utf8');
    const grams = ((text.match(/^; filament used \[g\] = (.*)$/m) || [])[1] || '').split(',').map(Number);
    let maxZ = 0, zc = 0;
    for (const line of text.split('\n')) { const zm = /^;Z:([\d.]+)/.exec(line); if (zm) zc = +zm[1]; if (/^G1 .*E\.?\d/.test(line) && /X/.test(line)) maxZ = Math.max(maxZ, zc); }
    const want = { schild: 4, qr: 3.5, litho: Math.round(40 * (H - 1) / (W - 1) * 10) / 10, schnitt: 12 }[label];   // Lithophane steht
    check('Orca ' + label + ': Höhe ' + want + ' mm' + (label === 'schild' || label === 'qr' ? ', zweiter Slot hat Filament' : ''),
      Math.abs(maxZ - want) < 0.25 && grams[0] > 0 && (label !== 'schild' && label !== 'qr' || grams[1] > 0), grams.join(' / ') + ' g, ' + maxZ + ' mm');
  }
}

console.log('\n' + pass + ' ok, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);

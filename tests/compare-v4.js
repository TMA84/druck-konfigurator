'use strict';
/* Migrationsprüfung: gleiche Eingabe → gleiches Ergebnis wie Druck-Konfigurator v4.
   v4 läuft unverändert (reference/druck-konfigurator_v4.html) mit einer DOM-Attrappe,
   der neue Rechenkern aus js/*.js. Aufruf: node tests/compare-v4.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- Testprofile (eigene Werte), identisch in beide Seiten injiziert ---------- */
const USER_PROFILES = {
  pla_hs: { name: 'PLA HS eigen', kind: 'pla', abrasive: false, refD: 0.6, refMat: 'brass', nozzle: [212, 218, 224], range: '210–230 °C', bed: 55, bedNote: 'Textur', maxVol: 20, flow: 0.97, pa: 0.03, fanFirst: 20, fan: 90, retrLen: 0.7, retrSpeed: 40, zhop: 0.3, first: 25, outer: [70, 90, 110], inner: [100, 140, 170], fill: [130, 170, 210], top: 55, gap: 28, travel: 280, accel: 5000, dry: '', notes: 'Notiz <b>mit</b> HTML\nzweite Zeile' },
  u_custom_tpu: { name: 'Mein TPU', kind: 'tpu', abrasive: false, refD: 0.4, refMat: 'steel_stainless', nozzle: [225, 228, 232], range: '', bed: 45, bedNote: '', maxVol: 3, flow: 1.02, pa: null, fanFirst: 0, fan: 40, retrLen: 1, retrSpeed: 25, zhop: 0.2, first: 12, outer: [15, 18, 22], inner: [18, 22, 26], fill: [20, 25, 30], top: 18, gap: 12, travel: 120, accel: 1000, dry: 'trocknen', notes: '' },
  u_custom_cf: { name: 'Mein PETG-CF', kind: 'petg', abrasive: true, refD: 0.25, refMat: 'steel_hardened', nozzle: [250, 255, 260], range: '240–270', bed: 80, bedNote: '', maxVol: 8, flow: 0.95, pa: 0.04, fanFirst: 0, fan: 30, retrLen: 0.8, retrSpeed: 30, zhop: 0.4, first: 20, outer: [40, 50, 60], inner: [60, 80, 100], fill: [80, 100, 120], top: 35, gap: 20, travel: 250, accel: 0, dry: '', notes: '' }
};
const SETTINGS = { steelOffset: 7, steelVol: 0.85 };

/* ---------- Synthetische STL-Modelle ---------- */
function boxTris(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return f.map(t => t.map(i => v[i]));
}
function octaTris(r, zc) {
  const P = [[r,0,zc],[-r,0,zc],[0,r,zc],[0,-r,zc],[0,0,zc+r],[0,0,zc-r]];
  const f = [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]];
  return f.map(t => t.map(i => P[i]));
}
function binarySTL(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => { const o = 84 + i * 50; t.flat().forEach((c, j) => buf.writeFloatLE(c, o + 12 + j * 4)); });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
function asciiSTL(tris) {
  const s = 'solid t\n' + tris.map(t => 'facet normal 0 0 0\nouter loop\n' + t.map(p => 'vertex ' + p.join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid t\n';
  const b = Buffer.from(s, 'utf8');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
const MODELS = {
  cube: binarySTL(boxTris(0, 0, 0, 20, 20, 20)),
  mushroom: binarySTL([...boxTris(15, 15, 0, 25, 25, 20), ...boxTris(0, 0, 20, 40, 40, 25)]),
  ledge: binarySTL([...boxTris(0, 0, 0, 30, 30, 30), ...boxTris(30, 10, 25, 34, 14, 30)]),
  pillar: binarySTL(boxTris(0, 0, 0, 5, 5, 60)),
  flat: binarySTL(boxTris(0, 0, 0, 50, 50, 3)),
  bigplate: binarySTL(boxTris(-75, -75, 0, 75, 75, 5)),
  octa_ascii: asciiSTL(octaTris(15, 15))
};

/* ---------- DOM-Attrappe für v4 ---------- */
function makeDomStub(state) {
  const els = {};
  const classList = () => ({ add() {}, remove() {}, toggle() {}, contains() { return false; } });
  function el(id) {
    if (els[id]) return els[id];
    let own = '';
    const e = {
      id, innerHTML: '', textContent: '', innerText: '', style: {}, dataset: {}, files: [], checked: false,
      clientWidth: 800, clientHeight: 600, classList: classList(),
      get value() { return id in state ? state[id] : own; },
      set value(v) { own = v; if (id in state) state[id] = String(v); },
      addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; },
      click() {}, remove() {}, appendChild() {}, setAttribute() {}, removeAttribute() {}, showModal() {}, close() {}, select() {}
    };
    return (els[id] = e);
  }
  const document = {
    title: '', body: el('__body'),
    getElementById: el, addEventListener() {}, createElement: () => el('__tmp' + Math.random()),
    execCommand() { return true; }
  };
  const mem = {};
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  return { document, localStorage, window: { addEventListener() {}, devicePixelRatio: 1, print() {} },
    navigator: {}, requestAnimationFrame() {}, confirm: () => true, alert() {}, setTimeout() {},
    TextDecoder, URL, Blob: class {}, console };
}

/* ---------- v4 laden ---------- */
const v4html = read('reference/druck-konfigurator_v4.html');
const v4script = v4html.slice(v4html.lastIndexOf('<script>') + 8, v4html.lastIndexOf('</script>'));
const DEFAULTS = { material: 'pla_hs', printer: 'kobra_s1', nozD: '0.4', nozM: 'steel_hardened', object: 'general', goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45' };
const v4state = { ...DEFAULTS };
const v4ctx = vm.createContext(makeDomStub(v4state));
vm.runInContext(v4script + `
;globalThis.__v4={compute,buildOrcaFilamentJSON,buildOrcaProcessJSON,orcaWarningText,rowHTML,parseSTL,
  setGeom:g=>{geom=g},getGeom:()=>geom,store};`, v4ctx, { filename: 'v4.js' });
const V4 = v4ctx.__v4;
V4.store.profiles = JSON.parse(JSON.stringify(USER_PROFILES));
Object.assign(V4.store.settings, SETTINGS);

/* ---------- Neuer Kern laden ---------- */
const newCtx = vm.createContext({ console, TextDecoder });
for (const f of ['js/util.js', 'js/data.js', 'js/stl.js', 'js/store.js', 'js/engine.js'])
  vm.runInContext(read(f), newCtx, { filename: f });
vm.runInContext(`store.profiles=${JSON.stringify(USER_PROFILES)};Object.assign(store.settings,${JSON.stringify(SETTINGS)});`, newCtx);
const NEW = vm.runInContext('({compute,buildOrcaFilamentJSON,buildOrcaProcessJSON,orcaWarningText,rowHTML,parseSTL,getMat,store})', newCtx);

/* ---------- Geometrien vergleichen ---------- */
const plain = g => g && JSON.stringify(g, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
let fails = 0;
const fail = (what, a, b) => {
  if (fails++ < 5) {
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`ABWEICHUNG ${what}\n  v4 : …${String(a).slice(Math.max(0, i - 60), i + 120)}\n  neu: …${String(b).slice(Math.max(0, i - 60), i + 120)}`);
  }
};
const geoms = { none: [null, null] };
for (const [name, buf] of Object.entries(MODELS)) {
  Object.assign(v4state, DEFAULTS);
  V4.parseSTL(name, buf);
  const gOld = V4.getGeom(), gNew = NEW.parseSTL(name, buf);
  delete gNew.hidden; // neu seit v5: Innenflächen zählen nicht als Überhang (eigener Test in tests/orient.js)
  const a = plain(gOld), b = plain(gNew);
  if (a !== b) fail('parseSTL ' + name, a, b);
  geoms[name] = [gOld, gNew];
}

/* ---------- Eingabe-Kombinationen ---------- */
const printers = ['kobra_s1', 'snapmaker_u1'];
const nozM = { kobra_s1: ['steel_hardened', 'brass'], snapmaker_u1: ['steel_stainless', 'steel_hardened'] };
const mats = NEW.store && vm.runInContext('allMats().map(m=>m.id)', newCtx);
const DIM = {
  nozD: ['0.25', '0.4', '0.6', '0.8'],
  object: ['general', 'holder', 'precision', 'thin', 'decor', 'overhang', 'multicolor', 'tire', 'dumpling', 'case'],
  goal: ['balanced', 'quality', 'fast', 'strong'], load: ['medium', 'low', 'high'],
  support: ['auto', 'avoid', 'allow'], supportLevel: ['safe', 'balanced', 'reduced', 'minimal'],
  thresh: ['30', '45', '55', '70'], geom: Object.keys(geoms)
};
const cases = [];
// 1) Vollraster über Drucker × Filament × Düse × Düsenmaterial × Objekt × Modell
if (!process.env.QUICK) for (const p of printers) for (const m of mats) for (const d of DIM.nozD) for (const nm of nozM[p]) for (const o of DIM.object) for (const g of DIM.geom)
  cases.push({ printer: p, material: m, nozD: d, nozM: nm, object: o, goal: 'balanced', load: 'medium', support: 'auto', supportLevel: 'balanced', thresh: '45', geom: g });
// 2) Deterministische Stichprobe über alle Dimensionen
let seed = 12345; const rnd = n => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
const pick = a => a[rnd(a.length)];
const SAMPLES = process.env.SAMPLES ? +process.env.SAMPLES : 30000;
for (let i = 0; i < SAMPLES; i++) {
  const p = pick(printers);
  cases.push({ printer: p, material: pick(mats), nozD: pick(DIM.nozD), nozM: pick(nozM[p]), object: pick(DIM.object), goal: pick(DIM.goal), load: pick(DIM.load), support: pick(DIM.support), supportLevel: pick(DIM.supportLevel), thresh: pick(DIM.thresh), geom: pick(DIM.geom) });
}

const ctxNew = { getMat: NEW.getMat, settings: NEW.store.settings };
for (const c of cases) {
  const { geom, ...inp } = c;
  Object.assign(v4state, inp);
  V4.setGeom(geoms[geom][0]);
  const r4 = V4.compute(), rn = NEW.compute(inp, geoms[geom][1], ctxNew);
  const kind = rn.m.kind;
  // Felder, die v5 für den 3MF-Export zusätzlich liefert – v4 kennt sie nicht.
  const V5_ONLY = ['maxVol', 'firstLayer', 'brim', 'seam', 'supZ'];
  const rnV4View = Object.fromEntries(Object.entries(rn).filter(([k]) => !V5_ONLY.includes(k)));
  // Bewusste Änderung 2026-09-26: Z-Abstand der Stützen = Schichthöhe (PETG +0,05 mm) statt fest 0,20 mm.
  // Für den Vergleich wird die v4-Angabe eingesetzt; die neuen Werte prüft tests/verify-3mf.js im G-Code.
  const V4_ZGAP = { 'Oberer Z-Abstand': '0,20 mm', 'Unterer Z-Abstand': rn.tpu ? '0,25 mm' : '0,20 mm' };
  rn.ordered = rn.ordered.map(([t, rows]) => [t, rows.map(r => V4_ZGAP[r[0]] ? [r[0], V4_ZGAP[r[0]], ...r.slice(2)] : r)]);
  rnV4View.ordered = rn.ordered;
  const out4 = [JSON.stringify(r4), V4.buildOrcaFilamentJSON(r4), V4.buildOrcaProcessJSON(r4), V4.orcaWarningText(r4),
    r4.rows.map(V4.rowHTML).join(''), r4.ordered.map(g => g[1].map(V4.rowHTML).join('')).join('|')];
  const outN = [JSON.stringify(rnV4View), NEW.buildOrcaFilamentJSON(rn), NEW.buildOrcaProcessJSON(rn), NEW.orcaWarningText(rn),
    rn.rows.map(r => NEW.rowHTML(r, kind)).join(''), rn.ordered.map(g => g[1].map(r => NEW.rowHTML(r, kind)).join('')).join('|')];
  const names = ['compute', 'filament-json', 'process-json', 'orca-hinweis', 'rows-html', 'ordered-html'];
  out4.forEach((x, i) => { if (x !== outN[i]) fail(names[i] + ' ' + JSON.stringify(c), x, outN[i]); });
}

console.log(`${cases.length} Kombinationen, ${Object.keys(MODELS).length} Modelle (inkl. ASCII-STL), ${Object.keys(USER_PROFILES).length} eigene Profile`);
console.log(fails ? `FEHLGESCHLAGEN: ${fails} Abweichungen` : 'OK: alle Ergebnisse identisch mit v4');
process.exit(fails ? 1 : 0);

'use strict';
/* Modell-Import: STL (auch mit mehreren Körpern), mehrere Dateien, ZIP (z. B. von Makerworld)
   und 3MF (Orca/Bambu/Makerworld). Kein DOM-Zugriff – tests/import.js prüft das in Node.
   Ergebnis: { name, parts:[{name, pos, objectId?, extruder?, plate?, bodies?}], threemf|null, notes:[] }.
   bodies (nur bei mehreren Körpern): [{name, count, partId?, extruder?}] – Dreiecke je Körper in Reihenfolge von pos.
   pos ist ein flaches Dreiecksarray in Druckbett-Koordinaten (wie in der Quelldatei platziert). */

const MAX_BODIES = 200;     // mehr getrennte Körper → eher ein zerfallenes Netz als ein Teilesatz
const WELD_MM = 1e-4;       // Eckpunkte näher als das gelten als identisch
const TOUCH_MM = 0.05;      // Körper mit weniger Abstand gelten als ein Teil
const MIN_BODY_TRIS = 4;    // kleinere Splitter sind kein eigenständiges Teil
const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const MODEL_EXT = /\.(stl|obj|3mf)$/i;
// Grenzen gegen zu große oder präparierte Dateien (ZIP-Bombe): je Datei bzw. entpackt je ZIP/3MF zusammen, Einträge je ZIP
const IMPORT_MAX_BYTES = 500 * 1024 * 1024, IMPORT_MAX_ENTRIES = 50000;
const badTrisNote = (file, n) => t('{file}: {n} ungültige Dreiecke entfernt.', { file: String(file).replace(/^.*[\\/]/, ''), n });
const tooBig = file => Error(t('{file}: Datei zu groß oder beschädigt.', { file: String(file).replace(/^.*[\\/]/, '') }));
// ZIP/3MF entpacken mit Grenze für die entpackte Größe (Angabe im ZIP-Verzeichnis; fflate entpackt nie mehr als angegeben);
// keep(name): nur diese Einträge entpacken. Kaputte Daten und zu große Dateien → „Datei zu groß oder beschädigt“
function safeUnzip(fileName, bytes, zipLib, keep) {
  let total = 0, n = 0;
  try {
    return zipLib.unzipSync(bytes, { filter: f => {
      if (keep && !keep(f.name)) return false;
      total += +f.originalSize || 0;
      if (++n > IMPORT_MAX_ENTRIES || total > IMPORT_MAX_BYTES) throw new RangeError('zip too large');
      return true;
    } });
  } catch (e) { throw tooBig(fileName); }
}

/* ---------- STL in Körper zerlegen ---------- */
function bboxOf(pos, tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 9; k++) {
    const v = pos[t * 9 + k], a = k % 3;
    if (v < mn[a]) mn[a] = v;
    if (v > mx[a]) mx[a] = v;
  }
  return { mn, mx };
}
const boxesTouch = (a, b) => [0, 1, 2].every(k => a.mn[k] <= b.mx[k] + TOUCH_MM && b.mn[k] <= a.mx[k] + TOUCH_MM);

// Vorzeichenbehaftetes Volumen einer Hülle: negativ = nach innen gerichtet (Hohlraum eines Hohlkörpers)
function signedVolume(pos, tris) {
  let v = 0;
  for (const t of tris) {
    const o = t * 9, ax = pos[o], ay = pos[o + 1], az = pos[o + 2], bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5], cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
const boxInside = (a, b) => [0, 1, 2].every(k => a.mn[k] >= b.mn[k] - TOUCH_MM && a.mx[k] <= b.mx[k] + TOUCH_MM);

/* Zerlegt ein Netz in getrennte Teile. Körper, deren Hüllquader sich berühren oder überlappen,
   bleiben ein Teil – das deckt Hohlkörper (Innenwand), unverschmolzene Tinkercad-Exporte
   (Stiel + Hut) und Einsätze ab. Getrennt wird nur, was auch auf dem Bett getrennt liegt.
   Ergebnis je Teil: {pos, bodies:[Dreiecksanzahl je Körper]} – die Körper eines Teils liegen
   hintereinander in pos und können beim Export eigene Slots bekommen (Mehrfarbdruck). Eine nach
   innen gerichtete Hülle (Hohlraum) gehört zum Körper, der sie umschließt. */
/* Gleiche Ecken (auf WELD_MM gerundet): je Ecke das Dreieck, in dem dieselbe Ecke zuerst vorkommt – offene Hashtabelle über die drei
   gerundeten Zahlen (Int32) statt Text-Schlüssel je Ecke (≈ 5 × schneller). null, wenn eine Zahl nicht in Int32 passt (riesige
   Koordinaten, NaN): dann wie bisher mit Text-Schlüsseln. Eigene Funktion, damit die Schleifen optimiert werden. */
function weldFirst(pos, n) {
  const m = 3 * n, q = new Int32Array(m * 3);
  for (let k = 0; k < m * 3; k++) { const r = Math.round(pos[k] / WELD_MM); if (!(r >= -2147483648 && r <= 2147483647)) return null; q[k] = r; }
  let size = 16; while (size < m * 2) size *= 2;
  const mask = size - 1, slot = new Int32Array(size).fill(-1), first = new Int32Array(m);   // slot: Ecke (t * 3 + v) des ersten Vorkommens
  for (let e = 0; e < m; e++) {
    const x = q[3 * e], y = q[3 * e + 1], z = q[3 * e + 2];
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = (h ^ (h >>> 15)) & mask;   // durchmischen: gerundete Gitter haben gleiche untere Bits
    let f;
    while ((f = slot[h]) >= 0 && (q[3 * f] !== x || q[3 * f + 1] !== y || q[3 * f + 2] !== z)) h = (h + 1) & mask;
    if (f < 0) { slot[h] = e; f = e; }
    first[e] = (f / 3) | 0;
  }
  return first;
}
function splitBodyGroups(pos) {
  const n = pos.length / 9;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const first = weldFirst(pos, n);
  progressAt(0.5);
  if (first) for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
    const other = first[t * 3 + v];
    if (other !== t) { const a = find(t), b = find(other); if (a !== b) parent[a] = b; }
  } else {
    const seen = new Map();
    for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const key = Math.round(pos[o] / WELD_MM) + ',' + Math.round(pos[o + 1] / WELD_MM) + ',' + Math.round(pos[o + 2] / WELD_MM);
      const other = seen.get(key);
      if (other === undefined) seen.set(key, t); else { const a = find(t), b = find(other); if (a !== b) parent[a] = b; }
    }
  }
  const groups = new Map();
  for (let t = 0; t < n; t++) { const r = find(t); (groups.get(r) || groups.set(r, []).get(r)).push(t); }
  if (groups.size === 1 || groups.size > MAX_BODIES) return [{ pos, bodies: [n] }];

  let bodies = [...groups.values()].map(tris => ({ tris, ...bboxOf(pos, tris) }));
  bodies.sort((a, b) => b.tris.length - a.tris.length);
  // Splitter an den größten Körper hängen
  const main = bodies[0];
  bodies = bodies.filter((b, i) => {
    if (!i || b.tris.length >= MIN_BODY_TRIS) return true;
    for (const t of b.tris) main.tris.push(t);
    for (let k = 0; k < 3; k++) { main.mn[k] = Math.min(main.mn[k], b.mn[k]); main.mx[k] = Math.max(main.mx[k], b.mx[k]); }
    return false;
  });
  // Hohlräume (nach innen gerichtete Hüllen) in den kleinsten umschließenden Körper
  const shells = bodies.filter(b => signedVolume(pos, b.tris) >= 0);
  for (const b of bodies) {
    if (shells.includes(b)) continue;
    const host = shells.filter(h => boxInside(b, h)).sort((x, y) => x.tris.length - y.tris.length)[0];
    if (host) for (const t of b.tris) host.tris.push(t); else shells.push(b);
  }
  // Berührende Körper zusammenfassen, bis sich nichts mehr ändert (der gemeinsame Quader wächst mit)
  let kept = shells.map(b => ({ mn: [...b.mn], mx: [...b.mx], members: [b] })), merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < kept.length && !merged; i++) for (let j = i + 1; j < kept.length; j++) {
      const A = kept[i], B = kept[j];
      if (!boxesTouch(A, B)) continue;
      A.members.push(...B.members);
      for (let k = 0; k < 3; k++) { A.mn[k] = Math.min(A.mn[k], B.mn[k]); A.mx[k] = Math.max(A.mx[k], B.mx[k]); }
      kept.splice(j, 1); merged = true; break;
    }
  }
  // Reihenfolge wie im Bett: von vorne links nach hinten rechts (Teile und Körper darin)
  const frontLeft = (a, b) => (a.mn[1] - b.mn[1]) || (a.mn[0] - b.mn[0]);
  kept.sort(frontLeft);
  return kept.map(g => {
    g.members.sort(frontLeft);
    const out = new Float32Array(g.members.reduce((s, b) => s + b.tris.length, 0) * 9);
    let j = 0;
    for (const b of g.members) for (const t of b.tris.sort((x, y) => x - y)) out.set(pos.subarray(t * 9, t * 9 + 9), 9 * j++);
    return { pos: out, bodies: g.members.map(b => b.tris.length) };
  });
}
const splitBodies = pos => splitBodyGroups(pos).map(g => g.pos);

/* ---------- 3MF lesen ---------- */
const PAINT_HEX = /^[0-9A-Fa-f]+$/;
const attrsOf = tag => { const o = {}; tag.replace(/([\w:]+)="([^"]*)"/g, (_, k, v) => { o[k] = v; }); return o; };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
// unit = Einheit der Datei in mm; gilt auch für den Verschiebungsanteil
const parseTransform = (s, unit = 1) => {
  const t = s ? s.trim().split(/\s+/).map(Number) : IDENTITY;
  if (t.length !== 12 || !t.every(Number.isFinite)) return IDENTITY;
  return t.map((v, i) => i >= 9 ? v * unit : v);
};
// Tags mit oder ohne Namensraum-Präfix (z. B. <m:vertex> aus 3D Builder)
const tagRe = (name, flags = 'g') => new RegExp('<(?:\\w+:)?' + name + '\\b([^>]*?)\\/?>', flags);
const blockRe = name => new RegExp('<(?:\\w+:)?' + name + '\\b([^>]*[^/>])?>([\\s\\S]*?)<\\/(?:\\w+:)?' + name + '>', 'g');
// 3MF-Matrizen wirken auf Zeilenvektoren: p' = p·A, danach ·B  →  C = A·B
function mulTransform(a, b) {
  const A = [[a[0], a[1], a[2], 0], [a[3], a[4], a[5], 0], [a[6], a[7], a[8], 0], [a[9], a[10], a[11], 1]];
  const B = [[b[0], b[1], b[2], 0], [b[3], b[4], b[5], 0], [b[6], b[7], b[8], 0], [b[9], b[10], b[11], 1]];
  const C = A.map(row => [0, 1, 2].map(c => row.reduce((s, v, k) => s + v * B[k][c], 0)));
  return [...C[0], ...C[1], ...C[2], ...C[3]];
}

function parseModelXML(text) {
  let bad = 0;
  const unit = UNIT_MM[(/<(?:\w+:)?model\b[^>]*\bunit="([^"]+)"/.exec(text) || [])[1] || 'millimeter'] || 1;
  const objects = new Map();
  for (const m of text.matchAll(blockRe('object'))) {
    const a = attrsOf(m[1] || ''), body = m[2], obj = { id: a.id, name: a.name || '', type: a.type || 'model', mesh: null, components: [] };
    const meshXml = blockRe('mesh').exec(body);
    if (meshXml) {
      const vs = [];
      for (const v of meshXml[2].matchAll(tagRe('vertex'))) { const va = attrsOf(v[1]); vs.push(+va.x * unit, +va.y * unit, +va.z * unit); }
      const ts = [];
      let painted = false; // Bambu/Orca-Farbbemalung je Dreieck (paint_color) = Mehrfarbdruck ohne eigene Körper (painted: auch Farb-Modifikatoren)
      // Bemalung: überwiegendes Filament je Dreieck (für die Anzeige) und alle vorkommenden Filamente (js/paint.js)
      // geteilte Dreiecke behalten ihren Code (pc: Index → Code) – die 3D-Ansicht zeigt die Teilstücke genau (js/paint-ui.js)
      const ps = [], pstates = new Set(), canPaint = typeof paintMain === 'function', pc = {};
      // gemalte Stützen und Naht des Designers (paint_supports, paint_seam): Index → Code
      let sc = null, zc = null;
      // Dreiecke mit Eckpunkt außerhalb der Liste oder ungültigen Koordinaten weglassen (drop: Index in der Datei, für den Export)
      const nv = vs.length / 3, okV = i => Number.isInteger(i) && i >= 0 && i < nv && Number.isFinite(vs[3 * i]) && Number.isFinite(vs[3 * i + 1]) && Number.isFinite(vs[3 * i + 2]);
      let ti = -1, drop = null;
      for (const t of meshXml[2].matchAll(tagRe('triangle'))) {
        ti++;
        const ta = attrsOf(t[1]), a = +ta.v1, b = +ta.v2, c = +ta.v3;
        if (!okV(a) || !okV(b) || !okV(c)) { (drop = drop || []).push(ti); continue; }
        ts.push(a, b, c);
        // Codes sind Hex-Ziffern (Bambu/Orca); alles andere verwerfen – sie werden beim Export wieder ins XML geschrieben
        if (ta.paint_supports && PAINT_HEX.test(ta.paint_supports)) (sc = sc || {})[ts.length / 3 - 1] = ta.paint_supports;
        if (ta.paint_seam && PAINT_HEX.test(ta.paint_seam)) (zc = zc || {})[ts.length / 3 - 1] = ta.paint_seam;
        if (ta.paint_color && PAINT_HEX.test(ta.paint_color)) { painted = true; if (canPaint) { ps[ts.length / 3 - 1] = paintMain(ta.paint_color); if (ta.paint_color.length > 2) paintStates(ta.paint_color).forEach(s => pstates.add(s));
          if (parseInt(ta.paint_color[ta.paint_color.length - 1], 16) & 3) pc[ts.length / 3 - 1] = ta.paint_color; } }
      }
      if (painted && canPaint) for (let i = 0; i < ts.length / 3; i++) { ps[i] = ps[i] || 0; pstates.add(ps[i]); }
      obj.mesh = { v: Float64Array.from(vs), t: Uint32Array.from(ts), painted, sc, zc, ...(drop ? { drop } : {}), ...(painted && canPaint ? { ps: Uint8Array.from(ps), pstates, pc } : {}) };
      if (drop) bad += drop.length;
    }
    for (const c of body.matchAll(tagRe('component'))) {
      const ca = attrsOf(c[1]);
      obj.components.push({ path: ca['p:path'] || null, objectid: ca.objectid, transform: parseTransform(ca.transform, unit) });
    }
    objects.set(a.id, obj);
  }
  const items = [...text.matchAll(tagRe('item'))].map(m => {
    const a = attrsOf(m[1]);
    return { objectid: a.objectid, transform: parseTransform(a.transform, unit), printable: a.printable !== '0' };
  });
  return { objects, items, bad };
}

// model_settings.config: Name, Slot (extruder), Teiletyp je Bauteil und die Platten
function parseModelSettings(text) {
  const objects = new Map(), plates = [];
  if (!text) return { objects, plates };
  const meta = (xml, key) => { const m = new RegExp('<metadata key="' + key + '" value="([^"]*)"').exec(xml); return m ? m[1] : null; };
  for (const m of text.matchAll(blockRe('object'))) {
    const head = m[2].split('<part')[0], parts = new Map();
    for (const p of m[2].matchAll(blockRe('part'))) { const pa = attrsOf(p[1] || ''); parts.set(pa.id, { subtype: pa.subtype || 'normal_part', extruder: meta(p[2], 'extruder'), name: meta(p[2], 'name') }); }
    objects.set(attrsOf(m[1] || '').id, { name: meta(head, 'name'), extruder: meta(head, 'extruder'), parts });
  }
  for (const m of text.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    // Instanzen einzeln: dasselbe Objekt kann mehrfach auf verschiedenen Platten stehen
    const inst = [...m[1].matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)].map(x => ({ id: meta(x[1], 'object_id'), instance: +(meta(x[1], 'instance_id') || 0) }));
    plates.push({ id: +(meta(m[1], 'plater_id') || plates.length + 1), name: meta(m[1], 'plater_name') || '', objects: inst.map(x => x.id), instances: inst });
  }
  return { objects, plates };
}

const unxml = s => String(s).replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e]));

function parse3MF(fileName, zip, zipLib) {
  const text = p => zip[p] ? zipLib.strFromU8(zip[p]) : null;
  const rels = text('_rels/.rels') || '';
  const rootPath = ((/Target="\/?([^"]+\.model)"/.exec(rels) || [])[1]) || Object.keys(zip).find(k => /^3D\/[^/]+\.model$/i.test(k));
  if (!rootPath || !zip[rootPath]) throw Error(t('kein 3D-Modell in der 3MF gefunden'));
  const models = new Map();
  const model = p => { if (!models.has(p)) { const xml = text(p); if (xml === null) throw Error(t('{file} fehlt', { file: p })); models.set(p, parseModelXML(xml)); } return models.get(p); };
  const root = model(rootPath);
  progressAt(0.5);
  const settings = parseModelSettings(text('Metadata/model_settings.config'));
  const plateOf = new Map();
  settings.plates.forEach(pl => pl.instances.forEach(x => plateOf.set(x.id + '#' + x.instance, pl.id)));
  const seen = new Map(); // Build-Items je Objekt zählen → Instanznummer

  // Alle Dreiecke eines Objekts (rekursiv über Komponenten) mit der Gesamttransformation sammeln
  // volumes (nur oberste Ebene): je Bauteil {partId, count} – das sind die Körper des Objekts
  function collect(path, id, T, skipPart, out, depth, volumes, flags = {}, onSkip = null) {
    if (depth > 8) throw Error(t('verschachtelte Komponenten zu tief'));
    const obj = model(path).objects.get(id);
    if (!obj) throw Error(t('Objekt {id} fehlt in {file}', { id, file: path }));
    if (obj.mesh && obj.mesh.painted) flags.painted = flags.paintTris = true;
    if (obj.mesh) {
      const { v, t } = obj.mesh;
      // Herkunft der Dreiecke (Datei, Objekt, erster Index im Teil): eigene Bemalung wird beim Export dorthin geschrieben
      (flags.src = flags.src || []).push({ path, id, start: out.length / 9, count: t.length / 3, ...(obj.mesh.drop ? { drop: obj.mesh.drop } : {}) });
      if (obj.mesh.pc) for (const [i, code] of Object.entries(obj.mesh.pc)) (flags.pc = flags.pc || {})[out.length / 9 + +i] = code;
      if (obj.mesh.sc) for (const [i, code] of Object.entries(obj.mesh.sc)) (flags.sc = flags.sc || {})[out.length / 9 + +i] = code;
      if (obj.mesh.zc) for (const [i, code] of Object.entries(obj.mesh.zc)) (flags.zc = flags.zc || {})[out.length / 9 + +i] = code;
      // Filament je Dreieck parallel zu out (0 = unbemalt); erst anlegen, wenn eine Bemalung vorkommt
      if (obj.mesh.ps || flags.ps) {
        if (!flags.ps) flags.ps = new Array(out.length / 9).fill(0);
        for (let i = 0; i < t.length / 3; i++) flags.ps.push(obj.mesh.ps ? obj.mesh.ps[i] : 0);
        if (obj.mesh.pstates) { flags.pstates = flags.pstates || new Set(); obj.mesh.pstates.forEach(s => flags.pstates.add(s)); }
      }
      for (let i = 0; i < t.length; i++) {
        const k = t[i] * 3, x = v[k], y = v[k + 1], z = v[k + 2];
        out.push(x * T[0] + y * T[3] + z * T[6] + T[9], x * T[1] + y * T[4] + z * T[7] + T[10], x * T[2] + y * T[5] + z * T[8] + T[11]);
      }
    }
    for (const c of obj.components) {
      if (skipPart(c.objectid)) { if (onSkip) onSkip(c, T, path); continue; }
      const before = out.length;
      collect(c.path ? c.path.replace(/^\//, '') : path, c.objectid, mulTransform(c.transform, T), () => false, out, depth + 1, null, flags);
      if (volumes && out.length > before) volumes.push({ partId: c.objectid, count: (out.length - before) / 9 });
    }
  }

  const parts = [], notes = [];
  let skipped = 0, offPlate = 0;
  // Objekte, die das Projekt nicht druckt: in Bambu/Orca auf „nicht drucken“ (printable="0") oder auf keiner Platte
  // (neben dem Bett abgelegt). Sie mitzunehmen schob beim Mitten des Designer-Layouts das echte Teil vom Bett
  // (2026-10-02, Bambu-3MF „KOBRA-3-S1-REDONDO…“: Orca brach ab, keine Objekte auf der Platte).
  const hasPlates = settings.plates.some(pl => pl.instances.length);
  root.items.forEach((item, ii) => {
    progressAt(0.5 + 0.5 * ii / root.items.length);
    const obj = root.objects.get(item.objectid);
    if (!obj || (obj.type && obj.type !== 'model')) return;
    const inst0 = seen.get(item.objectid) || 0;
    if (!item.printable || (hasPlates && !plateOf.has(item.objectid + '#' + inst0))) { seen.set(item.objectid, inst0 + 1); offPlate++; return; }
    const ms = settings.objects.get(item.objectid);
    // Modifier, Negativteile und Stützen-Blocker/-Erzwinger sind keine druckbaren Körper
    const skipPart = pid => { const p = ms && ms.parts.get(pid); const skip = !!p && p.subtype !== 'normal_part'; if (skip) skipped++; return skip; };
    const instance = seen.get(item.objectid) || 0;
    seen.set(item.objectid, instance + 1);
    const out = [], volumes = [], flags = {}, modVols = [];
    // Farb-Modifikatoren (eigener Slot) nur zur Anzeige mitnehmen: die 3D-Ansicht färbt die Flächen darin ein (js/modpaint.js)
    const onSkip = (c, T, path) => {
      const p = ms && ms.parts.get(c.objectid);
      if (!p || p.subtype !== 'modifier_part' || !p.extruder || p.extruder === ms.extruder) return;
      const arr = [];
      collect(c.path ? c.path.replace(/^\//, '') : path, c.objectid, mulTransform(c.transform, T), () => false, arr, 1, null, {});
      if (arr.length) modVols.push({ extruder: +p.extruder, pos: Float32Array.from(arr) });
    };
    collect(rootPath, item.objectid, item.transform, skipPart, out, 0, volumes, flags, onSkip);
    // Modifikator mit eigenem Slot (z. B. Text/Logo des Designers) färbt das Teil – ebenfalls mehrfarbig
    const mods = ms ? [...new Set([...ms.parts.values()].filter(p => p.subtype === 'modifier_part' && p.extruder && p.extruder !== ms.extruder).map(p => +p.extruder))] : [];
    if (mods.length) flags.painted = true;
    if (!out.length) return;
    // Mehrere Bauteile im Objekt = Körper mit eigenem Slot (Mehrfarbig); Name und Slot aus model_settings
    const bodies = volumes.length > 1 && volumes.reduce((s, v) => s + v.count, 0) === out.length / 9
      ? volumes.map((v, j) => { const p = ms && ms.parts.get(v.partId);
        return { name: unxml((p && p.name) || 'Körper ' + (j + 1)), count: v.count, partId: v.partId, extruder: p && p.extruder ? +p.extruder : null }; })
      : null;
    parts.push({
      name: unxml((ms && ms.name) || obj.name || 'Objekt ' + item.objectid),
      pos: Float32Array.from(out), objectId: item.objectid, instance,
      extruder: ms && ms.extruder ? +ms.extruder : null, plate: plateOf.get(item.objectid + '#' + instance) || 1, printable: item.printable,
      ...(bodies ? { bodies } : {}), ...(flags.painted ? { painted: true } : {}), ...(mods.length ? { modifiers: mods } : {}), ...(flags.paintTris ? { paintTris: true } : {}),
      ...(modVols.length ? { modVols } : {}),
      // Bemalung: Filament je Dreieck (1-basiert, 0 = Slot des Teils) und die vorkommenden Filamente des Designers
      ...(flags.ps && flags.ps.length === out.length / 9 ? { paintState: Uint8Array.from(flags.ps), paintSlots: [...flags.pstates].filter(s => s > 0).sort((a, b) => a - b) } : {}),
      ...(flags.pc && flags.ps && flags.ps.length === out.length / 9 ? { paintCodes: flags.pc } : {}), ...(flags.src ? { paintSrc: flags.src } : {}),
      ...(flags.sc ? { supCodes: flags.sc } : {}), ...(flags.zc ? { seamCodes: flags.zc } : {})
    });
  });
  const badTris = [...models.values()].reduce((s, m) => s + (m.bad || 0), 0);
  if (badTris) notes.push(badTrisNote(fileName, badTris));
  if (!parts.length) throw Error(t('keine druckbaren Objekte in {file}', { file: fileName }));
  if (skipped) notes.push(t('{n} Modifier/Hilfskörper ausgelassen (werden nicht gedruckt).', { n: skipped }));
  if (offPlate) notes.push(t('{n} Objekt(e) im Projekt auf „nicht drucken“ oder neben den Platten – weggelassen, wie in Bambu Studio/OrcaSlicer.', { n: offPlate }));
  let projectSettings = null;
  try { projectSettings = JSON.parse(text('Metadata/project_settings.config') || 'null'); } catch (e) { notes.push(t('Einstellungen der 3MF nicht lesbar – nur die Geometrie wird verwendet.')); }
  return { parts, notes, threemf: { name: fileName, zip, plates: settings.plates, settings: projectSettings } };
}

/* ---------- Einstieg ---------- */
/* STL hat keine Einheit. Manche Programme (Blender, Onshape …) speichern in Meter – dann ist das Teil nur Bruchteile
   eines Millimeters groß und Orca kann es nicht slicen. Wie OrcaSlicer: ist die längste Seite unter 0,5 mm und wären es
   in Meter gelesen 5–1000 mm, wird auf mm umgerechnet (mit Hinweis). */
const STL_METER_MAX_MM = 0.5, STL_INCH_MAX_MM = 10;
function stlMaxSize(pos) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < lo[k]) lo[k] = pos[i]; if (pos[i] > hi[k]) hi[k] = pos[i]; }
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}
function stlToMm(pos, fileName, notes) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < lo[k]) lo[k] = pos[i]; if (pos[i] > hi[k]) hi[k] = pos[i]; }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(size > 0) || size >= STL_METER_MAX_MM || size * 1000 < 5 || size * 1000 > 1000) return pos;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) out[i] = pos[i] * 1000;
  out.unitFixed = 'm';
  notes.push(t('{file}: in Meter gespeichert ({size} mm groß) – auf Millimeter umgerechnet ({mm} mm).', { file: fileName.replace(/^.*[\\/]/, ''), size: de(size, 3), mm: de(size * 1000, 1) }));
  return out;
}
function stlParts(fileName, bytes, notes = []) {
  const raw = progressSub(0, 0.3, () => readSTL(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  if (raw.dropped) notes.push(badTrisNote(fileName, raw.dropped));
  const pos = stlToMm(raw, fileName, notes);
  const groups = progressSub(0.3, 1, () => splitBodyGroups(pos));
  const base = fileName.replace(/^.*[\\/]/, '');
  // Sehr kleine STL: vielleicht in Zoll gespeichert – nicht eindeutig, deshalb nur ein Angebot in der Seite (inchHint)
  const inch = !pos.unitFixed && stlMaxSize(pos) <= STL_INCH_MAX_MM && stlMaxSize(pos) * 25.4 <= 1000;
  return groups.map((g, i) => ({ name: groups.length > 1 ? base + ' · Teil ' + (i + 1) : base, pos: g.pos, ...(inch ? { inchHint: true } : {}),
    ...(g.bodies.length > 1 ? { bodies: g.bodies.map((count, j) => ({ name: 'Körper ' + (j + 1), count })) } : {}) }));
}

/* OBJ (Wavefront, 2026-10-18): nur die Geometrie – v und f (Vielecke als Fächer in Dreiecke, Indizes auch negativ und
   mit /vt/vn), Farben/Materialien (usemtl, MTL) bleiben außen vor. Getrennte Objekte (o, sonst g) werden eigene Teile;
   ohne Gruppen wie bei STL: getrennte Körper als Teile. Achsen wie in OrcaSlicer unverändert (Z oben), Meter → mm wie STL. */
function objParts(fileName, bytes, notes = []) {
  const text = new TextDecoder().decode(bytes), v = [], groups = [];
  let cur = null, by = null, hasO = /^o\s/m.test(text), badObj = 0;
  const open = name => { cur = { name, tris: [] }; groups.push(cur); };
  const idx = (s, n) => { const i = parseInt(s, 10); return i < 0 ? n + i : i - 1; };
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    if (!(li & 262143)) progressAt(0.6 * li / lines.length);
    const line = lines[li].trim();
    if (!line || line[0] === '#') continue;
    const sp = line.split(/\s+/), k = sp[0];
    if (k === 'v') v.push(+sp[1], +sp[2], +sp[3]);
    else if ((k === 'o' || (k === 'g' && !hasO)) && sp.length > 1) open(sp.slice(1).join(' '));
    else if (k === 'f' && sp.length >= 4) {
      if (!cur) open('');
      const n = v.length / 3, ids = sp.slice(1).map(x => idx(x.split('/')[0], n));
      if (ids.some(i => !(i >= 0 && i < n))) throw Error(t('{file}: Fläche verweist auf einen Punkt, den es nicht gibt.', { file: fileName }));
      const okV = i => Number.isFinite(v[3 * i]) && Number.isFinite(v[3 * i + 1]) && Number.isFinite(v[3 * i + 2]);
      for (let j = 1; j + 1 < ids.length; j++) {
        const tri = [ids[0], ids[j], ids[j + 1]];
        if (!tri.every(okV)) { badObj++; continue; }   // Punkt mit ungültigen Koordinaten (z. B. „v 1 nan 2“)
        for (const i of tri) cur.tris.push(v[3 * i], v[3 * i + 1], v[3 * i + 2]);
      }
    }
  }
  if (badObj) notes.push(badTrisNote(fileName, badObj));
  const used = groups.filter(g => g.tris.length);
  if (!used.length) throw Error(t('{file}: keine Flächen in der OBJ.', { file: fileName }));
  const base = fileName.replace(/^.*[\\/]/, ''), all = new Float32Array(used.reduce((a, g) => a + g.tris.length, 0));
  let o = 0; for (const g of used) { all.set(g.tris, o); o += g.tris.length; }
  const mm = stlToMm(all, fileName, notes), f = mm === all ? 1 : 1000;   // Meter: alle Gruppen gleich umrechnen
  if (used.length === 1) {
    const groupsB = progressSub(0.6, 1, () => splitBodyGroups(mm));
    return groupsB.map((g, i) => ({ name: groupsB.length > 1 ? base + ' · Teil ' + (i + 1) : (used[0].name || base), pos: g.pos,
      ...(g.bodies.length > 1 ? { bodies: g.bodies.map((count, j) => ({ name: 'Körper ' + (j + 1), count })) } : {}) }));
  }
  return used.map((g, i) => ({ name: g.name || base + ' · Teil ' + (i + 1), pos: f === 1 ? Float32Array.from(g.tris) : Float32Array.from(g.tris, x => x * f) }));
}

// entries: [{name, bytes: Uint8Array}] – ausgewählte oder gezogene Dateien
function importModels(entries, zipLib) {
  const notes = [];
  let files = [];
  for (const e of entries) {
    if (e.bytes && e.bytes.length > IMPORT_MAX_BYTES) throw tooBig(e.name);
    if (/\.zip$/i.test(e.name)) {
      const zip = safeUnzip(e.name, e.bytes, zipLib, k => MODEL_EXT.test(k));
      const inner = Object.keys(zip).filter(k => MODEL_EXT.test(k) && !/(^|\/)(__MACOSX|\.)/.test(k) && zip[k].length);
      if (!inner.length) notes.push(t('{file}: keine STL/OBJ/3MF darin.', { file: e.name }));
      files.push(...inner.map(k => ({ name: k.replace(/^.*\//, ''), bytes: zip[k], from: e.name })));
    } else if (MODEL_EXT.test(e.name)) files.push(e);
    else notes.push(t(/\.(gcode|gco|g)$/i.test(e.name) ? '{file}: fertiger G-Code – unter ④ Drucker → „G-Code drucken …“ senden.' : '{file}: nur STL, OBJ, 3MF oder ZIP.', { file: e.name }));
  }
  // Makerworld-ZIPs enthalten oft dasselbe Modell als 3MF und als STLs: genau eine 3MF hat Vorrang.
  const tmf = files.filter(f => /\.3mf$/i.test(f.name));
  if (tmf.length === 1 && files.length > 1) {
    notes.push(t('Die 3MF „{file}“ wird verwendet, {n} weitere Datei(en) ignoriert.', { file: tmf[0].name, n: files.length - 1 }));
    files = tmf;
  }
  if (!files.length) throw Error(notes.join(' ') || t('keine Modelldatei'));

  const parts = [];
  let threemf = null, done = 0;
  // Fortschritt (nur im Hintergrund, js/stl.js progressSub): Anteil je Datei nach Größe
  const sizeAll = files.reduce((a, f) => a + ((f.bytes && f.bytes.length) || 0), 0) || 1;
  for (const f of files) {
    if (f.bytes && f.bytes.length > IMPORT_MAX_BYTES) throw tooBig(f.name);
    const from = done / sizeAll; done += (f.bytes && f.bytes.length) || 0;
    // zu wenig Speicher / Netz zu groß für ein Array (RangeError) → verständliche Meldung statt „Invalid array length“
    progressSub(from, done / sizeAll, () => {
      try {
        if (/\.3mf$/i.test(f.name)) {
          const r = parse3MF(f.name, safeUnzip(f.name, f.bytes, zipLib), zipLib);
          parts.push(...r.parts); notes.push(...r.notes);
          if (files.length === 1) threemf = r.threemf;
        } else if (/\.obj$/i.test(f.name)) parts.push(...objParts(f.name, f.bytes, notes));
        else parts.push(...stlParts(f.name, f.bytes, notes));
      } catch (err) { if (err instanceof RangeError) throw tooBig(f.name); throw err; }
    });
  }
  if (files.length > 1 && tmf.length) notes.push(t('Mehrere 3MF: nur die Geometrie wird übernommen, nicht Platten und Einstellungen.'));
  const name = entries.length === 1 ? entries[0].name.replace(/^.*[\\/]/, '') : t('{n} Teile', { n: parts.length });
  return { name, parts, threemf, notes };
}

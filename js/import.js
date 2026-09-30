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
const MODEL_EXT = /\.(stl|3mf)$/i;

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
function splitBodyGroups(pos) {
  const n = pos.length / 9;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
    const o = t * 9 + v * 3;
    const key = Math.round(pos[o] / WELD_MM) + ',' + Math.round(pos[o + 1] / WELD_MM) + ',' + Math.round(pos[o + 2] / WELD_MM);
    const other = seen.get(key);
    if (other === undefined) seen.set(key, t); else { const a = find(t), b = find(other); if (a !== b) parent[a] = b; }
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
      for (const t of meshXml[2].matchAll(tagRe('triangle'))) {
        const ta = attrsOf(t[1]); ts.push(+ta.v1, +ta.v2, +ta.v3);
        if (ta.paint_supports) (sc = sc || {})[ts.length / 3 - 1] = ta.paint_supports;
        if (ta.paint_seam) (zc = zc || {})[ts.length / 3 - 1] = ta.paint_seam;
        if (ta.paint_color) { painted = true; if (canPaint) { ps[ts.length / 3 - 1] = paintMain(ta.paint_color); if (ta.paint_color.length > 2) paintStates(ta.paint_color).forEach(s => pstates.add(s));
          if (parseInt(ta.paint_color[ta.paint_color.length - 1], 16) & 3) pc[ts.length / 3 - 1] = ta.paint_color; } }
      }
      if (painted && canPaint) for (let i = 0; i < ts.length / 3; i++) { ps[i] = ps[i] || 0; pstates.add(ps[i]); }
      obj.mesh = { v: Float64Array.from(vs), t: Uint32Array.from(ts), painted, sc, zc, ...(painted && canPaint ? { ps: Uint8Array.from(ps), pstates, pc } : {}) };
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
  return { objects, items };
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
      (flags.src = flags.src || []).push({ path, id, start: out.length / 9, count: t.length / 3 });
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
  let skipped = 0;
  root.items.forEach(item => {
    const obj = root.objects.get(item.objectid);
    if (!obj || (obj.type && obj.type !== 'model')) return;
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
  if (!parts.length) throw Error(t('keine druckbaren Objekte in {file}', { file: fileName }));
  if (skipped) notes.push(t('{n} Modifier/Hilfskörper ausgelassen (werden nicht gedruckt).', { n: skipped }));
  let projectSettings = null;
  try { projectSettings = JSON.parse(text('Metadata/project_settings.config') || 'null'); } catch (e) { notes.push(t('Einstellungen der 3MF nicht lesbar – nur die Geometrie wird verwendet.')); }
  return { parts, notes, threemf: { name: fileName, zip, plates: settings.plates, settings: projectSettings } };
}

/* ---------- Einstieg ---------- */
function stlParts(fileName, bytes) {
  const pos = readSTL(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const groups = splitBodyGroups(pos);
  const base = fileName.replace(/^.*[\\/]/, '');
  return groups.map((g, i) => ({ name: groups.length > 1 ? base + ' · Teil ' + (i + 1) : base, pos: g.pos,
    ...(g.bodies.length > 1 ? { bodies: g.bodies.map((count, j) => ({ name: 'Körper ' + (j + 1), count })) } : {}) }));
}

// entries: [{name, bytes: Uint8Array}] – ausgewählte oder gezogene Dateien
function importModels(entries, zipLib) {
  const notes = [];
  let files = [];
  for (const e of entries) {
    if (/\.zip$/i.test(e.name)) {
      const zip = zipLib.unzipSync(e.bytes);
      const inner = Object.keys(zip).filter(k => MODEL_EXT.test(k) && !/(^|\/)(__MACOSX|\.)/.test(k) && zip[k].length);
      if (!inner.length) notes.push(t('{file}: keine STL/3MF darin.', { file: e.name }));
      files.push(...inner.map(k => ({ name: k.replace(/^.*\//, ''), bytes: zip[k], from: e.name })));
    } else if (MODEL_EXT.test(e.name)) files.push(e);
    else notes.push(t('{file}: nur STL, 3MF oder ZIP.', { file: e.name }));
  }
  // Makerworld-ZIPs enthalten oft dasselbe Modell als 3MF und als STLs: genau eine 3MF hat Vorrang.
  const tmf = files.filter(f => /\.3mf$/i.test(f.name));
  if (tmf.length === 1 && files.length > 1) {
    notes.push(t('Die 3MF „{file}“ wird verwendet, {n} weitere Datei(en) ignoriert.', { file: tmf[0].name, n: files.length - 1 }));
    files = tmf;
  }
  if (!files.length) throw Error(notes.join(' ') || t('keine Modelldatei'));

  const parts = [];
  let threemf = null;
  for (const f of files) {
    if (/\.3mf$/i.test(f.name)) {
      const r = parse3MF(f.name, zipLib.unzipSync(f.bytes), zipLib);
      parts.push(...r.parts); notes.push(...r.notes);
      if (files.length === 1) threemf = r.threemf;
    } else parts.push(...stlParts(f.name, f.bytes));
  }
  if (files.length > 1 && tmf.length) notes.push(t('Mehrere 3MF: nur die Geometrie wird übernommen, nicht Platten und Einstellungen.'));
  const name = entries.length === 1 ? entries[0].name.replace(/^.*[\\/]/, '') : t('{n} Teile', { n: parts.length });
  return { name, parts, threemf, notes };
}

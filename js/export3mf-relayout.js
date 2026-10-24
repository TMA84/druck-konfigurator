'use strict';
/* 3MF-Export, Teil Makerworld-/Orca-3MF (aus js/export3mf.js): neu anordnen (layout3mf), Platten auf die Bettmitte,
   Objekt-Köpfe, Slots und Transformationen anpassen, Beschriftung auf Objekten des Designers, Build-Items und Platten
   neu schreiben (relayout3mf). */

/* ---------- Makerworld-/Orca-3MF neu anordnen (2026-09-29) ----------
   Teile, die das Tool selbst platziert: part.extra = hinzugefügtes einfaches Teil (STL oder Geometrie einer weiteren
   Datei, objectId null), part.copy = Kopie eines 3MF-Objekts (weitere Instanz desselben Objekts), part.moved = auf
   eine andere Platte verschoben. threemf.layout: 'auto' = alles platzsparend (Knopf „Platzsparend anordnen“),
   'plates' = danach eigene Plattenzuordnung, sonst Platten des Designers. */
const ownPlaced = p => !!p && !!(p.extra || p.copy || p.moved);
// Muss die 3MF neu angeordnet werden (Build-Items, Platten; auch wenn Teile entfernt wurden)? Sonst bleibt die Lage des Designers (nur auf die Bettmitte gerückt).
const needsRelayout = (threemf, parts) => !!(threemf && (threemf.layout || threemf.removed)) || parts.some(ownPlaced);
/* items: [{geom, plate (1-basiert), own}]. Platten ohne eigene Teile (und nicht angeordnet) behalten die Lage des Designers,
   auf die Bettmitte gerückt; die übrigen packt das Tool (packPlates, läuft eine über, folgt eine weitere Platte).
   Platten werden ohne Lücken durchnummeriert. Ergebnis wie arrangeParts, dazu plateOf (1-basiert), designer (Set
   der Plattennummern mit Designer-Lage) und oversizePlates. places[i].x/y = Mitte des Hüllrechtecks in Orca-Welt-
   koordinaten, auch für Teile in Designer-Lage (dort rot = false). */
function layout3mf(items, tpl, mode) {
  const geoms = items.map(p => p.geom), pads = items.map(p => p.pad || 0), [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter, vol = buildVolume(tpl);
  const designer = new Set(), oversizePlates = [];
  if (mode === 'auto') {
    const r = arrangeParts(geoms, tpl, null, pads);
    return { count: r.plateCount, plateOf: r.places.map(p => p.plate + 1), places: r.places, overflow: false, oversize: r.oversize, oversizePlates, designer };
  }
  const plateNo = p => p.plate || 1, all = items.map((p, i) => i);
  const nums = [...new Set(items.map(plateNo))].sort((a, b) => a - b);
  const packNums = nums.filter(k => mode === 'plates' || items.some(p => plateNo(p) === k && p.own));
  const pk = packNums.length ? packPlates(geoms, packNums.map(k => all.filter(i => plateNo(items[i]) === k)), tpl, null, pads) : null;
  const local = [];
  let f = 0, overflow = false;
  for (const k of nums) {
    const idx = all.filter(i => plateNo(items[i]) === k);
    if (!packNums.includes(k)) {
      f++; designer.add(f);
      const mnx = Math.min(...idx.map(i => geoms[i].mn[0])), mxx = Math.max(...idx.map(i => geoms[i].mx[0]));
      const mny = Math.min(...idx.map(i => geoms[i].mn[1])), mxy = Math.max(...idx.map(i => geoms[i].mx[1]));
      const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
      for (const i of idx) local[i] = { f, lx: (geoms[i].mn[0] + geoms[i].mx[0]) / 2 - cx + bx, ly: (geoms[i].mn[1] + geoms[i].mx[1]) / 2 - cy + by, rot: false };
      if (mxx - mnx > bw || mxy - mny > bd || Math.max(...idx.map(i => geoms[i].z)) > vol[2] + 0.01) oversizePlates.push(f);
    } else {
      const bins = [...new Set(idx.map(i => pk.places[i].plate))].sort((a, b) => a - b), base = f;
      if (bins.length > 1) overflow = true;
      f += bins.length;
      for (const i of idx) { const pl = pk.places[i]; local[i] = { f: base + 1 + bins.indexOf(pl.plate), lx: pl.lx, ly: pl.ly, rot: pl.rot, ang: pl.ang }; }
    }
  }
  const cols = Math.ceil(Math.sqrt(f || 1));
  const places = local.map(L => { const pi = L.f - 1; return { plate: pi, x: (pi % cols) * bw * PLATE_STRIDE + L.lx, y: -Math.floor(pi / cols) * bd * PLATE_STRIDE + L.ly, lx: L.lx, ly: L.ly, rot: L.rot, ang: L.ang }; });
  // zu groß: in Designer-Lage so, wie es liegt; beim Packen auch gedreht nicht
  const oversize = all.filter(i => volumeExcess(geoms[i], vol).length && (designer.has(local[i].f) || volumeExcess({ x: geoms[i].y, y: geoms[i].x, z: geoms[i].z }, vol).length));
  return { count: f, plateOf: local.map(L => L.f), places, overflow, oversize, oversizePlates, designer };
}

/* ---------- Vorhandene 3MF (z. B. Makerworld) auf den eigenen Drucker umstellen ----------
   Entscheidung 2026-09-26: Lage, Platten, Farben und Bemalung des Designers bleiben. Ersetzt werden
   die Einstellungen (project_settings aus der eigenen Orca-Vorlage + berechnete Werte), je Objekt
   Slot und die selbst berechneten Objektwerte; jede Platte wird auf die Bettmitte gerückt. */
const PLATE_SLICE_FILES = /^Metadata\/plate_\d+\.gcode(\.md5)?$/;

// Mitte der Teile je Platte → Verschiebung auf die Bettmitte der Platte im eigenen Drucker
function plateShifts(jobs, tpl) {
  const [bw, bd] = bedSize(tpl), [bx, by] = tpl.bedCenter;
  const ids = [...new Set(jobs.map(j => j.plate || 1))].sort((a, b) => a - b);
  const count = Math.max(...ids), cols = Math.ceil(Math.sqrt(count)), shifts = new Map(), oversize = [];
  for (const id of ids) {
    const on = jobs.filter(j => (j.plate || 1) === id);
    const mnx = Math.min(...on.map(j => j.geom.mn[0])), mxx = Math.max(...on.map(j => j.geom.mx[0]));
    const mny = Math.min(...on.map(j => j.geom.mn[1])), mxy = Math.max(...on.map(j => j.geom.mx[1]));
    const pi = id - 1, tx = (pi % cols) * bw * PLATE_STRIDE + bx, ty = -Math.floor(pi / cols) * bd * PLATE_STRIDE + by;
    shifts.set(id, [tx - (mnx + mxx) / 2, ty - (mny + mxy) / 2]);
    if (mxx - mnx > bw || mxy - mny > bd || Math.max(...on.map(j => j.geom.z)) > buildVolume(tpl)[2] + 0.01) oversize.push(id);
  }
  return { shifts, oversize };
}

// Objekt-Kopf in model_settings.config: Slot setzen, eigene Werte setzen bzw. auf global zurücknehmen
function patchObjectHead(head, extruder, own, computedKeys) {
  const setMeta = (h, key, value) => {
    const re = new RegExp('(<metadata key="' + key + '" value=")[^"]*(")');
    return re.test(h) ? h.replace(re, '$1' + xmlEsc(value) + '$2') : h.replace(/(<object id="[^"]*">\n?)/, '$1    <metadata key="' + key + '" value="' + xmlEsc(value) + '"/>\n');
  };
  let h = setMeta(head, 'extruder', extruder);
  const ownKeys = new Set(own.map(c => c.key));
  for (const key of computedKeys) if (!ownKeys.has(key)) h = h.replace(new RegExp('[ \\t]*<metadata key="' + key + '" value="[^"]*"/>\\n?', 'g'), '');
  for (const c of own) h = setMeta(h, c.key, c.value);
  return h;
}

// Slot eines Bauteils (Körper) im Objekt setzen; extruder null = Slot des Objekts (Eintrag entfernen)
function patchPartExtruder(ms, objectId, partId, extruder) {
  const pid = String(partId).replace(/[^\w-]/g, '');
  const objRe = new RegExp('(<object id="' + objectId + '">[\\s\\S]*?</object>)');
  return ms.replace(objRe, obj => obj.replace(new RegExp('(<part id="' + pid + '"[^>]*>)([\\s\\S]*?)(</part>)'), (all, open, body, close) => {
    const re = /[ \t]*<metadata key="extruder" value="[^"]*"\/>\n?/;
    body = body.replace(re, '');
    if (extruder !== null) body = body.replace(/^(\n?)/, '$1      <metadata key="extruder" value="' + extruder + '"/>\n');
    return open + body + close;
  }));
}

/* Farb-Modifikatoren des Designers auf andere Slots legen: map {Slot des Designers (0-basiert): eigener Slot}.
   Nur Modifikatoren (subtype modifier_part); Bemalung je Dreieck (paint_color) bleibt beim Slot des Designers. */
function patchModifierExtruders(ms, objectId, map, nFil) {
  const objRe = new RegExp('(<object id="' + objectId + '">[\\s\\S]*?</object>)');
  return ms.replace(objRe, obj => obj.replace(/(<part\b[^>]*subtype="modifier_part"[^>]*>)([\s\S]*?)(<\/part>)/g, (all, open, body, close) =>
    open + body.replace(/(<metadata key="extruder" value=")(\d+)("\/>)/, (m, a, v, b) => {
      const to = map[+v - 1];
      return to == null ? m : a + (Math.min(to, nFil - 1) + 1) + b;
    }) + close));
}

/* Lage eines Build-Items neu: erst die Transformation des Designers (Zeilenvektor · m), dann um die Mitte c des
   Hüllrechtecks (Weltkoordinaten) optional +90° um Z drehen und diese Mitte auf (pl.x, pl.y) setzen. Höhe bleibt. */
const ROT_Z90 = [0, 1, 0, -1, 0, 0, 0, 0, 1], ROT_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function relocateTransform(m, c, pl) {
  const R = rotZ(placeAng(pl)), out = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) out.push(m[r * 3] * R[k] + m[r * 3 + 1] * R[3 + k] + m[r * 3 + 2] * R[6 + k]);
  const tx = m[9] - c[0], ty = m[10] - c[1], tz = m[11];
  out.push(tx * R[0] + ty * R[3] + tz * R[6] + pl.x, tx * R[1] + ty * R[4] + tz * R[7] + pl.y, tx * R[2] + ty * R[5] + tz * R[8]);
  return out;
}
// 3MF-Objekt vergrößern/verkleinern: Weltachsen um die Mitte der Grundfläche pv skalieren (Zeilenvektor · Matrix)
function scaleItemTransform(m, s, pv) {
  if (!s || (s[0] === 1 && s[1] === 1 && s[2] === 1)) return m;
  const o = m.slice();
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[r * 3 + k] = m[r * 3 + k] * s[k];
  for (let k = 0; k < 3; k++) o[9 + k] = (m[9 + k] - pv[k]) * s[k] + pv[k];
  return o;
}
/* Transformation eines 3MF-Objekts passend zu part.geom: erst die Drehung part.R (Weltachsen, wie rotatePositions), dann
   die Größe part.scale um die Mitte der Grundfläche, zuletzt zurück aufs Bett (Unterkante wie vorher). Ohne Drehung und
   Größe unverändert. g = part.geom (gedreht und skaliert), g0z = Unterkante vor der Drehung (Designer: meist 0). */
function partItemTransform(m, part, g) {
  const R = part && part.R, rot = R && R.some((v, i) => v !== [1, 0, 0, 0, 1, 0, 0, 0, 1][i]), sc = part && part.scale;
  if (!rot && !(sc && (sc[0] !== 1 || sc[1] !== 1 || sc[2] !== 1))) return m;
  let o = m.slice();
  if (rot) {
    // Zeilenvektor: w' = w · Rᵀ → M' = M · Rᵀ, t' = t · Rᵀ
    const mul = row => [0, 1, 2].map(k => row[0] * R[k * 3] + row[1] * R[k * 3 + 1] + row[2] * R[k * 3 + 2]);
    for (let r = 0; r < 4; r++) { const v = mul([o[r * 3], o[r * 3 + 1], o[r * 3 + 2]]); o[r * 3] = v[0]; o[r * 3 + 1] = v[1]; o[r * 3 + 2] = v[2]; }
  }
  o = scaleItemTransform(o, sc, geomPivot(g));
  if (rot) {   // gedrehtes Teil wieder auf das Bett: Unterkante wie vor der Drehung (origPos, meist 0)
    let z0 = Infinity; const P = part.origPos || []; for (let i = 2; i < P.length; i += 3) if (P[i] < z0) z0 = P[i];
    o[11] += (isFinite(z0) ? z0 : 0) - g.mn[2];
  }
  return o;
}
/* Beschriftung auf Objekten des Designers (Makerworld-3MF): je Text ein weiteres Bauteil im Objekt – erhaben mit eigenem
   Slot (normal_part), vertieft als negative_part, wie OrcaSlicer es selbst speichert. Das Netz kommt als eigenes Objekt ins
   Hauptmodell und als Komponente in das Objekt des Designers, in dessen Koordinaten: Text (Koordinaten wie part.geom) →
   Größe und Drehung des Teils heraus → Welt der 3MF → Objekt (Umkehrung der ursprünglichen Transformation des Build-Items).
   Muss vor dem Verschieben der Build-Items laufen (braucht deren ursprüngliche Transformation). */
function inv3x4(m) {   // Umkehrung einer 3MF-Transformation (Zeilenvektor · 3×3 + t)
  const [a, b, c, d, e, f, g, h, i] = m, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  const t = [0, 1, 2].map(k => -(m[9] * r[k] + m[10] * r[3 + k] + m[11] * r[6 + k]));
  return r.concat(t);
}
function designerTexts(out, rootPath, items, zipLib, nFil) {
  const withText = [], seen = new Set();
  for (const j of items) {
    const p = j.part;
    if (!p || p.extra || p.objectId == null || seen.has(String(p.objectId)) || !itemTexts(j).length) continue;
    seen.add(String(p.objectId)); withText.push(j);
  }
  if (!withText.length || typeof textMesh !== 'function') return 0;
  let model = zipLib.strFromU8(out[rootPath]), ms = zipLib.strFromU8(out['Metadata/model_settings.config'] || zipLib.strToU8(''));
  let maxId = 0;
  for (const [name, data] of Object.entries(out)) if (/\.model$/i.test(name)) {
    const text = name === rootPath ? model : zipLib.strFromU8(data);
    for (const m of text.matchAll(/<(?:\w+:)?object\b[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  }
  for (const m of ms.matchAll(/<(?:object|part) id="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  const hasP = /<(?:\w+:)?model\b[^>]*xmlns:p=/.test(model), resources = [];
  let added = 0;
  for (const j of withText) {
    const p = j.part, id = String(p.objectId);
    const item = [...model.matchAll(/<(?:\w+:)?item\b([^>]*)>/g)].map(x => x[1]).find(a => (/objectid="([^"]+)"/.exec(a) || [])[1] === id);
    const tr = item && (/transform="([^"]+)"/.exec(item) || [])[1], M = tr ? tr.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const Mi = inv3x4(M); if (!Mi) continue;
    const g = p.geom, pv = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]], s = p.scale || [1, 1, 1], R = p.R || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const toLocal = (x, y, z) => {
      const u = [x, y, z].map((v, k) => pv[k] + (v - pv[k]) / s[k]);                                     // Größe heraus
      const w = [0, 1, 2].map(k => R[k] * u[0] + R[3 + k] * u[1] + R[6 + k] * u[2]);                   // Drehung heraus (Rᵀ)
      return [0, 1, 2].map(k => w[0] * Mi[k] + w[1] * Mi[3 + k] + w[2] * Mi[6 + k] + Mi[9 + k]);    // Welt → Objekt
    };
    let partsXml = '';
    for (const x of itemTexts(j)) {
      const mesh = textMesh(typeof textScaled === 'function' ? textScaled(x, p) : x, p.R || null), loc = new Float32Array(mesh.length);
      for (let i = 0; i < mesh.length; i += 3) { const q = toLocal(mesh[i], mesh[i + 1], mesh[i + 2]); loc[i] = q[0]; loc[i + 1] = q[1]; loc[i + 2] = q[2]; }
      const oid = ++maxId, xml = meshObjectXML(loc, [0, 0, 0], oid);
      resources.push(hasP ? xml : xml.replace(/ p:UUID="[^"]*"/, ''));
      model = model.replace(new RegExp('(<(?:\\w+:)?object\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?)(</(?:\\w+:)?components>)'),
        (all, head, close) => head + '   <component objectid="' + oid + '"' + (hasP ? ' p:UUID="' + uuid(oid, 'b206-40ff-9872-83e8017abed1') + '"' : '') + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n  ' + close);
      const name = (x.mode === 'engraved' ? 'Gravur' : 'Schrift') + ' „' + String(x.text).slice(0, 40) + '“';
      partsXml += '    <part id="' + oid + '" subtype="' + (x.mode === 'engraved' ? 'negative_part' : 'normal_part') + '">\n      <metadata key="name" value="' + xmlEsc(name) + '"/>\n' +
        '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
        (x.mode !== 'engraved' && x.slot != null ? '      <metadata key="extruder" value="' + (Math.min(x.slot, nFil - 1) + 1) + '"/>\n' : '') + '    </part>\n';
      added++;
    }
    ms = ms.replace(new RegExp('(<object id="' + id + '">[\\s\\S]*?)(\\n?[ \\t]*</object>)'), (all, body, close) => body + '\n' + partsXml.replace(/\n$/, '') + close);
  }
  if (resources.length) model = model.replace(/(\n?[ \t]*<\/(?:\w+:)?resources>)/, '\n' + resources.join('').replace(/\n$/, '') + '$1');
  out[rootPath] = zipLib.strToU8(model);
  out['Metadata/model_settings.config'] = zipLib.strToU8(ms);
  return added;
}
const geomPivot = g => [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, g.mn[2]];
const fmtTransform = m => m.map(v => { const s = String(Math.round(v * 1e6) / 1e6); return s === '-0' ? '0' : s; }).join(' ');
const PLATE_FILE_KEYS = /[ \t]*<metadata key="(thumbnail_file|thumbnail_no_light_file|top_file|pick_file|pattern_file|pattern_bbox_file)" value="[^"]*"\/>\n?/g;

/* Build-Items, Platten (model_instance) und assemble der 3MF neu schreiben; hinzugefügte einfache Teile als neue
   Objekte (Netz direkt im Hauptmodell, ein Bauteil je Körper, dazu Loch-Modifikatoren) anhängen.
   Kopien eines 3MF-Objekts werden weitere Instanzen desselben Objekts (Orca: gleiche Bauteile, Modifikatoren, Bemalung
   und Objekt-Einstellungen, eigene Lage) – so bleibt die Datei klein und jede Änderung am Objekt gilt für alle Kopien.
   zipFiles: alle Dateien der 3MF (für freie Ids); dmap = designMap (Filament des Designers → eigener Slot, für die Bemalung
   hinzugefügter Teile). Ergebnis {model, ms, objectChanges}. */
function relayout3mf(model, ms, items, lay, settings, partSlot, nFil, zipFiles, zipLib, dmap = {}) {
  // freie Ids oberhalb aller vorhandenen (Objekte und Bauteile, auch in 3D/Objects/*)
  let maxId = 0;
  for (const [name, data] of Object.entries(zipFiles)) if (/\.model$/i.test(name)) {
    const text = name === '3D/3dmodel.model' ? model : zipLib.strFromU8(data);
    for (const m of text.matchAll(/<(?:\w+:)?object\b[^>]*?\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  }
  for (const m of ms.matchAll(/<(?:object|part) id="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
  let nextId = maxId + 1;
  const hasP = /<(?:\w+:)?model\b[^>]*xmlns:p=/.test(model);
  const uuidAttr = (n, tail) => hasP ? ' p:UUID="' + uuid(n, tail) + '"' : '';
  // Build-Items des Designers je Objekt (Reihenfolge = Instanz) und seine Montage-Lage
  const orig = new Map();
  for (const m of model.matchAll(/<(?:\w+:)?item\b([^>]*?)\/?>/g)) {
    const id = (/objectid="([^"]+)"/.exec(m[1]) || [])[1], tr = (/transform="([^"]+)"/.exec(m[1]) || [])[1];
    const t = tr ? tr.trim().split(/\s+/).map(Number) : ROT_ID.concat([0, 0, 0]);
    if (!orig.has(id)) orig.set(id, []);
    orig.get(id).push({ attrs: m[1].replace(/\s*\/?\s*$/, ''), m: t.length === 12 && t.every(Number.isFinite) ? t : ROT_ID.concat([0, 0, 0]) });
  }
  const assembleOf = new Map();
  for (const m of ms.matchAll(/<assemble_item\b([^>]*?)\/?>/g)) {
    const a = attrsOfTag(m[1]);
    assembleOf.set(a.object_id + '#' + (a.instance_id || 0), a.transform);
  }
  const buildXml = [], instances = [], extraObjs = [], resources = [], objectChanges = [], used = new Map();
  items.forEach((j, i) => {
    const pl = lay.places[i], g = j.geom, c = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2];
    const src = j.part && j.part.objectId != null && !j.part.extra && orig.get(String(j.part.objectId));
    if (src && src.length) {
      const id = String(j.part.objectId), base = src[Math.min(j.part.instance || 0, src.length - 1)], inst = used.get(id) || 0;
      used.set(id, inst + 1);
      const tr = fmtTransform(relocateTransform(partItemTransform(base.m, j.part, g), c, pl));
      let attrs = base.attrs.replace(/\s*transform="[^"]*"/, '') + ' transform="' + tr + '"';
      if (inst >= src.length || j.part.copy) attrs = attrs.replace(/p:UUID="[^"]*"/, 'p:UUID="' + uuid(0x8000 + i, 'c0de-4553-aec9-835e5b724bb4') + '"');
      buildXml.push('  <item' + (attrs.startsWith(' ') ? '' : ' ') + attrs + ' />');
      instances.push({ id, inst, plate: pl.plate, assemble: assembleOf.get(id + '#' + (j.part.instance || 0)) || tr });
      return;
    }
    // Hinzugefügtes Teil: Körper und Loch-Modifikatoren als Netze, lokal um die Mitte (wie build3mfFiles)
    const tv = textVolumes(1, j);
    const paint = typeof paintAttrsFn === 'function' && j.part ? paintAttrsFn(j.part, dmap, nFil) : null;
    const vols = bodyVolumes(g, j.bodies, 1, paint).concat(tv.vols).map(v => ({ ...v, id: nextId++ })), mods = tv.negs.concat(holeMods(1, j.holes)).map(m => ({ ...m, id: nextId++ }));
    const oid = nextId++, center = [c[0], c[1], (g.mn[2] + g.mx[2]) / 2];
    const mesh = (pos, id, pt) => { const x = meshObjectXML(pos, center, id, pt); return hasP ? x : x.replace(/ p:UUID="[^"]*"/, ''); };
    resources.push(...vols.map(v => mesh(v.pos, v.id, v.paint)), ...mods.map(m => mesh(m.pos, m.id)),
      '  <object id="' + oid + '"' + uuidAttr(oid, '61cb-4c03-9d28-80fed5dfa1dc') + ' type="model">\n   <components>\n' +
      vols.concat(mods).map(v => '    <component objectid="' + v.id + '"' + uuidAttr(v.id, 'b206-40ff-9872-83e8017abed1') + ' transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n').join('') + '   </components>\n  </object>\n');
    const tr = placeTransform(pl, coord(g.z / 2));
    buildXml.push('  <item objectid="' + oid + '"' + uuidAttr(oid, 'b1ec-4553-aec9-835e5b724bb4') + ' transform="' + tr + '" printable="1" />');
    const own = j.r ? objectOverrides(settings, j.r, j.part) : [];
    if (own.length) objectChanges.push({ name: g.name, changes: own });
    extraObjs.push({ id: oid, name: xmlEsc(g.name), extruder: Math.min(partSlot(j), nFil - 1) + 1, overrides: own, mods,
      vols: vols.map(v => ({ ...v, slot: v.slot == null ? null : Math.min(v.slot, nFil - 1) })) });
    instances.push({ id: String(oid), inst: 0, plate: pl.plate, assemble: tr });
  });
  if (resources.length) model = model.replace(/(\n?[ \t]*<\/(?:\w+:)?resources>)/, '\n' + resources.join('').replace(/\n$/, '') + '$1');
  model = model.replace(/(<(?:\w+:)?build\b[^>]*?)(?:\/>|>[\s\S]*?<\/((?:\w+:)?build)>)/, (all, open, close) => (open.endsWith(' ') ? open.slice(0, -1) : open) + '>\n' + buildXml.join('\n') + '\n </' + (close || 'build') + '>');

  // Platten: Kopf der gleichnamigen Platte des Designers (ohne Vorschaubilder, die nicht mehr passen), Instanzen neu
  const origPlates = [...ms.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map(m => m[1]);
  const plateXml = k => {
    const src = origPlates.find(b => new RegExp('key="plater_id" value="' + k + '"').test(b));
    const head = src ? src.replace(/\s*<model_instance>[\s\S]*?<\/model_instance>/g, '').replace(PLATE_FILE_KEYS, '').replace(/\s+$/, '')
      : '\n    <metadata key="plater_id" value="' + k + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>';
    return '  <plate>' + head + '\n' + instances.map((x, n) => [x, n]).filter(([x]) => x.plate === k - 1).map(([x, n]) => '    <model_instance>\n      <metadata key="object_id" value="' + x.id + '"/>\n      <metadata key="instance_id" value="' + x.inst + '"/>\n      <metadata key="identify_id" value="' + (2000 + n) + '"/>\n    </model_instance>\n').join('') + '  </plate>\n';
  };
  ms = ms.replace(/[ \t]*<plate>[\s\S]*?<\/plate>\n?/g, '').replace(/[ \t]*<assemble>[\s\S]*?<\/assemble>\n?/g, '');
  const tail = extraObjs.map(objectConfigXML).join('') + Array.from({ length: lay.count }, (_, k) => plateXml(k + 1)).join('') +
    '  <assemble>\n' + instances.map(x => '   <assemble_item object_id="' + x.id + '" instance_id="' + x.inst + '" transform="' + x.assemble + '" offset="0 0 0" />\n').join('') + '  </assemble>\n';
  ms = /<\/config>/.test(ms) ? ms.replace(/<\/config>\s*$/, tail + '</config>\n') : ms + tail;
  return { model, ms, objectChanges };
}
const attrsOfTag = tag => { const o = {}; tag.replace(/([\w:]+)="([^"]*)"/g, (_, k, v) => { o[k] = v; }); return o; };

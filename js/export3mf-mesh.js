'use strict';
/* 3MF-Export, Teil XML und Netze (aus js/export3mf.js): XML-Helfer, Netze als 3MF-Objekte, Körper, Loch-Modifikatoren,
   Beschriftung, Bauraum, Kopf und Einträge von model_settings.config, Slot-Plan, eigene Bemalung (writeUserPaint). */

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const uuid = (n, tail) => ('0000' + n.toString(16)).slice(-4) + '0000-' + tail;
const coord = v => String(Math.round(v * 1e5) / 1e5);

// Netz als 3MF-Objekt: gemeinsame Eckpunkte, lokal um den Mittelpunkt zentriert (wie Orca es speichert).
// Ein Netz als <object>; center = Mittelpunkt des Teils, damit Modifikatoren relativ dazu passen
// paint: Dreieck → Attribute der Bemalung (' paint_color="…" …', '' = keine) oder null (js/paint.js paintAttrsFn)
function meshObjectXML(pos, center, id, paint) {
  const [cx, cy, cz] = center, n = pos.length / 9;
  const index = new Map(), verts = [], tris = [];
  for (let i = 0; i < n; i++) {
    const t = [];
    for (let v = 0; v < 3; v++) {
      const o = i * 9 + v * 3;
      const x = coord(pos[o] - cx), y = coord(pos[o + 1] - cy), z = coord(pos[o + 2] - cz);
      const key = x + ' ' + y + ' ' + z;
      let vid = index.get(key);
      if (vid === undefined) { vid = verts.length; index.set(key, vid); verts.push('     <vertex x="' + x + '" y="' + y + '" z="' + z + '"/>'); }
      t.push(vid);
    }
    const pc = paint ? paint(i) : '';
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push('     <triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"' + pc + '/>');
  }
  return '  <object id="' + id + '" p:UUID="' + uuid(id, '81cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <mesh>\n    <vertices>\n' +
    verts.join('\n') + '\n    </vertices>\n    <triangles>\n' + tris.join('\n') + '\n    </triangles>\n   </mesh>\n  </object>\n';
}

/* Körper eines Teils (Mehrfarbdruck): bodies = [{name, start, count, slot}] – Dreiecksbereiche in geom.pos.
   Jeder Körper wird ein eigenes Orca-Bauteil; slot null = Slot des Teils. Der erste Körper behält die
   Id des Teils, weitere liegen weit über denen der Teile und Modifikatoren. */
const BODY_ID_BASE = 1000000;
// paint: Bemalung des Teils (Dreieck im ganzen Teil → Attribute, js/paint.js paintAttrsFn) oder null
function bodyVolumes(geom, bodies, k, paint) {
  if (!bodies || bodies.length < 2) return [{ id: k, name: geom.name, pos: geom.pos, slot: null, paint: paint || null }];
  return bodies.map((b, j) => ({ id: j ? BODY_ID_BASE + k * 1000 + j : k, name: b.name, pos: geom.pos.subarray(b.start * 9, (b.start + b.count) * 9), slot: b.slot ?? null,
    paint: paint ? i => paint(b.start + i) : null }));
}

// Netz-Datei eines Teils: seine Körper (vols: [{id, pos}]) und Modifikatoren (mods: [{id, pos}])
function meshModelXML(geom, vols, mods = []) {
  const center = [(geom.mn[0] + geom.mx[0]) / 2, (geom.mn[1] + geom.mx[1]) / 2, (geom.mn[2] + geom.mx[2]) / 2];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n' +
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n' + vols.map(v => meshObjectXML(v.pos, center, v.id, v.paint)).join('') +
    mods.map(m => meshObjectXML(m.pos, center, m.id)).join('') + ' </resources>\n <build/>\n</model>\n';
}

/* Bohrloch-Verstärkung: je gewähltem Loch ein Orca-Modifikator (Zylinder) mit 100 % Füllung.
   Ids liegen weit über denen der Teile, damit sie in keiner Datei kollidieren. */
const HOLE_MOD_ID_BASE = 10000;
const HOLE_MOD_SETTINGS = [['sparse_infill_density', '100%']];

/* Beschriftung (js/engrave.js): texts eines Teils (item.texts oder item.part.texts, Anker in origPos-Koordinaten,
   Drehung item.part.R). Erhaben = weiteres Bauteil (normal_part) mit eigenem Slot, vertieft = negative_part
   (Orca zieht es beim Slicen ab; Subtyp per Orca-CLI geprüft 2026-09-29). Ergebnis {vols, negs} wie bodyVolumes/holeMods. */
const TEXT_ID_BASE = 2000000;
const itemTexts = p => (p.texts || (p.part && p.part.texts) || []).filter(x => x && String(x.text || '').trim());
function textVolumes(k, p) {
  const R = (p.part && p.part.R) || null, vols = [], negs = [];
  itemTexts(p).forEach((x, j) => {
    const e = { id: TEXT_ID_BASE + k * 1000 + j + 1, pos: textMesh(typeof textScaled === 'function' ? textScaled(x, p.part) : x, R), name: (x.mode === 'engraved' ? 'Gravur' : 'Schrift') + ' „' + String(x.text).slice(0, 40) + '“' };
    if (x.mode === 'engraved') negs.push({ ...e, subtype: 'negative_part', settings: [] }); else vols.push({ ...e, slot: x.slot ?? null });
  });
  return { vols, negs };
}
// Slots erhabener Beschriftungen eines Teils
const textSlots = p => itemTexts(p).filter(x => x.mode !== 'engraved' && x.slot != null).map(x => x.slot);
// weitere Slots eines Teils neben Teil und Körpern: erhabene Beschriftung und eigene Bemalung (js/paint.js)
const paintSlotsOf = p => typeof paintUserSlots === 'function' ? paintUserSlots(p.part || p) : [];
const extraSlots = p => textSlots(p).concat(paintSlotsOf(p));
function holeMods(k, holes) {
  return (holes || []).map((h, j) => ({ id: HOLE_MOD_ID_BASE + k * 1000 + j + 1, pos: holeModifierMesh(h), name: 'Verstärkung Loch ' + h.id + ' (Ø ' + de(2 * h.r, 1) + ' mm)' }));
}

function bedSize(tpl) {
  const pts = (tpl.settings.printable_area || []).map(p => p.split('x').map(Number));
  if (!pts.length) return [tpl.bedCenter[0] * 2, tpl.bedCenter[1] * 2];
  return [0, 1].map(k => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k])));
}

// Bauraum [Breite, Tiefe, Höhe] in mm (Höhe aus printable_height, sonst unbegrenzt)
function buildVolume(tpl) {
  const h = +[].concat(tpl.settings.printable_height || [])[0];
  return [...bedSize(tpl), h > 0 ? h : Infinity];
}
// Passt ein Teil (so wie es liegt) in den Bauraum? Liste der Überschreitungen, z. B. ['Höhe 262 > 250 mm']
function volumeExcess(g, vol) {
  const out = [];
  [[t('Breite'), g.x, vol[0]], [t('Tiefe'), g.y, vol[1]], [t('Höhe'), g.z, vol[2]]].forEach(([n, v, max]) => { if (v > max + 0.01) out.push(t('{dim} {size} > {max} mm', { dim: n, size: de(v, 0), max: de(max, 0) })); });
  return out;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
/* Dateiversion im Bambu-Format, wie sie die Orca-Vorlagen tragen. Neuere Angaben (z. B. Bambu Studio 2.7.1 bei
   Makerworld-Projekten) lehnt die Orca-Kommandozeile ab: „File Version 2.7.1.62 not supported by current cli
   version 2.4.2“ (beobachtet 2026-09-28) – die Orca-Oberfläche öffnet sie trotzdem. */
const BBL_FILE_VERSION = '02.06.00.51';
const MODEL_OPEN = '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n';
const REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

// Objekt-Eintrag in model_settings.config: Name, Slot, eigene Werte, Bauteile (Körper) und Modifikatoren (name bereits XML-escaped)
function objectConfigXML(o) {
  return '  <object id="' + o.id + '">\n    <metadata key="name" value="' + o.name + '"/>\n    <metadata key="extruder" value="' + o.extruder + '"/>\n' +
    o.overrides.map(c => '    <metadata key="' + c.key + '" value="' + xmlEsc(c.value) + '"/>\n').join('') +
    o.vols.map((v, j) => '    <part id="' + v.id + '" subtype="normal_part">\n      <metadata key="name" value="' + xmlEsc(v.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      (v.slot !== null ? '      <metadata key="extruder" value="' + (v.slot + 1) + '"/>\n' : '') + '      <metadata key="source_file" value="' + o.name + '"/>\n' +
      '      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="' + j + '"/>\n      <metadata key="source_offset_x" value="0"/>\n      <metadata key="source_offset_y" value="0"/>\n      <metadata key="source_offset_z" value="0"/>\n    </part>\n').join('') +
    (o.mods || []).map(m => '    <part id="' + m.id + '" subtype="' + (m.subtype || 'modifier_part') + '">\n      <metadata key="name" value="' + xmlEsc(m.name) + '"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n' +
      (m.settings || HOLE_MOD_SETTINGS).map(([k, v]) => '      <metadata key="' + k + '" value="' + v + '"/>\n').join('') + '    </part>\n').join('') + '  </object>\n';
}
function modelSettingsXML(objs, plateCount) {
  const object = objectConfigXML;
  const instance = o => '    <model_instance>\n      <metadata key="object_id" value="' + o.id + '"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="' + o.k + '"/>\n    </model_instance>\n';
  const plate = pi => '  <plate>\n    <metadata key="plater_id" value="' + (pi + 1) + '"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n' +
    objs.filter(o => o.place.plate === pi).map(instance).join('') + '  </plate>\n';
  return XML_HEAD + '<config>\n' + objs.map(object).join('') + Array.from({ length: plateCount }, (_, pi) => plate(pi)).join('') +
    '  <assemble>\n' + objs.map(o => '   <assemble_item object_id="' + o.id + '" instance_id="0" transform="' + placeTransform(o.place, o.hz) + '" offset="0 0 0" />\n').join('') + '  </assemble>\n</config>\n';
}

// parts: ein geom (Einzelteil) oder [{geom}] – alle Teile bekommen dieselben Werte und den gewählten Slot.
/* parts: ein geom oder [{geom, r?, slot?}]. r/slot = Werte und Slot für alle Teile ohne eigene Angabe.
   Teile mit eigenem r bekommen abweichende Prozesswerte als Objekt-Einstellung, ein eigener Slot
   bekommt die Filamentwerte dieses Teils. notes: Werte, die Orca nur global kennt. */
/* Welche Slots welche Filamentwerte bekommen: der Standard-Slot die von r, jeder weitere Slot die des
   ersten Teils darin. Teile mit anderem Material im selben Slot → Hinweis (Orca kennt ein Filament je Slot). */
function slotPlan(items, r, slot) {
  const partSlot = p => (p.slot === null || p.slot === undefined ? slot : p.slot);
  const extra = [], notes = [];
  // Körper mit eigenem Slot belegen diesen Slot mit dem Filament ihres Teils
  const users = items.flatMap(p => [p, ...(p.bodies || []).filter(b => b.slot !== null && b.slot !== undefined)
    .map(b => ({ geom: { name: p.geom.name + ' · ' + b.name }, r: p.r, slot: b.slot })),
    ...textSlots(p).map(s => ({ geom: { name: p.geom.name + ' · ' + t('Beschriftung') }, r: p.r, slot: s })),
    ...paintSlotsOf(p).map(s => ({ geom: { name: p.geom.name + ' · ' + t('Bemalung') }, r: p.r, slot: s }))]);
  for (const p of users) {
    const ps = partSlot(p), pr = p.r || r;
    if (ps === slot) { if (pr.m.kind !== r.m.kind) notes.push(t('{part}: {material} im selben Slot wie {main} – es gelten die Filamentwerte von {main}.', { part: p.geom.name, material: pr.m.name, main: r.m.name })); continue; }
    const other = extra.find(e => e.slot === ps);
    if (!other) extra.push({ slot: ps, r: pr });
    else if (other.r.m.kind !== pr.m.kind) notes.push(t('{part}: Slot {n} ist schon mit {material} belegt – es gelten dessen Filamentwerte.', { part: p.geom.name, n: ps + 1, material: other.r.m.name }));
  }
  for (const p of items) if (p.r && Math.abs(p.r.layer - r.layer) > 1e-9) notes.push(t('{part}: Schichthöhe {layer} mm empfohlen – Orca nutzt für alle Teile {used} mm.', { part: p.geom.name, layer: de(p.r.layer, 2), used: de(r.layer, 2) }));
  return { extra, notes, partSlot };
}

/* Eigene Bemalung auf Objekten des Designers: part.paintSrc sagt, aus welcher Datei und welchem Netz die Dreiecke des Teils
   stammen (js/import.js). Die Dreiecke dort bekommen je Ebene (Farbe, Stützen, Naht) den eigenen Code (Farbe: Filament =
   Slot + 1, höchstens nFil) bzw. verlieren die Bemalung („0“ = ausradiert). Mehrere Platzierungen desselben Objekts teilen
   die Bemalung (wie in OrcaSlicer). */
function writeUserPaint(out, items, zipLib, nFil) {
  if (typeof paintRemap !== 'function') return;
  const byFile = new Map(), done = new Set(), fil = s => Math.min(s - 1, nFil - 1) + 1;
  for (const j of items) {
    const p = j.part;
    if (!p || p.extra || p.objectId == null || !p.paintSrc || done.has(String(p.objectId))) continue;
    const layers = Object.keys(PAINT_LAYERS).map(l => ({ attr: PAINT_LAYERS[l].attr, codes: paintUserCodes(p, l), map: l === 'color' ? fil : null })).filter(x => x.codes && Object.keys(x.codes).length);
    if (!layers.length) continue;
    done.add(String(p.objectId));
    for (const s of p.paintSrc) {
      const f = byFile.get(s.path) || byFile.set(s.path, new Map()).get(s.path);
      if (!f.has(String(s.id))) f.set(String(s.id), { start: s.start, layers, drop: s.drop ? new Set(s.drop) : null });
    }
  }
  for (const [path, objs] of byFile) {
    const name = Object.keys(out).find(k => k.toLowerCase() === path.replace(/^\//, '').toLowerCase());
    if (!name) continue;
    const txt = zipLib.strFromU8(out[name]);
    out[name] = zipLib.strToU8(txt.replace(/<((?:\w+:)?object)\b([^>]*)>([\s\S]*?)<\/\1>/g, (all, tag, attrs, body) => {
      const e = objs.get((/\bid="([^"]+)"/.exec(attrs) || [])[1]);
      if (!e) return all;
      // beim Import weggelassene (ungültige) Dreiecke zählen nicht mit (js/import.js parseModelXML: drop)
      let i = 0, k = -1;
      return '<' + tag + attrs + '>' + body.replace(/<((?:\w+:)?triangle)\b([^>]*?)\s*(\/?)>/g, (tri, ttag, tattrs, close) => {
        if (e.drop && e.drop.has(++k)) return tri;
        const g = e.start + i++;
        let a = tattrs, changed = false;
        for (const L of e.layers) {
          const code = L.codes[g];
          if (code == null) continue;
          changed = true;
          a = a.replace(new RegExp('\\s*' + L.attr + '="[^"]*"'), '');
          if (code && code !== '0') a += ' ' + L.attr + '="' + (L.map ? paintRemap(code, L.map) : code) + '"';
        }
        return changed ? '<' + ttag + a + (close ? '/' : '') + '>' : tri;
      }) + '</' + tag + '>';
    }));
  }
}

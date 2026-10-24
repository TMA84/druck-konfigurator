'use strict';
/* 3MF-Export für OrcaSlicer. Basis ist die vom Nutzer in Orca gespeicherte Vorlage
   (ORCA_TEMPLATES, erzeugt aus templates/*.3mf). Überschrieben werden nur Werte, die der
   Konfigurator berechnet – alles andere (Druckerprofil, Start-G-Code, Grenzen) bleibt aus der
   Vorlage. Kein DOM-Zugriff: tests/verify-3mf.js prüft das Ergebnis mit der Orca-CLI.
   Aufgeteilt (Ladereihenfolge in index.html und in den Tests): js/export3mf-settings.js (Einstellungen),
   js/export3mf-mesh.js (XML, Netze, Bemalung), js/export3mf-pack.js (Anordnen, Turm), js/export3mf-relayout.js
   (Makerworld-/Orca-3MF); hier das Zusammensetzen der 3MF (build3mfFiles, build3mfFromProject, build3mf). */

function build3mfFiles(tpl, r, parts, slot, liveSlots, machine) {
  const items = (Array.isArray(parts) ? parts : [parts]).map(p => p.geom ? p : { geom: p }).map(p => p.pad != null ? p : { ...p, pad: brimPad(p.r || r) });
  const list = items.map(p => p.geom);
  const { extra, notes, partSlot } = slotPlan(items, r, slot);
  const { settings, changes } = buildProjectSettings(tpl, r, slot, liveSlots, extra, machine);
  // Plattenzuordnung je Teil beachten (plate 1-basiert); ohne Angabe alles automatisch
  const { places, plateCount, overflow } = items.some(p => p.plate) ? arrangeByPlate(items, tpl) : arrangeParts(list, tpl, null, items.map(p => p.pad));
  if (overflow) notes.push(t('Nicht alle Teile einer Platte passen aufs Bett – sie stehen auf einer zusätzlichen Platte.'));
  {
    // Reinigungsturm je Platte: Teile in Bettkoordinaten der Platte (arrangeParts versetzt Platten wie Orca)
    const [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(plateCount));
    const origin = pi => [(pi % cols) * bw * PLATE_STRIDE, -Math.floor(pi / cols) * bd * PLATE_STRIDE];
    const plates = Array.from({ length: plateCount }, () => ({ rects: [], slots: new Set(), idx: [] }));
    items.forEach((p, i) => {
      const pl = places[i], [ox, oy] = origin(pl.plate), q = plates[pl.plate], [fw, fd] = footprint(p.geom, pl);
      q.rects.push([pl.x - ox - fw / 2, pl.y - oy - fd / 2, pl.x - ox + fw / 2, pl.y - oy + fd / 2]);
      q.slots.add(partSlot(p)); (p.bodies || []).forEach(b => { if (b.slot != null) q.slots.add(b.slot); }); extraSlots(p).forEach(s => q.slots.add(s));
      q.idx.push(i);
    });
    const tp = planTowers(settings, tpl, plates);
    plates.forEach((q, pi) => { const [dx, dy] = tp.shifts[pi]; if (dx || dy) q.idx.forEach(i => { places[i] = { ...places[i], x: places[i].x + dx, y: places[i].y + dy }; }); });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  }
  const n = list.length, title = xmlEsc(n === 1 ? list[0].name : n + ' Teile');
  // Netz k (1..n) liegt in object_k.model mit id k; das Objekt im Hauptmodell hat id n+k.
  const nFil = settings.filament_settings_id.length;
  const objs = items.map((p, i) => { const tv = textVolumes(i + 1, p), paint = typeof paintAttrsFn === 'function' && p.part ? paintAttrsFn(p.part, {}, nFil) : null; return { g: p.geom, k: i + 1, id: n + i + 1, name: xmlEsc(p.geom.name), hz: coord(p.geom.z / 2), place: places[i],
    extruder: partSlot(p) + 1, overrides: p.r ? objectOverrides(settings, p.r, p.part) : [], mods: tv.negs.concat(holeMods(i + 1, p.holes)), vols: bodyVolumes(p.geom, p.bodies, i + 1, paint).concat(tv.vols) }; });
  // Brim „auto“: Teile mit Löchern/Schriften in der ersten Schicht bekommen statt des Rundum-Brims eine Ohrenkette am
  // Außenrand (js/brim-ears.js) – sonst zieht Orca den Brim um Inseln in den Öffnungen und schließt sie
  const ears = [];
  objs.forEach((o, i) => {
    const pr = items[i].r || r, [bt, bw] = orcaBrim(pr.brim), inner = Number(pr.brimInner) || 0;
    if (inner && pr.brimInnerKind === 'orca') return;   // Orcas eigener innerer Brim, keine gesetzten Ohren
    if ((bt === 'no_brim' && !inner) || (pr.brimKind && pr.brimKind !== 'auto') || typeof brimEarPoints !== 'function') return;
    const g = o.g, center = [(g.mn[0] + g.mx[0]) / 2, (g.mn[1] + g.mx[1]) / 2, (g.mn[2] + g.mx[2]) / 2];
    const pts = brimEarPoints(o.vols, o.mods.filter(m => m.subtype === 'negative_part'), center, g.mn[2], bt === 'no_brim' ? 0 : Number(bw), inner, pr.brimInnerKind || 'large');
    if (!pts) return;
    ears.push({ id: i + 1, pts, r: Number(bw) || inner });
    const own = [{ label: inner ? t('Brim: außen und in großen Löchern') : t('Brim: außen, Löcher und Schriften frei'), key: 'brim_type', value: 'painted', perSlot: false },
      // sonst rückt Orca 2.4 jedes gesetzte Ohr auf den nächsten Eckpunkt des Umrisses (geprüft 2026-10-06: Ohren auf
      // geraden Kanten landeten an Lochecken, der Brim fehlte auf den Kanten)
      { label: t('Brim am kompensierten Umriss'), key: 'brim_use_efc_outline', value: '0', perSlot: false }];
    // nur innen: Orca begrenzt den inneren Brim auf brim_width – dann die Innenbreite
    if (bt === 'no_brim') own.push({ label: t('Brim-Breite'), key: 'brim_width', value: numStr(inner), perSlot: false });
    o.overrides = o.overrides.filter(c => !own.some(x => x.key === c.key)).concat(own);
  });
  const objectChanges = objs.filter(o => o.overrides.length).map(o => ({ name: o.g.name, changes: o.overrides }));
  const files = {
    '[Content_Types].xml': XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
    '_rels/.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="' + REL_TYPE + '"/>\n</Relationships>\n',
    '3D/_rels/3dmodel.model.rels': XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      objs.map(o => ' <Relationship Target="' + objectPath(o.k) + '" Id="rel-' + o.k + '" Type="' + REL_TYPE + '"/>\n').join('') + '</Relationships>\n',
    '3D/3dmodel.model': XML_HEAD + MODEL_OPEN +
      ' <metadata name="Application">BambuStudio-' + BBL_FILE_VERSION + '</metadata>\n <metadata name="OrcaSlicer">' + xmlEsc(tpl.orcaVersion) + '</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="Title">' + title + '</metadata>\n <resources>\n' +
      objs.map(o => '  <object id="' + o.id + '" p:UUID="' + uuid(o.k, '61cb-4c03-9d28-80fed5dfa1dc') + '" type="model">\n   <components>\n' +
        o.vols.map(v => '    <component p:path="' + objectPath(o.k) + '" objectid="' + v.id + '" p:UUID="' + uuid(v.id, 'b206-40ff-9872-83e8017abed1') + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n').join('') +
        o.mods.map(m => '    <component p:path="' + objectPath(o.k) + '" objectid="' + m.id + '" p:UUID="' + uuid(m.id, 'b206-40ff-9872-83e8017abed1') + '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n').join('') +
        '   </components>\n  </object>\n').join('') +
      ' </resources>\n <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">\n' +
      objs.map(o => '  <item objectid="' + o.id + '" p:UUID="' + uuid(o.id, 'b1ec-4553-aec9-835e5b724bb4') + '" transform="' + placeTransform(o.place, o.hz) + '" printable="1"/>\n').join('') +
      ' </build>\n</model>\n',
    'Metadata/model_settings.config': modelSettingsXML(objs, plateCount),
    'Metadata/project_settings.config': JSON.stringify(settings, null, 4),
    'Metadata/slice_info.config': XML_HEAD + '<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="' + BBL_FILE_VERSION + '"/>\n    <header_item key="OrcaSlicer-Version" value="' + xmlEsc(tpl.orcaVersion) + '"/>\n  </header>\n</config>\n',
    'Metadata/filament_sequence.json': JSON.stringify(Object.fromEntries(Array.from({ length: plateCount }, (_, pi) => ['plate_' + (pi + 1), { nozzle_sequence: [], optimal_assignment: [], sequence: [] }])))
  };
  objs.forEach(o => { files[objectPath(o.k).slice(1)] = meshModelXML(o.g, o.vols, o.mods); });
  if (ears.length) files['Metadata/brim_ear_points.txt'] = brimEarFile(ears);
  return { files, changes, plateCount, objectChanges, notes };
}

/* jobs: [{geom, r, slot, bodies?, part:{objectId, plate}}] wie aus partJobs(); threemf = Import-Ergebnis mit zip.
   Ist die 3MF neu angeordnet oder kommen eigene Teile/Kopien dazu (needsRelayout), schreibt relayout3mf Build-Items,
   Platten und die neuen Objekte; sonst bleiben Lage und Platten des Designers (je Platte auf die Bettmitte gerückt). */
function build3mfFromProject(tpl, r, jobs, slot, zipLib, liveSlots, threemf, machine) {
  const items = jobs.map(j => ({ ...j, plate: j.part && j.part.plate }));
  const { extra, notes, partSlot } = slotPlan(items, r, slot);
  const nFil = tpl.settings.filament_settings_id.length;
  // Slots, die nur Farb-Modifikatoren des Designers nutzen (z. B. ein Schriftzug), bekommen die Filamentwerte ihres Teils –
  // sonst blieben dort die Vorlagenwerte, und Orca lehnt die Mischung ab („nozzle temperatures are incompatible“)
  const dmap = threemf.designMap || {};
  // dasselbe für die Bemalung je Dreieck (js/paint.js: Filamente des Designers, umgelegt über designMap)
  items.forEach(j => [...((j.part && j.part.modSlots) || []), ...((j.part && j.part.paintSlots) || [])].forEach(d => { const s = dmap[d] ?? d;
    if (s !== slot && s < nFil && !extra.some(e => e.slot === s)) extra.push({ slot: s, r: j.r || r }); }));
  items.forEach(j => { if (partSlot(j) >= nFil) notes.push(t('{part}: Slot {n} gibt es an deinem Drucker nicht – bitte in Orca zuweisen.', { part: j.geom.name, n: partSlot(j) + 1 })); });
  items.forEach(j => (j.bodies || []).forEach(b => { if (b.slot != null && b.slot >= nFil) notes.push(t('{part} · {body}: Slot {n} gibt es an deinem Drucker nicht – Slot {last} wird verwendet.', { part: j.geom.name, body: b.name, n: b.slot + 1, last: nFil })); }));
  const { settings, changes } = buildProjectSettings(tpl, r, slot, liveSlots, extra.filter(e => e.slot < nFil), machine);
  const relayout = needsRelayout(threemf, items.map(j => j.part));
  let shifts = new Map(), lay = null;
  if (relayout) {
    lay = layout3mf(items.map(j => ({ geom: j.geom, plate: j.plate, own: ownPlaced(j.part), pad: brimPad(j.r) })), tpl, threemf.layout || null);
    lay.oversizePlates.forEach(id => notes.push(t('Platte {n} ist größer als dein Druckbett – in Orca prüfen.', { n: id })));
    if (lay.oversize.length) notes.push(t('Passt nicht aufs Bett: {parts} – in Orca prüfen.', { parts: lay.oversize.map(i => items[i].geom.name).join(', ') }));
    if (lay.overflow) notes.push(t('Nicht alle Teile einer Platte passen aufs Bett – sie stehen auf einer zusätzlichen Platte.'));
    // Reinigungsturm je Platte: Hüllrechtecke in Bettkoordinaten der Platte
    const [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(lay.count));
    const origin = pi => [(pi % cols) * bw * PLATE_STRIDE, -Math.floor(pi / cols) * bd * PLATE_STRIDE];
    const plates = Array.from({ length: lay.count }, () => ({ rects: [], slots: new Set(), idx: [] }));
    items.forEach((j, i) => {
      const pl = lay.places[i], [ox, oy] = origin(pl.plate), q = plates[pl.plate], [fw, fd] = footprint(j.geom, pl);
      q.rects.push([pl.x - ox - fw / 2, pl.y - oy - fd / 2, pl.x - ox + fw / 2, pl.y - oy + fd / 2]);
      q.slots.add(Math.min(partSlot(j), nFil - 1)); (j.bodies || []).forEach(b => { if (b.slot != null) q.slots.add(Math.min(b.slot, nFil - 1)); }); extraSlots(j).forEach(s => q.slots.add(Math.min(s, nFil - 1)));
      if (j.part && (j.part.painted || (j.part.modSlots || []).length)) q.slots.add('bemalt');
      q.idx.push(i);
    });
    const tp = planTowers(settings, tpl, plates);
    plates.forEach((q, pi) => { const [dx, dy] = tp.shifts[pi]; if (dx || dy) q.idx.forEach(i => { lay.places[i] = { ...lay.places[i], x: lay.places[i].x + dx, y: lay.places[i].y + dy }; }); });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  } else {
    const ps = plateShifts(items, tpl);
    shifts = ps.shifts;
    ps.oversize.forEach(id => notes.push(t('Platte {n} ist größer als dein Druckbett – in Orca prüfen.', { n: id })));
    // Reinigungsturm je Platte (Platten-Ids 1..n); Teile nach der Verschiebung auf die Bettmitte
    const count = Math.max(1, ...items.map(j => j.plate || 1)), [bw, bd] = bedSize(tpl), cols = Math.ceil(Math.sqrt(count));
    const plates = Array.from({ length: count }, () => ({ rects: [], slots: new Set() }));
    for (const j of items) {
      const id = j.plate || 1, [sx, sy] = shifts.get(id) || [0, 0], pi = id - 1, ox = (pi % cols) * bw * PLATE_STRIDE, oy = -Math.floor(pi / cols) * bd * PLATE_STRIDE;
      plates[pi].rects.push([j.geom.mn[0] + sx - ox, j.geom.mn[1] + sy - oy, j.geom.mx[0] + sx - ox, j.geom.mx[1] + sy - oy]);
      plates[pi].slots.add(Math.min(partSlot(j), nFil - 1)); (j.bodies || []).forEach(b => { if (b.slot != null) plates[pi].slots.add(Math.min(b.slot, nFil - 1)); }); extraSlots(j).forEach(s => plates[pi].slots.add(Math.min(s, nFil - 1)));
      if (j.part && j.part.painted) plates[pi].slots.add('bemalt'); // Farben des Designers → mehrfarbig, Turm nötig
    }
    const tp = planTowers(settings, tpl, plates);
    tp.shifts.forEach(([dx, dy], pi) => { if ((dx || dy) && shifts.has(pi + 1)) { const [sx, sy] = shifts.get(pi + 1); shifts.set(pi + 1, [sx + dx, sy + dy]); } });
    applyTowers(settings, changes, tp);
    notes.push(...tp.notes);
  }

  const out = {};
  for (const [name, data] of Object.entries(threemf.zip)) if (!PLATE_SLICE_FILES.test(name)) out[name] = data;
  out['Metadata/project_settings.config'] = zipLib.strToU8(JSON.stringify(settings, null, 4));
  // Dateiversion auf die der eigenen Vorlage setzen (sonst verweigert die Orca-Kommandozeile neuere Bambu-Dateien)
  const setVersion = (name, re, value) => { if (out[name]) out[name] = zipLib.strToU8(zipLib.strFromU8(out[name]).replace(re, value)); };
  setVersion('3D/3dmodel.model', /(<metadata name="Application">)[^<]*(<\/metadata>)/, '$1BambuStudio-' + BBL_FILE_VERSION + '$2');
  // Mit OrcaSlicer-Angabe prüft Orca gegen die eigene Version statt gegen die Bambu-Version
  const model = zipLib.strFromU8(out['3D/3dmodel.model']);
  if (!/<metadata name="OrcaSlicer">/.test(model))
    out['3D/3dmodel.model'] = zipLib.strToU8(model.replace(/(<metadata name="Application">[^<]*<\/metadata>)/, '$1\n <metadata name="OrcaSlicer">' + xmlEsc(tpl.orcaVersion) + '</metadata>'));
  else setVersion('3D/3dmodel.model', /(<metadata name="OrcaSlicer">)[^<]*(<\/metadata>)/, '$1' + xmlEsc(tpl.orcaVersion) + '$2');
  setVersion('Metadata/slice_info.config', /(header_item key="X-BBL-Client-Version" value=")[^"]*(")/, '$1' + BBL_FILE_VERSION + '$2');

  // Beschriftung auf Objekten des Designers als weitere Bauteile (vor dem Verschieben: braucht die ursprünglichen Transformationen)
  designerTexts(out, Object.keys(out).find(k => /^3D\/3dmodel\.model$/i.test(k)), items, zipLib, nFil);
  // Build-Items verschieben (Translation = letzte drei Werte der Matrix)
  const rootPath = Object.keys(out).find(k => /^3D\/3dmodel\.model$/i.test(k));
  if (!relayout) {
    // Je Build-Item die Platte seiner Instanz – dasselbe Objekt kann auf mehreren Platten stehen
    const plateOfItem = new Map(items.map(j => [j.part.objectId + '#' + (j.part.instance || 0), j.plate || 1]));
    const itemOf = new Map(items.map(j => [j.part.objectId + '#' + (j.part.instance || 0), j]));
    const itemCount = new Map();
    out[rootPath] = zipLib.strToU8(zipLib.strFromU8(out[rootPath]).replace(/<((?:\w+:)?item\b)([^>]*?)(\/?)>/g, (all, tag, attrs, close) => {
      const id = (/objectid="([^"]+)"/.exec(attrs) || [])[1], inst = itemCount.get(id) || 0;
      itemCount.set(id, inst + 1);
      const shift = shifts.get(plateOfItem.get(id + '#' + inst));
      if (!shift) return all;
      const t = (/transform="([^"]+)"/.exec(attrs) || [])[1];
      const j = itemOf.get(id + '#' + inst);
      const m0 = t ? t.trim().split(/\s+/).map(Number) : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], m = j ? partItemTransform(m0, j.part, j.geom) : m0;
      m[9] += shift[0]; m[10] += shift[1];
      const tr = 'transform="' + m.map(v => String(Math.round(v * 1e4) / 1e4)).join(' ') + '"';
      return '<' + tag + (t ? attrs.replace(/transform="[^"]+"/, tr) : attrs + ' ' + tr) + close + '>';
    }));
  }

  // Slot und eigene Werte je Objekt
  const computedKeys = [...new Set(plannedChanges(r, 0, null).filter(c => !c.perSlot && isObjectKey(c.key)).map(c => c.key).concat([...OBJECT_KEYS], supportChanges(r).map(x => x[1])))];
  const objectChanges = [];
  let ms = zipLib.strFromU8(out['Metadata/model_settings.config'] || zipLib.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n</config>\n'));
  const done = new Set(); // Objekt mit mehreren Instanzen nur einmal anpassen
  for (const j of items) {
    if (j.part.objectId == null || j.part.extra || done.has(j.part.objectId)) continue;   // hinzugefügte Teile: relayout3mf
    done.add(j.part.objectId);
    const own = objectOverrides(settings, j.r, j.part);
    if (own.length) objectChanges.push({ name: j.geom.name, changes: own });
    const esc = String(j.part.objectId).replace(/[^\w-]/g, '');
    if (!new RegExp('<object id="' + esc + '">').test(ms)) { notes.push(t('{part}: keine Objekt-Einstellungen in der 3MF – Slot und eigene Werte bitte in Orca prüfen.', { part: j.geom.name })); continue; }
    ms = ms.replace(new RegExp('(<object id="' + esc + '">)([\\s\\S]*?)(?=<part\\b|</object>)'), (all, open, body) => patchObjectHead(open + body, Math.min(partSlot(j), nFil - 1) + 1, own, computedKeys));
    for (const b of j.bodies || []) if (b.partId != null) ms = patchPartExtruder(ms, esc, b.partId, b.slot == null ? null : Math.min(b.slot, nFil - 1) + 1);
    if (threemf.designMap && Object.keys(threemf.designMap).length) ms = patchModifierExtruders(ms, esc, threemf.designMap, nFil);
  }
  if (relayout) {
    const rl = relayout3mf(zipLib.strFromU8(out[rootPath]), ms, items, lay, settings, partSlot, nFil, out, zipLib, dmap);
    out[rootPath] = zipLib.strToU8(rl.model); ms = rl.ms; objectChanges.push(...rl.objectChanges);
    if (out['Metadata/filament_sequence.json']) out['Metadata/filament_sequence.json'] = zipLib.strToU8(JSON.stringify(Object.fromEntries(Array.from({ length: lay.count }, (_, pi) => ['plate_' + (pi + 1), { nozzle_sequence: [], optimal_assignment: [], sequence: [] }]))));
  }
  out['Metadata/model_settings.config'] = zipLib.strToU8(ms);
  // Bemalung je Dreieck: Filamente des Designers auf die eigenen Slots umschreiben (designMap), sonst blieben Nummern stehen,
  // die es am Drucker nicht gibt (Mario mit 7 Farben, eine ACE mit 4 Slots)
  const pmap = threemf.designMap || {}, remap = st => Math.min((pmap[st - 1] ?? st - 1), nFil - 1) + 1;
  if (typeof paintRemap === 'function' && items.some(j => j.part && j.part.paintState && (j.part.paintSlots || []).some(d => remap(d + 1) !== d + 1)))
    for (const name of Object.keys(out)) {
      if (!/\.model$/i.test(name)) continue;
      const txt = zipLib.strFromU8(out[name]);
      if (!txt.includes('paint_color="')) continue;
      out[name] = zipLib.strToU8(txt.replace(/paint_color="([0-9A-Fa-f]+)"/g, (all, code) => { try { return 'paint_color="' + paintRemap(code, remap) + '"'; } catch (e) { return all; } }));
    }
  // eigene Bemalung (js/paint-ui.js) in die Dreiecke des Designers schreiben – nach dem Umschreiben oben, sie hat schon Slot-Nummern
  writeUserPaint(out, items, zipLib, nFil);
  return { bytes: zipLib.zipSync(out, { level: 6 }), changes, objectChanges, notes, plateCount: relayout ? lay.count : shifts.size };
}

// ZIP über fflate (vendor/fflate.min.js); zipLib wird übergeben, damit der Test es in Node nutzen kann.
function build3mf(tpl, r, parts, slot, zipLib, liveSlots, machine) {
  const { files, changes, plateCount, objectChanges, notes } = build3mfFiles(tpl, r, parts, slot, liveSlots, machine);
  const entries = {};
  for (const [p, text] of Object.entries(files)) entries[p] = zipLib.strToU8(text);
  return { bytes: zipLib.zipSync(entries, { level: 6 }), changes, plateCount, objectChanges, notes };
}

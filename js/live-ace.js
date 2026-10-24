'use strict';
/* 3D-Fortschritt, Teil Gehäuse und ACE (aus js/live-ui.js): Gehäuse, ACE-Pro-Einheiten mit Spulen, Spulenfarben aus dem
   Druckerstand, Leuchtstreifen im Schlauch, Bewegung der ACE (Abspulen, Fluss, Trocknen). */

/* Gehäuse und ACE (2026-10-08, zuschaltbar, Standard an – Schalter unten links): Gehäuse aus Seiten- und Rückwand,
   Glastür vorn und Glasdeckel oben (durchscheinend, die Mechanik bleibt sichtbar). Daneben die ACE-Pro-Einheiten
   (370 × 290 × 240 mm, klare Haube, je 4 Spulen in den Farben der Slots aus dem Druckerstand), von jedem Slot ein PTFE-Schlauch mit
   Filament zum Verteiler hinten oben am Drucker. Beides hängt am Rahmen (fährt relativ zum Teil in Z mit). */
const LV_ACE = { w: 370, d: 290, h: 240, spoolR: 98, spoolW: 64, gap: 150 }, LV_SPOOL_CORE = 30;

function lvEnclosureInit(g) {
  const { fx0, fx1, fy0, fy1, top } = lv.xy, fh = lv.frameH, bot = top - fh, cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2;
  const x0 = fx0 - 12, x1 = fx1 + 12, y0 = fy0 - 12, y1 = fy1 + 12, z0 = bot - 40, z1 = top + 40;
  const panel = new THREE.MeshStandardMaterial({ color: 0x3c4348, roughness: 0.55, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4be, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  const rim = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.5 });
  const enc = new THREE.Group(), box = (w, d, h, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m); o.position.set(x, y, z); o.renderOrder = 6; enc.add(o); return o; };
  box(4, y1 - y0, z1 - z0, x0, cy, (z0 + z1) / 2, panel); box(4, y1 - y0, z1 - z0, x1, cy, (z0 + z1) / 2, panel);   // Seitenwände
  box(x1 - x0, 4, z1 - z0, cx, y1, (z0 + z1) / 2, panel);                                                              // Rückwand
  box(x1 - x0, y1 - y0, 30, cx, cy, z0 + 15, rim);                                                                     // Sockel
  box(x1 - x0 - 30, 3, z1 - z0 - 60, cx, y0, (z0 + z1) / 2 + 15, glass);                                               // Glastür
  for (const [w, h, x, z] of [[x1 - x0, 15, cx, z1 - 7], [15, z1 - z0 - 30, x0 + 7, (z0 + z1) / 2 + 15], [15, z1 - z0 - 30, x1 - 7, (z0 + z1) / 2 + 15]]) box(w, 6, h, x, y0, z, rim);   // Türrahmen
  box(x1 - x0, y1 - y0, 3, cx, cy, z1, glass);                                                                         // Glasdeckel
  box(x1 - x0, 12, 6, cx, y0 + 6, z1, rim); box(x1 - x0, 12, 6, cx, y1 - 6, z1, rim);
  enc.visible = store.settings.liveEnclosure !== false; lv.gantry.add(enc); lv.enclosureG = enc;
  // Gehäuselicht (lights vom Drucker): warmes Licht oben im Bauraum und eine Leuchtleiste vorn unter dem Deckel (lvFx)
  { const light = new THREE.PointLight(0xffe7c2, 0, Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 0.75, 1); light.position.set(cx, cy, z1 - 40);   // reicht nur über den Bauraum
    const strip = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 60, 6, 3), new THREE.MeshBasicMaterial({ color: 0x3a3f43 })); strip.position.set(cx, y0 + 24, z1 - 6);
    lv.gantry.add(light, strip); lv.encLight = { light, strip }; }
  // Statusrahmen um das Gehäuse: gelb bei Pause, rot bei Fehler/Abbruch, grün bei Druckende (lvFx), sonst unsichtbar
  { const ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0 + 8, y1 - y0 + 8, z1 - z0 + 8)), new THREE.LineBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0, depthWrite: false }));
    ol.position.set(cx, cy, (z0 + z1) / 2); ol.visible = false; ol.renderOrder = 10; lv.gantry.add(ol); lv.statusLine = ol; }
  // Display oben rechts vorn auf einem Fuß (wie am S1), leicht nach hinten geneigt; zeigt Fortschritt, Schicht, Restzeit (lvDisplay)
  { const dg = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.4, metalness: 0.3 });
    const foot = new THREE.Mesh(new THREE.BoxGeometry(70, 26, 16), new THREE.MeshStandardMaterial({ color: 0xb9c0c4, roughness: 0.35, metalness: 0.6 })); foot.position.z = 8; dg.add(foot);
    const scr = new THREE.Group(); scr.position.set(0, 4, 16 + 44); scr.rotation.x = -0.28; dg.add(scr);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(136, 8, 88), dark); scr.add(bez);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(128, 80), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    face.rotation.x = Math.PI / 2; face.position.y = -4.2; scr.add(face);
    dg.position.set(x1 - 78, y0 + 50, z1 + 2); lv.gantry.add(dg);
    lv.display = { g: dg, cv, tex: face.material.map, key: null }; lvDisplay(typeof wb !== 'undefined' && wb.st); }
  // ACE-Einheiten oben auf dem Deckel, Spulen in Slotfarbe, Schläuche zum Verteiler hinten oben
  /* neben dem Drucker (rechts, LV_ACE.gap Abstand), auf derselben Standfläche, übereinander; klare, gerundete Haube */
  const ace = new THREE.Group(), A = LV_ACE, hub = new THREE.Vector3(cx + 100, y1 + 14, z0 + (z1 - z0) * 0.75), ax = x1 + A.gap + A.w / 2;
  const body = new THREE.MeshStandardMaterial({ color: 0x2d3236, roughness: 0.5 });
  const lid = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
  const spokeM = new THREE.MeshStandardMaterial({ color: 0xb8c0c5, roughness: 0.4 });
  const hood = (() => {   // Profil (y, z): Rechteck mit großen Radien oben, entlang x extrudiert
    const sh = new THREE.Shape(), d = A.d / 2, h = A.h - 90, r = 55;
    sh.moveTo(-d, 0); sh.lineTo(d, 0); sh.lineTo(d, h - r); sh.quadraticCurveTo(d, h, d - r, h); sh.lineTo(-d + r, h); sh.quadraticCurveTo(-d, h, -d, h - r); sh.lineTo(-d, 0);
    const g2 = new THREE.ExtrudeGeometry(sh, { depth: A.w, bevelEnabled: false, curveSegments: 12 });
    // Profil-x → Welt-y, Profil-y → Welt-z, Extrusion → Welt-x; dann mittig auf die Einheit, Unterkante z = 0
    g2.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    g2.computeBoundingBox(); const bb = g2.boundingBox; g2.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
    // Bodenfläche der Haube weglassen: sie läge genau auf dem Unterteil und flimmerte (Z-Fighting)
    const ps = g2.getAttribute('position'), nm = g2.getAttribute('normal'), keep = [], keepN = [];
    for (let t = 0; t < ps.count; t += 3) {
      if (ps.getZ(t) < 0.01 && ps.getZ(t + 1) < 0.01 && ps.getZ(t + 2) < 0.01) continue;
      for (let v = t; v < t + 3; v++) { keep.push(ps.getX(v), ps.getY(v), ps.getZ(v)); keepN.push(nm.getX(v), nm.getY(v), nm.getZ(v)); }
    }
    const g3 = new THREE.BufferGeometry(); g3.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); g3.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    g2.dispose(); return g3; })();
  lv.aceSpools = []; lv.aceUnitsFx = [];
  for (let u = 0; u < 2; u++) {
    const uz = z0 + u * (A.h + 6), unit = new THREE.Group(); unit.position.set(ax, cy, uz); ace.add(unit);
    // Unterteil als Wanne: Boden, Front, Rückteil mit den Einzügen, Seiten – die Spulen liegen darin, der Einzug unten bleibt sichtbar
    for (const [w, d, h, x, y, z] of [[A.w, A.d, 18, 0, 0, 9], [A.w, A.d / 2 - 100, 90, 0, -(A.d / 2 + 100) / 2, 45], [A.w, A.d / 2 - 100, 90, 0, (A.d / 2 + 100) / 2, 45],
      [12, 200, 90, -A.w / 2 + 6, 0, 45], [12, 200, 90, A.w / 2 - 6, 0, 45]]) { const b1 = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), body); b1.position.set(x, y, z); unit.add(b1); }
    const uLid = lid.clone(); uLid.emissive = new THREE.Color(0xff7a1a); uLid.emissiveIntensity = 0;   // je Einheit: glüht beim Trocknen
    const b2 = new THREE.Mesh(hood, uLid); b2.position.z = 90.5; b2.renderOrder = 7; unit.add(b2);   // klare Haube
    // Schild „Trocknet 55 °C“ links vorn über der Front (nur beim Trocknen)
    const dcv = document.createElement('canvas'); dcv.width = 256; dcv.height = 48;
    const dl = new THREE.Mesh(new THREE.PlaneGeometry(130, 24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(dcv), transparent: true }));
    dl.rotation.x = Math.PI / 2; dl.position.set(0, -A.d / 2 - 2.5, 104); dl.visible = false; unit.add(dl);
    (lv.aceUnitsFx = lv.aceUnitsFx || [])[u] = { lid: uLid, lbl: dl, cv: dcv, txt: null, dry: false };
    const he = new THREE.LineSegments(new THREE.EdgesGeometry(hood, 25), new THREE.LineBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.9 })); he.position.z = 90.5; unit.add(he);   // Kanten der Haube
    const front = new THREE.Mesh(new THREE.BoxGeometry(A.w * 0.5, 4, 22), new THREE.MeshStandardMaterial({ color: 0x15181a })); front.position.set(0, -A.d / 2 - 1, 28); unit.add(front);
    // helle Leiste oben auf der Front (trägt die Einlässe)
    { const st2 = new THREE.Mesh(new THREE.BoxGeometry(A.w - 16, 42, 3), new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.4, metalness: 0.2 })); st2.position.set(0, -A.d / 2 + 22, 91.5); unit.add(st2); }
    // zwei Tragrollen quer unter allen Spulen (die Spulen liegen mit den Flanschen darauf)
    for (const ry of [-55, 55]) { const ro = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, A.w - 26, 20), new THREE.MeshStandardMaterial({ color: 0x8d969c, metalness: 0.6, roughness: 0.35 }));
      ro.rotation.z = Math.PI / 2; ro.position.set(0, ry, 20 + A.spoolR - Math.sqrt((A.spoolR + 8) ** 2 - ry * ry)); unit.add(ro); }
    for (let k = 0; k < 4; k++) {
      const sx = (k - 1.5) * (A.w - 40) / 4, sp = new THREE.Group(); sp.position.set(sx, 0, 20 + A.spoolR); unit.add(sp);
      const fil = new THREE.Mesh(new THREE.CylinderGeometry(A.spoolR - 14, A.spoolR - 14, A.spoolW - 8, 32), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 }));
      fil.rotation.z = Math.PI / 2; sp.add(fil);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(LV_SPOOL_CORE, LV_SPOOL_CORE, A.spoolW - 6, 24), new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.5 }));
      core.rotation.z = Math.PI / 2; sp.add(core);
      // Restmenge als Schild (Text wird bei Änderung neu gezeichnet)
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
      // vorn auf der ACE-Front unter der Spule (Fläche zeigt nach vorn, −y)
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(72, 27), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
      lbl.rotation.x = Math.PI / 2; lbl.position.set(sx, -A.d / 2 - 2.5, 70); unit.add(lbl);
      for (const s2 of [-1, 1]) { const fl = new THREE.Mesh(new THREE.CylinderGeometry(A.spoolR, A.spoolR, 2, 32), new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.5, transparent: true, opacity: 0.85 })); fl.rotation.z = Math.PI / 2; fl.position.x = s2 * A.spoolW / 2; sp.add(fl);
        // drei helle Speichen außen auf dem Flansch – sonst sähe man das Drehen der runden Spule nicht
        for (let q = 0; q < 3; q++) { const a = q * Math.PI * 2 / 3, spk = new THREE.Mesh(new THREE.BoxGeometry(1, 8, A.spoolR - LV_SPOOL_CORE - 6), spokeM);
          spk.position.set(s2 * (A.spoolW / 2 + 1.2), Math.sin(a) * (A.spoolR + LV_SPOOL_CORE) / 2, Math.cos(a) * (A.spoolR + LV_SPOOL_CORE) / 2); spk.rotation.x = -a; sp.add(spk); } }
      // Schlauch vom Slot (hinten am ACE) zum Verteiler, Filament darin in Slotfarbe
      // hinten aus dem ACE, hinter dem Drucker entlang und von unten in die Zusammenführung (8 Eingänge unten nebeneinander)
      const out = new THREE.Vector3(ax + sx, cy + A.d / 2 + 2, uz + 30), port = hub.clone().add(new THREE.Vector3((u * 4 + k - 3.5) * 5, 0, -22));
      // ein gleichmäßiger Bogen: waagerecht hinten aus dem ACE, senkrecht von unten in den Sammler (Bézier mit Tangenten in beiden Richtungen)
      // Hebel nach Abstand: weite Bögen auch beim oberen ACE, das kaum tiefer liegt als der Sammler
      const lift = port.z - out.z, run = Math.hypot(port.x - out.x, port.y - out.y), L = Math.max(lift, run);
      const curve = new THREE.CubicBezierCurve3(out, new THREE.Vector3(out.x, out.y + 60 + run * 0.12 + k * 5, out.z),
        new THREE.Vector3(port.x, port.y + 4 + k * 2, port.z - L * 0.55), port);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 2.3, 10), new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }));
      const fm = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 }), fline = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.9, 6), fm);
      tube.renderOrder = 8; ace.add(fline, tube);
      // Einzug vorn (wie beim ACE Pro): oranger Einlass in der hellen Leiste direkt vor der Spule, das Filament läuft vorn vom Wickel schräg hinein (lvAceColours)
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(6, 3, 4, 16), new THREE.MeshStandardMaterial({ color: 0xe8552b, roughness: 0.45 }));
      funnel.position.set(sx, -102, 94); funnel.rotation.x = Math.PI / 2; unit.add(funnel);
      const strand = new THREE.Mesh(new THREE.BufferGeometry(), fm); unit.add(strand);
      // fließendes Filament (nur aktiver Slot): eigenes Material mit wanderndem Leuchtstreifen, Schlauch und Strang zur Spule
      const flow = lvFlowMat(curve.getLength()), flowS = lvFlowMat(150);
      // weicher Leuchtschein um den fließenden Faden (additiv, dieselbe wandernde Textur)
      const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 2.2, 8), lvGlowMat(flow)), glowS = new THREE.Mesh(new THREE.BufferGeometry(), lvGlowMat(flowS));
      glow.renderOrder = glowS.renderOrder = 9; glow.visible = glowS.visible = false; ace.add(glow); unit.add(glowS);
      lv.aceSpools.push({ unit: u, slot: k, fil: fil.material, filMesh: fil, line: fm, group: sp, tubes: [tube, fline], lbl, cv, txt: null,
        strand, spoolC: new THREE.Vector3(sx, 0, 20 + A.spoolR), inlet: new THREE.Vector3(sx, -102, 95), k: null,
        funnel: funnel.material, flow, flowS, glow, glowS, loaded: false, active: false });
    }
  }
  const hubM = new THREE.Mesh(new THREE.BoxGeometry(48, 18, 44), body); hubM.position.copy(hub); ace.add(hubM);   // Zusammenführung hinten an der Rückwand, von hinten gesehen links, Mitte der oberen Hälfte
  // Zusammenführung oben raus: lvMechUpdate führt den Kopfschlauch von hier (Rahmen-Koordinaten) hoch, im 90°-Bogen nach vorn durch die Rückwand zur Kette
  lv.hubTop = hub.clone().add(new THREE.Vector3(0, 0, 22));
  ace.visible = store.settings.liveAce !== false; lv.gantry.add(ace); lv.aceG = ace;
  lvAceColours(typeof wb !== 'undefined' && wb.st);
}

// Spulenfarben aus dem Druckerstand (st.ace: Einheiten mit Slots), fehlende Spulen ausgeblendet, zweite Einheit nur, wenn gemeldet
function lvAceColours(st) {
  if (!lv.aceSpools) return;
  const boxes = (st && st.ace) || [], printing = !!(st && st.job && st.job.name && !st.job.paused);
  for (const sp of lv.aceSpools) {
    const box = boxes[sp.unit], s = box && (box.slots || [])[sp.slot], on = !!(s && s.present && s.colour);
    sp.group.visible = on; sp.tubes[1].visible = on; sp.tubes[0].visible = !!box;   // Schlauch nur, wenn die Einheit da ist
    if (on) { sp.fil.color.set(s.colour); sp.line.color.set(s.colour); }
    // geladener Slot: Einlass leuchtet in Filamentfarbe; beim Drucken dreht die Spule und Pulse laufen im Schlauch (lvAceTick)
    sp.loaded = on && !!s.loaded; sp.active = sp.loaded && printing;
    if (sp.loaded) { sp.funnel.color.set(s.colour); sp.funnel.emissive.set(s.colour); sp.funnel.emissiveIntensity = 0.8; }
    else { sp.funnel.color.set(0xe8552b); sp.funnel.emissiveIntensity = 0; }
    sp.lbl.material.opacity = boxes.some(b => (b.slots || []).some(x => x.loaded)) && !sp.loaded ? 0.45 : 1;   // andere Slots gedimmt
    if (sp.active) for (const m of [sp.flow, sp.flowS]) { m.color.set(s.colour); m.emissive.set(s.colour).lerp(new THREE.Color(0xffffff), 0.5); }
    if (sp.active) for (const o of [sp.glow, sp.glowS]) o.material.color.set(s.colour).lerp(new THREE.Color(0xffffff), 0.3);
    sp.glow.visible = sp.glowS.visible = sp.active;
    sp.tubes[1].material = sp.active ? sp.flow : sp.line; sp.strand.material = sp.active ? sp.flowS : sp.line;
    // Restmenge (Filamentverwaltung, js/spools-ui.js): Wickel so dick wie der Rest, Schild mit Gramm (rot unter 200 g)
    const rec = on && typeof spoolInSlot === 'function' ? spoolInSlot(sp.unit * 4 + sp.slot) : null;
    const pct = rec && rec.net_g > 0 ? Math.max(0, Math.min(1, rec.remaining_g / rec.net_g)) : (on ? 1 : 0);
    const full = LV_ACE.spoolR - 14, k = (LV_SPOOL_CORE + 2 + (full - LV_SPOOL_CORE - 2) * pct) / full;
    sp.filMesh.scale.set(k, 1, k);
    sp.strand.visible = on;
    if (on && k !== sp.k) {   // Strang läuft oben vom Wickel ab, im Viertelbogen vorn um die Spule und senkrecht von oben in den Einlass
      sp.k = k;
      const rw = full * k, C = sp.spoolC, I = sp.inlet, ry = C.y - I.y, pts = [];
      for (let q = 0; q <= 12; q++) { const t = q / 12 * Math.PI / 2; pts.push(new THREE.Vector3(C.x, C.y - ry * Math.sin(t), C.z + rw * Math.cos(t))); }
      for (let q = 1; q <= 3; q++) pts.push(new THREE.Vector3(C.x, I.y, C.z + (I.z - C.z) * q / 3));
      const sc = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      sp.strand.geometry.dispose(); sp.strand.geometry = new THREE.TubeGeometry(sc, 40, 0.9, 6);
      sp.glowS.geometry.dispose(); sp.glowS.geometry = new THREE.TubeGeometry(sc, 40, 2.2, 8);
      sp.flowS.emissiveMap.repeat.x = sc.getLength() / LV_FLOW_MM;
    }
    const txt = on ? (rec ? Math.round(rec.remaining_g) + ' g' : '') : '';
    sp.lbl.visible = !!txt;
    if (txt !== sp.txt) {
      sp.txt = txt;
      const g = sp.cv.getContext('2d'); g.clearRect(0, 0, 128, 48);
      if (txt) { g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(4, 6, 120, 36, 10); g.fill();
        g.font = 'bold 24px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = rec && rec.remaining_g < 200 ? '#ff6b5e' : '#ffffff'; g.fillText(txt, 64, 25); }
      sp.lbl.material.map.needsUpdate = true;
    }
  }
  if (lv.aceG) lv.aceG.children.forEach(c => { if (c.isGroup && c.position.z > (lv.aceG.children[0].position.z + 10)) c.visible = boxes.length > 1; });
  if (lv.aceUnits !== boxes.length) { lv.aceUnits = boxes.length; lvRefit(); }   // zweite Einheit kam dazu/fiel weg
  // Trocknen je Einheit (drying_status: status 1 = an, target_temp): Haube glüht, Schild mit Temperatur
  (lv.aceUnitsFx || []).forEach((fx, u) => {
    const b = boxes[u], d = b && b.drying, dry = !!(d && +d.status === 1);
    fx.dry = dry; fx.lbl.visible = dry; if (!dry) fx.lid.emissiveIntensity = 0;
    const cur = b && b.temp != null && +b.temp > 0 ? Math.round(+b.temp) : null;
    const txt = dry ? t('Trocknet') + ' ' + (cur != null ? cur + ' °C' : '') + (+d.target_temp > 0 ? ' → ' + Math.round(+d.target_temp) + ' °C' : '') : '';
    if (txt !== fx.txt) {
      fx.txt = txt;
      const g = fx.cv.getContext('2d'); g.clearRect(0, 0, 256, 48);
      if (txt) { g.fillStyle = 'rgba(120,40,0,.75)'; g.beginPath(); g.roundRect(4, 6, 248, 36, 10); g.fill();
        g.font = 'bold 22px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffd2a8'; g.fillText(txt, 128, 25); }
      fx.lbl.material.map.needsUpdate = true;
    }
  });
  if (lv.filGlow) lv.filGlow.visible = lvAceFlowing();   // Fluss zum Kopf endet mit dem Druck
  // Farbwechsel: anderer Slot geladen, während gedruckt wird → altes Filament zurück, neues vor, Spülmenge (lvAceAnimate)
  const now = lv.aceSpools.find(sp => sp.loaded) || null;
  if (printing && lv.aceLast && now && now !== lv.aceLast && !lv.swap)
    lv.swap = { from: lv.aceLast, to: now, t0: performance.now(), c0: lv.aceLast.fil.color.clone(), c1: now.fil.color.clone(), drops: [] };
  if (now) lv.aceLast = now;
  lvAceAnimate();
  lvRender();
}
// Bewegung der ACE: aktive Spule dreht ab, Pulse im Schlauch, Einlass pulsiert, Haube glüht beim Trocknen (~30 Bilder/s, nur wenn nötig)
const LV_ACE_SPIN = 0.9, LV_FLOW_MM = 70, LV_FLOW_V = 80;   // Abstand der Leuchtstreifen und ihr Tempo (mm, mm/s)
// Leuchtstreifen als Textur entlang des Fadens (u = Länge): weicher Kopf, langer Schweif dahinter, dazwischen dunkel
let lvFlowTexBase = null;
function lvFlowMat(len) {
  if (!lvFlowTexBase) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 4;
    const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, '#000'); gr.addColorStop(0.35, '#000'); gr.addColorStop(0.82, '#8a8a8a'); gr.addColorStop(0.9, '#fff'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 4);
    lvFlowTexBase = new THREE.CanvasTexture(cv); LV_SHARED.add(lvFlowTexBase);
  }
  const tex = lvFlowTexBase.clone(); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(Math.max(1, len / LV_FLOW_MM), 1); tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 1.6, emissiveMap: tex });
}
function lvGlowMat(flow) {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, map: flow.emissiveMap, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
}

function lvAceAnimate() {
  if (lv.aceAnim) return;
  const busy = () => lvOnScreen() && (lvFxBusy() || lv.aceSpools && lv.aceG && lv.aceG.visible)
    && ((lv.aceSpools || []).some(sp => sp.active) || (lv.aceUnitsFx || []).some(fx => fx.dry) || lvFxBusy());   // nur wenn sich etwas tut (Akku am Handy)
  if (!busy()) return;
  let last = 0;
  const tick = (now) => {
    lv.aceAnim = 0;
    if (!busy()) return;
    if (now - last >= 33) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0, ph = now / 1000;
      last = now;
      for (const sp of lv.aceSpools || []) {
        if (sp.active) sp.funnel.emissiveIntensity = 0.9 + 0.6 * Math.sin(ph * 3);
        if (!sp.active) continue;
        if (lv.swap && sp === lv.swap.to && (now - lv.swap.t0) / 1000 < LV_SWAP_BACK_S) continue;   // neuer Slot wartet, bis das alte Filament zurück ist
        sp.group.rotation.x += LV_ACE_SPIN * dt;   // oben läuft das Filament nach vorn (−y) ab
        // Streifen laufen von der Spule zum Drucker (u wächst Richtung Drucker); Strang und Schlauch gleich schnell
        for (const m of [sp.flow, sp.flowS]) m.emissiveMap.offset.x -= LV_FLOW_V / LV_FLOW_MM * dt;
      }
      if (lv.filFlow) lv.filFlow.emissiveMap.offset.x -= LV_FLOW_V / LV_FLOW_MM * dt;   // Kopfschlauch (lvMechUpdate)
      for (const fx of lv.aceUnitsFx || []) if (fx.dry) fx.lid.emissiveIntensity = 0.35 + 0.25 * Math.sin(ph * 1.6);
      lvSwapTick(now, dt); lvFxTick(ph);
      if (lvFansOn()) lvFanTick();
      lvRender();
    }
    lv.aceAnim = requestAnimationFrame(tick);
  };
  lv.aceAnim = requestAnimationFrame(tick);
}

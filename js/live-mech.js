'use strict';
/* 3D-Fortschritt, Teil Mechanik (aus js/live-ui.js): Druckkopf, Traverse, Rahmen, Z-Spindeln und Z-Antrieb, Riemen mit Rollen
   und Ritzeln, Eckgehäuse, Aufbau von Kette, Schlauch und Lüftern (lvHeadInit, lvMechInit). */

/* Drucker-Mechanik ungefähr wie beim Kobra S1 (CoreXY, das Bett fährt nach unten): Kopf ≈ 56 × 48 × 70 mm (geschätzt, keine
   offiziellen Maße), darüber die X-Traverse über die ganze Breite und links/rechts die Y-Schienen – beide auf Höhe des
   Kopfes, sie fahren mit der Düse mit. Dazu der Umriss des Druckbetts. Maße in mm, Koordinaten wie die Bahnen. */
const LV_HEAD = { w: 56, d: 48, h: 100, tip: 8 },   // h: bis über die Riemen (sie enden im Kopf)
      LV_GANTRY_Z = 52, LV_RAIL = 10, LV_FRAME_H = 330, LV_ROD_R = 4;
// Riemenebenen (über den X-Stangen): wie im Kobra S1 rechter Motor (A) oben, linker (B) unten
/* nach dem Foto des Kobra S1 (2026-10-08): an der Traverse zwei X-Stangen – oben knapp unter der Kopfoberkante, unten etwa
   auf halber Kopfhöhe – und dazwischen die zwei Riemen übereinander in derselben Ebene; Y-Stangen auf Höhe der oberen X-Stange.
   z relativ zur Traverse (= Düse + LV_GANTRY_Z) */
const LV_BELT_Z = { A: 23, B: 12 }, LV_ROD_Z = [0, 35];
// Stangen und Riemen sitzen im hinteren Viertel bis Drittel des Kopfes (Foto): Traverse liegt so weit hinter der Düse
const LV_BEAM_DY = 13;
const LV_BELT_GAP = 8, LV_BELT_SPAN = 12;   // Strangabstand je Seite (Umkehrrolle vorn: Durchmesser 12 mm)   // Abstand der beiden Riemenstränge je Seite (Motor ↔ Umlenkung)
// Modell des Druckers für die Nachbildung: gemeldetes Modell, sonst gewählter Drucker, sonst Kobra S1 (js/anycubic-models.js)
function lvModel() {
  const st = typeof wb !== 'undefined' && wb.st;
  return (typeof anycubicLanModel === 'function' && st && anycubicLanModel(st.model)) || (typeof lanModelOf === 'function' && lastResult && lanModelOf(lastResult.printer)) ||
    { key: 'kobra_s1', kin: 'corexy', size: [250, 250, 250] };
}
function lvBed() {
  const md = lvModel();
  if (md.key !== 'kobra_s1') return { x0: 0, y0: 0, x1: md.size[0], y1: md.size[1] };   // andere Anycubic: Bauraum aus der Modelltabelle
  const tpl = typeof exportTemplate === 'function' ? exportTemplate(typeof WB_PRINTER !== 'undefined' ? WB_PRINTER : 'kobra_s1', '0.4') : null;
  const pts = tpl ? (tpl.settings.printable_area || []).map(p => p.split('x').map(Number)) : [];
  if (!pts.length) return { x0: 0, y0: 0, x1: 250, y1: 250 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function lvHeadInit() {
  // ACE-Flussmaterialien hängen nicht immer an einem Teil (lvAceColours tauscht sie) – eigens freigeben
  const loose = (lv.aceSpools || []).flatMap(sp => [sp.flow, sp.flowS, sp.line]);
  for (const k of ['head', 'gantry', 'bed', 'frameFixed', 'mechG', 'zArms']) if (lv[k]) { lv.scene.remove(lv[k]); lvDispose(lv[k]); lv[k] = null; }
  lvDispose(null, loose);
  if (lv.swap) { for (const d of lv.swap.drops) { lv.scene.remove(d.m); lvDispose(d.m); } lv.swap = null; }
  lv.aceSpools = null; lv.aceUnitsFx = null; lv.aceLast = null; lv.tube = lv.fil = lv.filGlow = null; lv.display = null; lv.mechBuilt = null;
  lv.aceG = lv.enclosureG = lv.encLight = lv.statusLine = null; lv.filTool = null;   // neues Schlauchmaterial: Filamentfarbe neu setzen (lvFilamentAt)
  lv.motorCaps = []; lv.zScrews = []; lv.zDrive = null;
  /* Druckkopf und Mechanik (2026-10-07, vorher Glaskästen): beleuchtete Teile, leicht durchscheinend, damit das Teil
     sichtbar bleibt. Graphit-Gehäuse (der Petrol-Streifen verdeckte das Teil – entfernt), Lüfterring vorn, Alu-Heizblock, Messingdüse; X-Traverse als
     Alu-Profil mit Nut und Laufwagen, Y-Schienen als Stahlstangen. */
  const H = LV_HEAD, mat = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.55, metalness: o.m ?? 0.1, transparent: (o.op ?? 1) < 1, opacity: o.op ?? 1, depthWrite: (o.op ?? 1) >= 1, flatShading: !!o.flat });
  const rounded = (w, d, r) => { const sh = new THREE.Shape(), x = -w / 2, y = -d / 2;
    sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y); return sh; };
  const slab = (w, d, h, r, bevel) => new THREE.ExtrudeGeometry(rounded(w, d, r), { depth: h, bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 2, curveSegments: 8 });
  /* Aussehen wie das Kobra-S1-Innenleben (2026-10-07, Vorlage: Anycubic-Produktbild): weißer Kopf mit orangem Streifen
     unten und schwarzem Lüfter, zwei X-Stangen übereinander und die Y-Stangen in Silber, schwarze Eckwagen, blaue Motoren hinten,
     dunkler Rahmen mit Z-Spindeln. Rahmen und Mechanik hängen zusammen – wie beim Drucker fährt relativ dazu das Bett. */
  const tip = new THREE.Mesh(new THREE.ConeGeometry(3.2, H.tip, 24), mat(0xd4a93f, { m: 0.45, r: 0.35 }));
  tip.rotation.x = -Math.PI / 2; tip.position.z = H.tip / 2;
  const heat = new THREE.Mesh(new THREE.BoxGeometry(16, 14, 6), mat(0xb4bdc2, { m: 0.35, r: 0.4 })); heat.position.z = H.tip + 3;
  const bodyH = H.h - 12, bodyZ = H.tip + 8;
  // leicht durchsichtig, damit die Druckstelle zu sehen bleibt (2026-10-08)
  const body = new THREE.Mesh(slab(H.w - 4, H.d - 4, bodyH, 9, 2), mat(0xeceff1, { r: 0.45, op: 0.72 })); body.position.z = bodyZ; body.renderOrder = 2;
  // oranger Streifen unten: nur die Außenhaut (Ring), kein Querschnitt
  // undurchsichtig und 2 mm über dem Gehäuse – durchscheinend verschwand er von der Seite hinter dem Gehäuse (2026-10-08)
  const ringSh = rounded(H.w + 4, H.d + 4, 12); ringSh.holes.push(rounded(H.w - 2, H.d - 2, 9.5));
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(ringSh, { depth: 12, bevelEnabled: false, curveSegments: 8 }), mat(0xf26a21, { r: 0.45 })); ring.position.z = bodyZ - 2; ring.renderOrder = 1;
  // Lüfter vorn (−Y): dunkler Ring, schwarze Scheibe, Nabe
  const fanR = Math.min(H.w, H.h) * 0.24, fan = new THREE.Group(), fanZ = bodyZ + bodyH * 0.64;   // Bauteillüfter, oberes Drittel der Front (Foto)
  fan.add(new THREE.Mesh(new THREE.TorusGeometry(fanR, 1.8, 10, 40), mat(0x2a2f33, { r: 0.6 })), new THREE.Mesh(new THREE.CircleGeometry(fanR - 0.5, 40), mat(0x0f1215, { r: 0.8 })),
    new THREE.Mesh(new THREE.CircleGeometry(fanR * 0.32, 24), mat(0x2a2f33, { r: 0.6 })));
  fan.children[2].position.z = 0.2;
  fan.rotation.x = Math.PI / 2; fan.position.set(0, -(H.d / 2) - 2.2, fanZ); lv.headFan = fan; lv.rotors = [];
  lv.head = new THREE.Group(); lv.head.add(tip, heat, body, ring, fan); lv.head.visible = false;
  lv.hotM = [heat.material, tip.material];   // glühen nach Düsentemperatur (lvFx)
  // Mechanik (Koordinaten relativ zur Traverse, die mit dem Kopf in Z fährt)
  const bed = lvBed(), bx0 = bed.x0 - lv.cx, bx1 = bed.x1 - lv.cx, by0 = bed.y0 - lv.cy, by1 = bed.y1 - lv.cy, R = LV_RAIL;
  const md = lvModel(); lv.kin = md.kin;
  /* CoreXY in den Maßen des Kobra S1 (2026-10-08): Gehäuse ≈ Bauraum + 150 × 160 mm (S1: 400 × 410), Höhe Bauraum + 180,
     Y-Stangen 32 mm innen am Rahmen, Stangen Ø 8 mm, NEMA-17-Motoren 42 × 42 × 40 mm */
  const halfW = md.size[0] / 2 + 75, halfD = md.size[1] / 2 + 80, cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const m = md.kin === 'bed' ? 22 : halfW - 32 - (bx1 - bx0) / 2;
  const len = bx1 - bx0 + 2 * m, ylen = md.kin === 'bed' ? by1 - by0 + 2 * m : 2 * halfD - 40;
  // Stangen silbern (beim Kobra S1 Stahl – auf dem Produktbild nur orange angeleuchtet)
  const rodM = mat(0xd9dee1, { m: 0.55, r: 0.25 });
  const black = mat(0x1d2124, { r: 0.6 }), steel = mat(0xd5dbde, { m: 0.5, r: 0.3 }), frameM = mat(0x2a3034, { r: 0.7, op: 0.45 });   // rauchig wie im Produktbild, versperrt die Sicht nicht
  // X: zwei Stangen (der Kopf hängt daran), Eckwagen an den Enden; fährt in Y (lvPlaceHead: beam.position.y)
  const beam = new THREE.Group(), rodX = new THREE.CylinderGeometry(LV_ROD_R, LV_ROD_R, len, 20);
  // zwei X-Stangen übereinander (wie am Kobra S1), der Kopf gleitet darauf
  for (const dz of LV_ROD_Z) { const r = new THREE.Mesh(rodX, rodM); r.rotation.z = Math.PI / 2; r.position.set(0, 0, dz); beam.add(r); }
  /* Eckwagen an den Y-Schienen (nach Foto): offenes Gehäuse – Führung um die Y-Stange, Boden- und Deckplatte, Außenwand;
     darin die beiden Umlenkrollen der Riemen (lvMechInit, bei x = Schiene ± LV_BELT_GAP), zur Mitte hin offen und sichtbar.
     Koordinaten der Traverse: Riemen bei y = −9 − LV_BEAM_DY */
  const by_ = -9 - LV_BEAM_DY, cy0 = by_ - 12, cy1 = 16, cd = cy1 - cy0, cmid = (cy0 + cy1) / 2;
  for (const sx of [-1, 1]) {
    const car = new THREE.Group(), xr = sx * len / 2, inner = -sx, box = (w, d, h, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), black); o.position.set(x, y, z); car.add(o); };
    box(16, cd, 16, xr, cmid, LV_ROD_Z[1]);                                                  // Führung um die Y-Stange
    box(34, cd, 3, xr + inner * 9, cmid, LV_BELT_Z.B - LV_BELT_H / 2 - 4);                    // Bodenplatte unter den Rollen
    box(34, cd, 3, xr + inner * 9, cmid, LV_BELT_Z.A + LV_BELT_H / 2 + 6);                    // Deckplatte über den Rollen
    box(3, cd, LV_BELT_Z.A - LV_BELT_Z.B + LV_BELT_H + 10, xr - inner * 7, cmid, (LV_BELT_Z.A + LV_BELT_Z.B) / 2 + 1);   // Außenwand
    box(24, 22, LV_ROD_Z[1] + 2 * LV_ROD_R + 10, xr + inner * 6, 0, LV_ROD_Z[1] / 2);        // umfasst die Enden beider X-Stangen
    beam.add(car); }
  beam.position.x = cx;
  // Y: je Seite eine Stange durch die Eckwagen
  const rodY = new THREE.CylinderGeometry(LV_ROD_R, LV_ROD_R, ylen, 20), rails = [bx0 - m, bx1 + m].map(x => { const r = new THREE.Mesh(rodY, rodM); r.position.set(x, cy, md.kin === 'bed' ? -R * 0.6 : LV_ROD_Z[1]); return r; });
  let frame = new THREE.Group();
  if (md.kin === 'bed') {
    /* Bettschubser (Kobra 3, 3 Max, X): zwei Z-Türme links/rechts der X-Achse, oben eine Querstrebe, unten Y-Schienen unter dem
       Bett und ein Fuß; der ganze Aufbau fährt relativ zum Teil in Y (lvPlaceHead), das Bett mit dem Teil steht still */
    // fester Rahmen in Bett-Koordinaten (z absolut: Fuß unter dem Bett, Türme bis über den Bauraum); fährt nur in Y mit
    const z0 = -45, top = md.size[2] + 70, fh = top - z0, tw = 22, ylen = (by1 - by0) * 2 + 60;
    const bar = (x0, y0, z0, x1, y1, z1, mm) => { const g = new THREE.Mesh(new THREE.BoxGeometry(Math.max(tw, x1 - x0), Math.max(tw, y1 - y0), Math.max(tw, z1 - z0)), mm || mat(0x2a3034, { r: 0.6 })); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); frame.add(g); };
    for (const x of [bx0 - m, bx1 + m]) bar(x, 0, top - fh, x, 0, top);                       // Türme
    bar(bx0 - m, 0, top, bx1 + m, 0, top);                                                       // Querstrebe oben
    for (const x of [cx - (bx1 - bx0) * 0.3, cx + (bx1 - bx0) * 0.3]) bar(x, -ylen / 2, top - fh, x, ylen / 2, top - fh + 12);   // Y-Schienen
    bar(bx0 - m, -ylen / 2, top - fh - 8, bx1 + m, ylen / 2, top - fh);                          // Fuß
    for (const x of [bx0 - m + 14, bx1 + m - 14]) { const sc = lvLeadScrew(4, fh - 30); sc.rotation.x = Math.PI / 2; sc.position.set(x, 16, top - fh / 2); frame.add(sc); }   // Z-Spindeln
    const mo = new THREE.Mesh(slab(30, 30, 34, 3, 1), mat(0x30373c, { r: 0.5 })); mo.position.set(bx0 - m - 4, 0, -14); beam.add(mo);   // X-Motor (fährt mit der X-Achse)
    lv.frameFixed = frame; frame = new THREE.Group();
  } else {
    lv.frameFixed = null;
  // Rahmen: oben und unten ein Rechteck aus 20er-Profilen, vier Säulen; oben auf Höhe der Riemen
  const fx0 = cx - halfW, fx1 = cx + halfW, fy0 = cy - halfD, fy1 = cy + halfD, fw = 20, fh = md.size[2] + 180, top = LV_ROD_Z[1] + 18;
  const bar = (x0, y0, z0, x1, y1, z1) => { const g = new THREE.Mesh(new THREE.BoxGeometry(Math.max(fw, x1 - x0), Math.max(fw, y1 - y0), Math.max(fw, z1 - z0)), frameM); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); frame.add(g); };
  for (const z of [top, top - fh]) { bar(fx0, fy0, z, fx1, fy0, z); bar(fx0, fy1, z, fx1, fy1, z); bar(fx0, fy0, z, fx0, fy1, z); bar(fx1, fy0, z, fx1, fy1, z); }
  for (const x of [fx0, fx1]) for (const y of [fy0, fy1]) bar(x, y, top - fh, x, y, top);
  // blaue NEMA-17-Motoren in den hinteren Ecken, Riemenscheibe je auf der Höhe ihres Riemens (links B unten, rechts A oben)
  const motor = mat(0x3d9fe0, { r: 0.35, m: 0.2 }); motor.emissive = new THREE.Color(0x0c3a5c);
  // Motoren und seitliche Riemenstränge außerhalb des Kopfwegs: innerer Strang ≥ 5 mm neben dem Kopf am Bettrand
  // (Kopf ±LV_HEAD.w/2 um die Düse); die Riemen laufen unter den Y-Stangen, dürfen sie also in x überdecken
  /* Riemenlauf nach der Anycubic-Skizze (2026-10-08): je Seite außen und innen ein Strang (innen = Wagenrolle), hinten zwei
     Rollen nebeneinander mit dem Motor dazwischen davor („Omega“), vorn eine Umkehrrolle. Die Motoren sitzen UNTER den Riemen,
     Welle nach oben – so weit hinten, dass der Kopf auch hinten in der Ecke frei bleibt. Innere Stränge außerhalb des Kopfwegs. */
  const G = LV_BELT_SPAN, xLi = bx0 - LV_HEAD.w / 2 - 16, xLo = xLi - G, xRi = bx1 + LV_HEAD.w / 2 + 16, xRo = xRi + G;   // Wagenrollen (Mitte 5 mm innen) bleiben neben Kopf und Hotend-Lüfter
  const yb = fy1 - 22, yF = fy0 + 34, mL = [xLo + 34, yb - 10], mR = [xRo - 34, yb - 10];
  for (const [[x, y], bz] of [[mL, LV_BELT_Z.B], [mR, LV_BELT_Z.A]]) {
    // unter dem Riemen, Welle nach oben zum Ritzel; Halteblech auf dem Motor zum hinteren Rahmen
    const zMot = bz - LV_BELT_H / 2 - 14 - 40, mo = new THREE.Mesh(slab(42, 42, 40, 4, 1), motor); mo.position.set(x, y, zMot); frame.add(mo);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(48, fy1 - y + 21, 3), black); plate.position.set(x, (y - 21 + fy1) / 2, zMot + 41.5); frame.add(plate);   // ab der Motorkante – nicht in den Kopfweg
    const cap = lvMotorPulley(); cap.rotation.x = Math.PI / 2; cap.position.set(x, y, bz); frame.add(cap);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 14, 12), steel); shaft.rotation.x = Math.PI / 2; shaft.position.set(x, y, bz - LV_BELT_H / 2 - 7); frame.add(shaft);
    lv.motorCaps.push(cap); }
  lv.xy = { xLi, xLo, xRi, xRo, yb, yF, mL, mR, fx0, fx1, fy0, fy1, top }; lv.frameH = fh;
  // Y-Stangen mit Endblöcken an den Rahmenecken (vorn/hinten oben)
  for (const x of [bx0 - m, bx1 + m]) for (const [y0, y1] of [[fy0, cy - ylen / 2 + 10], [cy + ylen / 2 - 10, fy1]]) {
    const blk = new THREE.Mesh(new THREE.BoxGeometry(20, y1 - y0, top - LV_ROD_Z[1] + 16), black); blk.position.set(x, (y0 + y1) / 2, (LV_ROD_Z[1] - 8 + top + 8) / 2); frame.add(blk); }
  // drei Z-Spindeln wie am Kobra S1: hinten in der Mitte, vorne links und vorne rechts
  // direkt am Druckbett: das Bett hängt mit Haltern und Spindelmuttern daran (lv.zArms, bleiben beim Bett)
  // außerhalb des Kopfwegs (Kopf ±LV_HEAD.w/2 bzw. ±LV_HEAD.d/2 um die Düse, + 6 mm), damit sie bis übers Bett reichen dürfen
  const zx = LV_HEAD.w / 2 + 18, zy = LV_HEAD.d / 2 + 18;   // inkl. Lagerböcke (16 mm) und Hotend-Lüfter außen am Kopf
  const zs = [[cx, by1 + zy], [bx0 - zx, by0 + 30], [bx1 + zx, by0 + 30]];
  for (const [x, y] of zs) {
    // reichen bis 12 mm über die Düsenspitze: auch beim höchsten Bettstand (erste Schicht) geht die Spindel durch die Mutter
    const zTop = -LV_GANTRY_Z + 12, zBot = top - fh + 15, sc = lvLeadScrew(4, zTop - zBot);
    sc.rotation.x = Math.PI / 2; sc.position.set(x, y, (zTop + zBot) / 2); frame.add(sc);
    // Lagerböcke oben und unten mit Strebe zur nächsten Rahmenwand (links/rechts bzw. hinten)
    const toX = Math.abs(x - cx) > 40, wall = toX ? (x < cx ? fx0 : fx1) : fy1;
    for (const z of [zTop + 3, zBot - 3]) {
      const brg = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 10), black); brg.position.set(x, y, z); frame.add(brg);
      const L = Math.abs(wall - (toX ? x : y)), st = new THREE.Mesh(new THREE.BoxGeometry(toX ? L : 10, toX ? 10 : L, 6), black);
      st.position.set(toX ? (x + wall) / 2 : x, toX ? y : (y + wall) / 2, z); frame.add(st); }
  }
  // Z-Antrieb unten im Gehäuse: Motor hinten rechts, geschlossener Zahnriemen über die Ritzel der drei Spindeln und des Motors
  lv.zDrive = lvZDrive(frame, zs.concat([[cx + 95, by1 + zy - 6]]), top - fh + 30, () => new THREE.Mesh(slab(42, 42, 40, 4, 1), motor));   // gleiche Form wie die XY-Motoren
  lv.zArms = new THREE.Group();
  const armM = mat(0x3a4146, { r: 0.55 }), nutM = mat(0xc9a14a, { m: 0.5, r: 0.35 });
  for (const [x, y] of zs) {
    // Halter vom Bettrand zur Spindel, Messingmutter um die Spindel – auf Höhe des Betts, fest mit dem Teil
    const ex = Math.max(bx0, Math.min(bx1, x)), ey = Math.max(by0, Math.min(by1, y)), dx = x - ex, dy = y - ey, L = Math.hypot(dx, dy);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(L + 14, 16, 8), armM); arm.position.set((x + ex) / 2, (y + ey) / 2, -8); arm.rotation.z = Math.atan2(dy, dx); lv.zArms.add(arm);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 14, 16), nutM); nut.rotation.x = Math.PI / 2; nut.position.set(x, y, -8); lv.zArms.add(nut);
  }
  }
  lv.gantry = new THREE.Group(); lv.gantry.add(beam, ...(md.kin === 'bed' ? [] : rails), frame);
  if (lv.frameFixed) { lv.frameFixed.visible = false; lv.scene.add(lv.frameFixed); } lv.gantry.userData.beam = beam; lv.gantry.visible = false;
  // Bett: Umriss auf Höhe 0
  const bedPts = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  lv.bed = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bedPts), new THREE.LineBasicMaterial({ color: 0x5b6b73 }));
  // gefüllte Druckplatte knapp unter den Bahnen
  if (lv.plate) { lv.scene.remove(lv.plate); lv.plate.geometry.dispose(); lv.plate.material.dispose(); }
  lv.plate = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, by1 - by0), new THREE.MeshLambertMaterial({ color: 0x1d272d }));
  lv.plate.position.set((bx0 + bx1) / 2, (by0 + by1) / 2, -0.03);
  lvMechInit(md, { bx0, bx1, by0, by1, m, cx, cy, beam });
  lv.scene.add(lv.head, lv.gantry, lv.bed, lv.plate, lv.mechG);
  if (lv.zArms) lv.scene.add(lv.zArms);
  lvTheme();
}
/* Z-Spindel (Trapezgewinde Tr8, 2026-10-08): Kern und erhabene Gänge als Schraubenlinie (echte Geometrie, kein Bild) –
   4 Gänge mit je LV_SCREW_LEAD mm Steigung (= 2 mm Teilung wie beim Tr8x8). Dreht sich mit der Höhe (lvMechUpdate):
   eine Umdrehung je LV_SCREW_LEAD mm Hub, läuft so sichtbar durch die Mutter am Bett. */
const LV_SCREW_LEAD = 8, LV_SCREW_STARTS = 4;
class LvHelix extends THREE.Curve {
  constructor(r, len, turns, phase) { super(); this.r = r; this.len = len; this.turns = turns; this.phase = phase; }
  getPoint(t, out = new THREE.Vector3()) {
    const a = this.phase + t * this.turns * Math.PI * 2;
    return out.set(this.r * Math.cos(a), (t - 0.5) * this.len, this.r * Math.sin(a));
  }
}
function lvLeadScrew(r, len) {
  const g = new THREE.Group(), steelM = new THREE.MeshStandardMaterial({ color: 0xc3cacf, metalness: 0.6, roughness: 0.32 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r - 0.9, r - 0.9, len, 18), new THREE.MeshStandardMaterial({ color: 0x8e979c, metalness: 0.6, roughness: 0.4 })));
  const turns = len / LV_SCREW_LEAD;
  for (let k = 0; k < LV_SCREW_STARTS; k++)
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new LvHelix(r - 0.75, len, turns, k / LV_SCREW_STARTS * Math.PI * 2), Math.ceil(turns * 14), 0.62, 5), steelM));
  lv.zScrews.push(g);
  return g;
}
/* Z-Antrieb (2026-10-08): geschlossener Riemen unten im Gehäuse um die Ritzel (Achse z) an pts (Spindeln + Motor, letzter
   Punkt = Motor). Der Riemen läuft außen um die konvexe Hülle: gerade Stücke tangential, Bögen um die Ritzel. Dreht mit der
   Höhe (lvZDriveSet): eine Spindel-Umdrehung je LV_SCREW_LEAD mm, Riemenweg = Winkel × Ritzelradius. */
function lvZDrive(parent, pts, z, mkMotor) {
  const r = LV_MOTOR_R, cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const ring = pts.map((p, i) => ({ p, i, a: Math.atan2(p[1] - cy, p[0] - cx) })).sort((u, v) => u.a - v.a);   // gegen den Uhrzeigersinn
  const pulleys = [], segs = [], box = new THREE.BoxGeometry(1, 1, 1);
  for (const { p, i } of ring) {
    const pu = lvMotorPulley(); pu.rotation.x = Math.PI / 2; pu.position.set(p[0], p[1], z); parent.add(pu); pulleys.push(pu);
    if (i === pts.length - 1) {   // Motor unter seinem Ritzel
      const mo = mkMotor(); mo.position.set(p[0], p[1], z - LV_BELT_H / 2 - 8 - 40); parent.add(mo);   // abgerundet, Oberseite unter dem Ritzel
    }
  }
  // Weg: je Kante gerade (außen tangential, Normale nach außen), je Ecke Bogen um das Ritzel
  const n = ring.length, pieces = [];
  const norm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };   // rechts der Laufrichtung = außen (CCW)
  for (let k = 0; k < n; k++) {
    const A = ring[k].p, B = ring[(k + 1) % n].p, nn = norm(A, B);
    pieces.push({ line: [[A[0] + nn[0] * r, A[1] + nn[1] * r], [B[0] + nn[0] * r, B[1] + nn[1] * r]] });
    const C = ring[(k + 2) % n].p, n2 = norm(B, C), a0 = Math.atan2(nn[1], nn[0]);
    let sw = Math.atan2(n2[1], n2[0]) - a0; while (sw > 0) sw -= 2 * Math.PI; while (sw <= -2 * Math.PI) sw += 2 * Math.PI;
    if (sw < -Math.PI) sw += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 16)));
    for (let s2 = 0; s2 < steps; s2++) {
      const t0 = a0 + sw * s2 / steps, t1 = a0 + sw * (s2 + 1) / steps;
      pieces.push({ line: [[B[0] + Math.cos(t0) * r, B[1] + Math.sin(t0) * r], [B[0] + Math.cos(t1) * r, B[1] + Math.sin(t1) * r]] });
    }
  }
  let mat = 0;
  for (const pc of pieces) {
    const [p, q] = pc.line, len = Math.max(0.01, Math.hypot(q[0] - p[0], q[1] - p[1]));
    const tex = lvBeltTexture().clone(); tex.needsUpdate = true; tex.repeat.set(len / LV_BELT_PITCH, 1);
    const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    mesh.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z); mesh.rotation.z = Math.atan2(q[1] - p[1], q[0] - p[0]); mesh.scale.set(len + 0.4, LV_BELT_T, LV_BELT_H);
    parent.add(mesh); segs.push({ mesh, at: mat }); mat += len;
  }
  return { pulleys, segs, r };
}
function lvZDriveSet(d, z) {
  if (!d) return;
  const ang = -(z / LV_SCREW_LEAD) * Math.PI * 2, travel = ang * d.r;
  for (const pu of d.pulleys) pu.rotation.y = ang;
  for (const s2 of d.segs) s2.mesh.material.map.offset.x = (s2.at + travel) / LV_BELT_PITCH;
}
/* Riemen, Schleppkette und Filamentschlauch (2026-10-08, Spielerei): CoreXY mit zwei Riemen übereinander – Motoren hinten,
   Umlenkrollen vorn und an den Eckwagen, beide Enden am Kopf; Riemen A läuft mit x + y, B mit x − y (CoreXY), die Zähne
   wandern mit. Bettschubser: X-Riemen an der Traverse (läuft mit x), Y-Riemen unter dem Bett (läuft mit y). Schleppkette
   vom Rahmen hinten oben zum Kopf, daneben der PTFE-Schlauch mit dem Filament in der Farbe der gerade gedruckten Bahn. */
const LV_BELT_PITCH = 4, LV_BELT_H = 6, LV_BELT_T = 1.4, LV_CHAIN_LINKS = 26, LV_ROLL_R = 5, LV_MOTOR_R = 6.5;
let lvBeltTex = null;
function lvBeltTexture() {
  if (lvBeltTex) return lvBeltTex;
  const c = document.createElement('canvas'); c.width = 32; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#16191b'; g.fillRect(0, 0, 32, 8); g.fillStyle = '#4a5156'; g.fillRect(0, 0, 12, 8);
  lvBeltTex = new THREE.CanvasTexture(c); lvBeltTex.wrapS = THREE.RepeatWrapping; LV_SHARED.add(lvBeltTex);
  return lvBeltTex;
}
/* Umlenkrolle und Motorritzel (2026-10-08): Achse y (wie CylinderGeometry), gedreht wird um y.
   Rolle: Bordscheiben oben/unten, glatte Lauffläche, Lagerscheibe mit drei Löchern (Drehung sichtbar), Achse mit Sechskantkopf.
   Ritzel: GT2-Zahnscheibe (20 Zähne) mit Bordscheibe unten und Nabe mit Madenschraube oben. Geometrien einmal, geteilt. */
let lvPulleyParts = null;
function lvPulleyKit() {
  if (lvPulleyParts) return lvPulleyParts;
  const h = LV_BELT_H, R = LV_ROLL_R, M = LV_MOTOR_R;
  const alu = new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.3, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3135, metalness: 0.3, roughness: 0.5 });
  const steelM = new THREE.MeshStandardMaterial({ color: 0xe1e5e8, metalness: 0.7, roughness: 0.25 });
  // Zahnscheibe: Umriss mit 20 Zähnen, extrudiert und auf die y-Achse gelegt
  // Zahnkranz (GT2): Umriss mit N Zähnen, extrudiert und auf die y-Achse gelegt – für Ritzel (20 Zähne) und Umlenkrollen (16)
  const gearGeo = (N, ro, rr, depth) => {
    const sh = new THREE.Shape();
    for (let i = 0; i < N * 4; i++) { const a = i / (N * 4) * Math.PI * 2, rad = (i % 4 === 1 || i % 4 === 2) ? ro : rr; const x = Math.cos(a) * rad, y = Math.sin(a) * rad; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -depth / 2, 0); return g;
  };
  const gearG = gearGeo(20, M, M - 0.9, h + 0.4), idlerG = gearGeo(16, R, R - 0.8, h);
  lvPulleyParts = {
    alu, dark, steelM, gearG, idlerG,
    flange: new THREE.CylinderGeometry(R + 1.8, R + 1.8, 0.9, 24), body: new THREE.CylinderGeometry(R, R, h, 24),
    bearing: new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.4, 20), hole: new THREE.CylinderGeometry(0.7, 0.7, 0.5, 8),
    axle: new THREE.CylinderGeometry(1.2, 1.2, h + 6, 10), bolt: new THREE.CylinderGeometry(2.4, 2.4, 1.6, 6),
    mflange: new THREE.CylinderGeometry(M + 1.6, M + 1.6, 0.9, 28), hub: new THREE.CylinderGeometry(M * 0.85, M * 0.85, 5, 24),
    screw: new THREE.CylinderGeometry(0.9, 0.9, 1.4, 8), shaft: new THREE.CylinderGeometry(1.25, 1.25, h + 7, 12)
  };
  for (const v of Object.values(lvPulleyParts)) LV_SHARED.add(v);
  return lvPulleyParts;
}
function lvIdler() {
  const P = lvPulleyKit(), h = LV_BELT_H, g = new THREE.Group(), add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
  add(P.idlerG, P.alu, 0); add(P.flange, P.alu, h / 2 + 0.45); add(P.flange, P.alu, -h / 2 - 0.45);   // Zahnkranz zwischen den Bordscheiben
  add(P.bearing, P.dark, h / 2 + 1.1);
  for (let k = 0; k < 3; k++) { const o = add(P.hole, P.alu, h / 2 + 1.2), a = k / 3 * Math.PI * 2; o.position.x = Math.cos(a) * LV_ROLL_R * 0.4; o.position.z = Math.sin(a) * LV_ROLL_R * 0.4; }
  add(P.axle, P.steelM, 1.5); add(P.bolt, P.steelM, h / 2 + 3.6);
  return g;
}
function lvMotorPulley() {
  const P = lvPulleyKit(), h = LV_BELT_H, g = new THREE.Group(), add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; g.add(o); return o; };
  add(P.gearG, P.alu, 0); add(P.mflange, P.alu, -h / 2 - 0.45);
  add(P.hub, P.alu, h / 2 + 2.5);
  const set = add(P.screw, P.dark, h / 2 + 2.5); set.rotation.z = Math.PI / 2; set.position.x = LV_MOTOR_R * 0.85;   // Madenschraube in der Nabe
  add(P.shaft, P.steelM, 0);
  return g;
}
/* Riemen: Linienzüge (2D, Höhe z), in Laufrichtung des Riemens hintereinander, beginnend an einer Klemme (Kopf bzw. Bett).
   Ein Zahn sitzt immer gleich weit (entlang des Riemens) von der Klemme – die Zahnlage ergibt sich so aus der Geometrie:
   fährt der Kopf, ändern sich die Längen der Abschnitte und die Zähne wandern richtig, ohne zu rutschen; die Rollen drehen
   sich um den Weg, der über sie gelaufen ist. */
function lvBelt(parent, z, paths) {
  const belt = { z, segs: [], rolls: [], paths, parent, box: new THREE.BoxGeometry(1, 1, 1) };
  for (const n of paths(0, 0)) for (let k = 1; k < n.length - 1; k++) { const r = lvIdler(); r.rotation.x = Math.PI / 2; parent.add(r); belt.rolls.push(r); }
  return belt;
}
// Riemenstück (Quader mit wandernden Zähnen); fehlende werden bei Bedarf angelegt, überzählige ausgeblendet
function lvBeltSeg(b, i) {
  if (!b.segs[i]) {
    const tex = lvBeltTexture().clone(); tex.needsUpdate = true;
    const mesh = new THREE.Mesh(b.box, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    b.parent.add(mesh); b.segs[i] = mesh;
  }
  return b.segs[i];
}
/* Riemen um die Rollen: Linienzüge (in Laufrichtung, ab der Klemme) → je Ecke eine Rolle, an der der Riemen tangential
   anliegt; zwischen den Berührpunkten folgt er dem Kreisbogen (Sehnen à ≤ 11,25°). Zwei Ecken mit kurzem Stück in dieselbe
   Richtung = Umkehr (Halbkreis, eine Rolle, Durchmesser = Strangabstand). Zwischen zwei Linienzügen (CoreXY: am Motor) läuft
   der Riemen im Bogen ums Ritzel (Radius joinR). Zahnlage = Riemenweg ab der Klemme. Ergebnis: Riemenweg am Motor. */
function lvBeltSet(b, px, py, joinR) {
  const paths = b.paths(px, py), R = LV_ROLL_R, P = [], kind = [];
  paths.forEach((n, pi) => n.forEach((q, k) => { if (pi && !k) return; P.push(q); kind.push(k === 0 && !pi ? 'end' : (k === n.length - 1 && pi < paths.length - 1 ? 'join' : (k === n.length - 1 ? 'end' : 'roll'))); }));
  const dir = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l, l]; };
  const corners = [];
  let ri = 0;
  for (let k = 1; k < P.length - 1; k++) {
    const a = dir(P[k - 1], P[k]), c = dir(P[k], P[k + 1]), turn = Math.sign(a[0] * c[1] - a[1] * c[0]) || 1;
    if (kind[k] === 'roll' && kind[k + 1] === 'roll' && k + 2 < P.length) {
      const e = dir(P[k + 1], P[k + 2]);
      if (c[2] < 2 * R * 1.6 + 6 && turn === (Math.sign(c[0] * e[1] - c[1] * e[0]) || 1)) {
        const half = c[2] / 2, nx = -c[1] * turn, ny = c[0] * turn;
        // Halbkreis: Mitte zwischen den Strängen, Berührpunkte auf beiden Strängen auf Höhe der Mitte
        corners.push({ cx: (P[k][0] + P[k + 1][0]) / 2 + nx * half, cy: (P[k][1] + P[k + 1][1]) / 2 + ny * half, r: half,
          tin: [P[k][0] + nx * half, P[k][1] + ny * half], tout: [P[k + 1][0] + nx * half, P[k + 1][1] + ny * half], sweep: Math.PI * turn, roll: ri, hide: ri + 1 });
        ri += 2; k++; continue;
      }
    }
    const r = kind[k] === 'join' ? (joinR || R) : R, phi = Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1]))), d = r * Math.tan(phi / 2);
    const bx = c[0] - a[0], by = c[1] - a[1], bl = Math.hypot(bx, by) || 1, off = r / Math.max(0.2, Math.cos(phi / 2));
    corners.push({ cx: P[k][0] + bx / bl * off, cy: P[k][1] + by / bl * off, r, tin: [P[k][0] - a[0] * d, P[k][1] - a[1] * d], tout: [P[k][0] + c[0] * d, P[k][1] + c[1] * d],
      sweep: phi * turn, roll: kind[k] === 'roll' ? ri++ : null });
  }
  let si = 0, mat = 0, motorAt = 0, cur = P[0];
  const line = (p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.max(0.01, Math.hypot(dx, dy)), mesh = lvBeltSeg(b, si++);
    mesh.visible = true; mesh.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, b.z); mesh.rotation.z = Math.atan2(dy, dx); mesh.scale.set(len + 0.4, LV_BELT_T, LV_BELT_H);
    const t = mesh.material.map; t.repeat.set(len / LV_BELT_PITCH, 1); t.offset.x = mat / LV_BELT_PITCH;
    mat += len;
  };
  for (const c of corners) {
    line(cur, c.tin);
    if (c.roll != null) { const r = b.rolls[c.roll]; r.visible = true; r.position.set(c.cx, c.cy, b.z); r.scale.set(c.r / R, 1, c.r / R); r.rotation.y = -mat / c.r; }
    if (c.hide != null) b.rolls[c.hide].visible = false;
    if (c.roll == null) motorAt = mat;
    // Bogen um die Rolle (Riemenmitte auf dem Umfang – wie die geraden Stücke, die die Rolle tangential berühren)
    const rr = c.r, a0 = Math.atan2(c.tin[1] - c.cy, c.tin[0] - c.cx), steps = Math.max(2, Math.ceil(Math.abs(c.sweep) / (Math.PI / 16)));
    let prev = [c.cx + Math.cos(a0) * rr, c.cy + Math.sin(a0) * rr];
    for (let s2 = 1; s2 <= steps; s2++) { const an = a0 + c.sweep * s2 / steps, q = [c.cx + Math.cos(an) * rr, c.cy + Math.sin(an) * rr]; line(prev, q); prev = q; }
    cur = c.tout;
  }
  line(cur, P[P.length - 1]);
  for (let k = si; k < b.segs.length; k++) b.segs[k].visible = false;
  return [motorAt];
}
/* Gehäuse für die festen Eckrollen (2026-10-08): Rollen, die bei zwei Kopfstellungen am selben Ort bleiben, liegen in den
   Ecken; nahe beieinander liegende (hinten die beiden am Motor) teilen sich eines. Je Gehäuse Boden- und Deckplatte über beide
   Riemenebenen und ein Pfosten an der äußeren Ecke – wie die Eckwagen schwarz und zur Mitte hin offen. */
function lvCornerHousings() {
  const pos = q => { const out = []; for (const { b, go } of lv.belts) { const [px, py] = go(q); lvBeltSet(b, px, py, LV_MOTOR_R); b.rolls.forEach(r => out.push(r.visible ? [r.position.x, r.position.y, r.scale.x * LV_ROLL_R] : null)); } return out; };
  const a = pos({ x: -60, y: -50, z: 0 }), b2 = pos({ x: 70, y: 60, z: 0 });
  const fixed = a.filter((p, i) => p && b2[i] && Math.hypot(p[0] - b2[i][0], p[1] - b2[i][1]) < 0.01);
  const clusters = [];
  for (const p of fixed) {
    const c = clusters.find(c => c.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 60));
    c ? c.push(p) : clusters.push([p]);
  }
  const black = new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.6 }), m = 4;
  const z0 = LV_BELT_Z.B - LV_BELT_H / 2 - 4, z1 = LV_BELT_Z.A + LV_BELT_H / 2 + 3;
  for (const c of clusters) {
    const x0 = Math.min(...c.map(p => p[0] - p[2])) - m, x1 = Math.max(...c.map(p => p[0] + p[2])) + m;
    const y0 = Math.min(...c.map(p => p[1] - p[2])) - m, y1 = Math.max(...c.map(p => p[1] + p[2])) + m, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const z of [z0, z1]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 3), black); pl.position.set(cx, cy, z); lv.gantry.add(pl); }
    // Pfosten an der äußeren Ecke (weg von der Mitte)
    const px = cx < 0 ? x0 + 4 : x1 - 4, py = cy < 0 ? y0 + 4 : y1 - 4;
    const post = new THREE.Mesh(new THREE.BoxGeometry(8, 8, z1 - z0), black); post.position.set(px, py, (z0 + z1) / 2); lv.gantry.add(post);
  }
}

function lvMechInit(md, g) {
  const { bx0, bx1, by0, by1, m, cx, beam } = g;
  lv.mechG = new THREE.Group(); lv.mechG.visible = false;
  lv.belts = [];
  if (md.kin === 'bed') {
    // X-Riemen hinter den Stangen der Traverse (Motor links), beide Enden am Kopf
    const xl = bx0 - m - 4 - cx, xr = bx1 + m - 6 - cx;   // Koordinaten der Traverse (beam.position.x = cx)
    lv.belts.push({ b: lvBelt(beam, 0, (px) => [[[px - 14, 12], [xl, 12], [xl, 18], [xr, 18], [xr, 12], [px + 14, 12]]]), go: p => [p.x - cx, 0] });
    // Y-Riemen unter dem Bett (im festen Rahmen, der relativ zum Bett in Y fährt): beide Enden am Bett (lokal y = −py)
    if (lv.frameFixed) {
      const yl = (by1 - by0) * 0.55, zb = -45 + 22;
      lv.belts.push({ b: lvBelt(lv.frameFixed, zb, (px, py) => [[[cx, -py - 6], [cx, -yl], [cx + 6, -yl], [cx + 6, yl], [cx, yl], [cx, -py + 6]]]), go: p => [0, p.y] });
    }
  } else {
    /* CoreXY: zwei Riemen übereinander. A (oben): rechter Motor → vorn rechts → Eckwagen rechts → Kopf; vom Kopf → Eckwagen links
       → hinten links → rechter Motor. B (unten) gespiegelt mit dem linken Motor. Linienzüge ab der Klemme am Kopf. */
    const { xLi, xLo, xRi, xRo, yb, yF, mL, mR } = lv.xy, M = LV_MOTOR_R;
    /* Eckpunkt am Motor so, dass die Ritzelmitte genau auf dem Motor liegt (Riemen läuft unten herum, Omega) */
    const motorCorner = (c, a, b) => {
      let q = c.slice();
      for (let it = 0; it < 3; it++) {
        const d1 = [q[0] - a[0], q[1] - a[1]], d2 = [b[0] - q[0], b[1] - q[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
        const u = [d1[0] / l1, d1[1] / l1], v = [d2[0] / l2, d2[1] / l2], bx = v[0] - u[0], by = v[1] - u[1], bl = Math.hypot(bx, by) || 1;
        const cosH = Math.sqrt(Math.max(0.04, (1 + u[0] * v[0] + u[1] * v[1]) / 2)), off = M / cosH;
        q = [c[0] - bx / bl * off, c[1] - by / bl * off];
      }
      return q;
    };
    // Riemen B (Motor links, unten): linke Klemme → Wagen links innen → vorn Umkehr → außen nach hinten → Omega um den Motor → hinten nach rechts → rechts innen zum Wagen → rechte Klemme
    const qL = motorCorner(mL, [xLo, yb], [xLo + 50, yb]), qR = motorCorner(mR, [xRo, yb], [xRo - 50, yb]);
    lv.belts.push({ b: lvBelt(lv.gantry, LV_BELT_Z.B, (px, py) => [[[px - 12, py - 9], [xLi, py - 9], [xLi, yF], [xLo, yF], [xLo, yb], qL], [qL, [xLo + 50, yb], [xRi, yb], [xRi, py - 9], [px + 12, py - 9]]]), go: p => [p.x, p.y + LV_BEAM_DY], motor: 0 });
    // Riemen A (Motor rechts, oben): gespiegelt
    lv.belts.push({ b: lvBelt(lv.gantry, LV_BELT_Z.A, (px, py) => [[[px + 12, py - 9], [xRi, py - 9], [xRi, yF], [xRo, yF], [xRo, yb], qR], [qR, [xRo - 50, yb], [xLi, yb], [xLi, py - 9], [px - 12, py - 9]]]), go: p => [p.x, p.y + LV_BEAM_DY], motor: 1 });
  }
  // Schleppkette: Glieder entlang einer Kurve vom Rahmen hinten oben zum Kopf
  const link = new THREE.BoxGeometry(9, 7, 13),   // lange Seite entlang z: lookAt richtet z auf die Kurve
     linkM = new THREE.MeshStandardMaterial({ color: 0x24292d, roughness: 0.65 });
  lv.chain = [];
  for (let k = 0; k < LV_CHAIN_LINKS; k++) { const l = new THREE.Mesh(link, linkM); lv.mechG.add(l); lv.chain.push(l); }
  lv.tubeM = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false });
  lv.filM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  lv.tube = null; lv.fil = null;
  // Kette: CoreXY vom Rahmen hinten links (großer Bogen über die linke Seite), Bettschubser vom oberen Querholm
  lv.mechAnchor = md.kin === 'bed' ? { x: cx, y: 0, z: md.size[2] + 70 + 14, fixed: true, xmin: bx0 - m }
    : { x: (lv.xy.mL[0] + lv.xy.mR[0]) / 2 - 40, y: lv.xy.fy1 - 30, z: LV_ROD_Z[1] + 30, fixed: false, xmin: lv.xy.fx0 + 25 };   // hinten zwischen den Motoren
  if (md.kin !== 'bed') { lvCornerHousings(); lvEnclosureInit(g); }
  lvFansInit(md, g);
}

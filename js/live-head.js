'use strict';
/* 3D-Fortschritt, Teil Druckkopf (aus js/live-ui.js): Kette, Schlauch und Filament nachführen (lvMechUpdate), Kopf
   platzieren, Kopfbewegung entlang der Bahnen (Zeit-Tabelle, Einrasten, Schleife lvHeadTick), Farben der Schichten,
   übersprungene Objekte, kommende Schichten. */

// Kurve der Kette: hinten oben → Bogen → senkrecht von oben auf den Kopf
// liegender Bogen (waagerecht, knapp über dem Kopf): vom Anker nach links, links herum nach vorn zum Kopf
function lvChainCurve(a, h, xmin) {
  const z = h.z, lx = Math.max(xmin ?? -Infinity, Math.min(a.x, h.x) - 80);
  return new THREE.CubicBezierCurve3(new THREE.Vector3(a.x, a.y, z), new THREE.Vector3(lx, a.y, z),
    new THREE.Vector3(lx, h.y, z), new THREE.Vector3(h.x, h.y, z));
}
/* Schlauch, Filament und Leuchtschein zum Kopf (drei TubeGeometry) nicht in jedem Bild neu bauen: höchstens 10×/s, solange der
   Kopf fährt (≥ 1 mm seit dem letzten Bau), sonst einmal nach, wenn er steht; bei Sprüngen und Umschaltern (force) sofort */
const LV_MECH_MS = 100, LV_MECH_MM = 1, LV_MECH_JUMP = 30;
const lvV = { q: new THREE.Vector3(), T: new THREE.Vector3(), up: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(), sd: new THREE.Vector3() };
function lvMechUpdate(p, force) {
  if (!lv.mechG) return;
  lv.mechG.visible = lv.head.visible;
  // Z-Spindeln drehen mit der Höhe (rotation.y = um die eigene Achse, wie die Rollen)
  for (const sc of lv.zScrews || []) sc.rotation.y = -(p.z / LV_SCREW_LEAD) * Math.PI * 2;
  lvZDriveSet(lv.zDrive, p.z);   // Z-Riemen unten läuft mit
  lvFanTick();
  if (!lv.head.visible) return;
  for (const { b, go, motor } of lv.belts) {
    const [px, py] = go(p), ends = lvBeltSet(b, px, py, motor != null ? LV_MOTOR_R : 0);
    // Motorscheibe dreht um den Riemenweg, der bis zu ihr gelaufen ist (CoreXY: ergibt x + y bzw. x − y)
    if (motor != null && lv.motorCaps[motor]) lv.motorCaps[motor].rotation.y = -ends[0] / LV_MOTOR_R;
  }
  // Anker in Weltkoordinaten: CoreXY am Rahmen (fährt in Z mit der Traverse), Bettschubser am oberen Querholm (fährt in Y)
  const A = lv.mechAnchor, a = A.fixed ? { x: A.x, y: A.y + p.y, z: A.z } : { x: A.x, y: A.y, z: p.z + LV_GANTRY_Z + A.z };
  const top = { x: p.x, y: p.y + 4, z: p.z + LV_HEAD.h + 14 }, c = lvChainCurve(a, top, A.xmin), q = lvV.q;
  lv.chain.forEach((l, k) => {
    const t = (k + 0.5) / LV_CHAIN_LINKS; c.getPoint(t, l.position); c.getTangent(t, q);
    l.lookAt(l.position.x + q.x, l.position.y + q.y, l.position.z + q.z);
  });
  /* Schlauch hängt außen (im Bogen links) an der Kette – fester seitlicher Abstand, Seite bleibt über den ganzen Bogen gleich,
     kann sie nicht kreuzen; am Kopf taucht er von oben hinein, das Filament läuft weiter senkrecht bis zur Düsenspitze */
  const now = performance.now(), B = lv.mechBuilt, key = lvAceFlowing() + '|' + !!(lv.aceG && lv.aceG.visible);
  const dist = B ? Math.hypot(p.x - B.x, p.y - B.y, p.z - B.z) : Infinity;
  if (!force && B && B.key === key && dist < LV_MECH_JUMP && (dist < 0.01 || now - B.t < (dist < LV_MECH_MM ? 3 : 1) * LV_MECH_MS)) {
    // kommt keine weitere Bewegung (Schleife steht), den letzten Stand trotzdem nachziehen
    if (dist >= 0.01 && !lv.mechLate) lv.mechLate = setTimeout(() => { lv.mechLate = 0; if (lv.head && lv.head.visible) { lvMechUpdate(lv.head.position, true); lvRender(); } }, 3 * LV_MECH_MS);
    return;
  }
  lv.mechBuilt = { x: p.x, y: p.y, z: p.z, t: now, key };
  const pts = [], { T, up, side, sd } = lvV; side.set(0, 1, 0);
  for (let k = 0; k <= 36; k++) {
    const t = k / 36 * 0.92, P = c.getPoint(t); c.getTangent(t, T);
    sd.crossVectors(T, up);
    if (sd.lengthSq() > 1e-4) { sd.normalize(); if (sd.dot(side) < 0) sd.negate(); side.copy(sd); }
    pts.push(P.addScaledVector(side, 9));
  }
  if (lv.hubTop && lv.aceG && lv.aceG.visible && !A.fixed) {
    /* mit ACE: Schlauch beginnt oben an der Zusammenführung, steigt senkrecht, biegt im 90°-Bogen nach vorn, geht waagerecht durch die
       Rückwand und trifft die Kette dort, wo sie hinten an der Zusammenführung vorbeiläuft (der Teil der Kette davor bleibt ohne Schlauch) */
    const H = lv.hubTop, gz = lv.gantry.position.z, zc = pts[0].z, R = 25;
    const yc = H.y - R, z0c = zc - R, arc = [new THREE.Vector3(H.x, H.y, H.z + gz)];
    for (let k = 0; k <= 6; k++) { const t = k / 6 * Math.PI / 2; arc.push(new THREE.Vector3(H.x, yc + Math.cos(t) * R, z0c + Math.sin(t) * R)); }
    if (H.x - 12 > pts[0].x) {   // Zusammenführung rechts vom Kettenanfang (von vorn): waagerecht im Bogen nach links in den Anfang der Kette
      const R2 = Math.max(8, yc - pts[0].y);
      for (let k = 1; k <= 5; k++) { const t = k / 5 * Math.PI / 2; arc.push(new THREE.Vector3(H.x - R2 + Math.cos(t) * R2, yc - Math.sin(t) * R2, zc)); }
      if (H.x - R2 - 20 > pts[0].x) arc.push(new THREE.Vector3((H.x - R2 + pts[0].x) / 2, pts[0].y, zc));
    } else {                     // links davon: trifft die Kette dort, wo sie hinten vorbeiläuft
      while (pts.length > 2 && pts[0].x > H.x - 12) pts.shift();
      arc.push(new THREE.Vector3(H.x - 4, (yc + pts[0].y) / 2, zc));
    }
    pts.unshift(...arc);
  }
  const inHead = new THREE.Vector3(p.x, p.y, p.z + LV_HEAD.h - 8);
  pts.push(new THREE.Vector3(p.x, p.y, p.z + LV_HEAD.h + 8), inHead);
  const ct = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const cf = new THREE.CurvePath(); cf.add(ct); cf.add(new THREE.LineCurve3(inHead.clone(), new THREE.Vector3(p.x, p.y, p.z + 1)));
  for (const k of ['tube', 'fil']) if (lv[k]) { lv.mechG.remove(lv[k]); lv[k].geometry.dispose(); }
  lv.tube = new THREE.Mesh(new THREE.TubeGeometry(ct, 60, 2.4, 10), lv.tubeM);
  lv.fil = new THREE.Mesh(new THREE.TubeGeometry(cf, 80, 0.9, 6), lv.filM);
  lv.tube.renderOrder = 3;
  lv.mechG.add(lv.fil, lv.tube);
  // fließendes Filament bis in den Kopf (wie in den ACE-Schläuchen, lvAceAnimate), nur solange ein Slot aktiv druckt
  if (lv.filGlow) { lv.mechG.remove(lv.filGlow); lv.filGlow.geometry.dispose(); lv.filGlow = null; }
  if (lvAceFlowing()) {
    if (!lv.filFlow) { lv.filFlow = lvFlowMat(300); lv.filGlowM = lvGlowMat(lv.filFlow); for (const v of [lv.filFlow, lv.filGlowM, lv.filFlow.emissiveMap]) LV_SHARED.add(v); }
    lv.filFlow.emissiveMap.repeat.x = Math.max(1, cf.getLength() / LV_FLOW_MM);
    lv.filGlowM.color.copy(lv.filM.color).lerp(new THREE.Color(0xffffff), 0.3);
    lv.filGlow = new THREE.Mesh(new THREE.TubeGeometry(cf, 80, 2.0, 8), lv.filGlowM); lv.filGlow.renderOrder = 4; lv.mechG.add(lv.filGlow);
  }
}
function lvAceFlowing() { return !!(lv.aceSpools && lv.aceG && lv.aceG.visible && lv.aceSpools.some(sp => sp.active)); }
/* Farbe eines Werkzeugs im laufenden Druck: die des ACE-Slots, aus dem es wirklich gedruckt wird (Zuordnung vom Start,
   api/printing/slots; ohne: Werkzeug n = Slot n) – nicht die Slot-Einstellung im Konfigurator (falsche Farbe, 2026-10-25) */
function lvToolColour(k) {
  const st = typeof wb !== 'undefined' && wb.st, slots = st && st.ace && st.ace.length ? aceSlots(st) : [];
  const m = lv.toolSlot || {}, s = slots[m[k] != null ? m[k] : k];
  return s && s.present && s.colour ? safeColour(s.colour, toolColour(k)) : toolColour(k);
}
// Filamentfarbe im Schlauch: Werkzeug der gerade gedruckten Bahn
function lvFilamentAt(seg) {
  if (!lv.filM || seg == null || !lv.data || !lv.data.a) return;
  const k = lv.data.a[2 * seg + 1];
  if (k === lv.filTool) return;
  lv.filTool = k;
  const c = lvToolColour(k);
  if (c) lv.filM.color.set(c);
}
// Kopf und Mechanik an die Stelle p (Düsenspitze)
function lvPlaceHead(p) {
  lv.head.position.set(p.x, p.y, p.z);
  lv.gantry.visible = lv.head.visible;
  lv.gantry.position.z = p.z + LV_GANTRY_Z;
  // CoreXY: Traverse fährt in Y; Bettschubser: der ganze Aufbau steht relativ zum Kopf, das Bett (mit dem Teil) fährt
  if (lv.kin === 'bed') { lv.gantry.position.y = p.y; lv.gantry.userData.beam.position.y = 0; if (lv.frameFixed) { lv.frameFixed.position.y = p.y; lv.frameFixed.visible = lv.head.visible; } }
  else { lv.gantry.position.y = 0; lv.gantry.userData.beam.position.y = p.y + LV_BEAM_DY; }
  lvMechUpdate(p);
  lvTryFit();
}
// Sehr dunkle Filamentfarben (schwarz, anthrazit) für die Ansicht aufhellen – sonst verschwinden sie auf dem dunklen Grund
function lvVisible(rgb) {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], min = 0.28;
  if (l >= min) return rgb;
  const k = (min - l) / (1 - l);
  return rgb.map(c => c + (1 - c) * k);
}

/* ---------- Druckkopf ----------
   Der Kopf fährt die Bahnen der Schicht entlang, gemessen in Druckzeit t (s ab Schichtbeginn): je Bahn Länge durch
   Vorschub – aus dem G-Code (Vorschau GCPV3) oder, bei älteren Vorschauen, aus den Druckereinstellungen je Linienart
   (lvSpeeds) – plus Beschleunigen/Bremsen (Trapez mit der Druckbeschleunigung). Leerfahrten zählen mit der
   Fahrgeschwindigkeit und werden sichtbar abgefahren – kein Sprung zwischen Teilen.
   - Echte Position (Schalter an, Meldung < 10 s alt): Schicht aus der gemeldeten Höhe, Stelle = nächste Bahn (≤ 8 mm,
     zuerst in der Nähe der erwarteten Stelle); die Meldung ist position_age_s alt – so weit wird vorgerechnet. Zwischen
     zwei Meldungen läuft die Druckzeit mit dem gemessenen Verhältnis zur Uhr (rate, ≈ 1) weiter, Abweichungen gleichen
     sich über LV_BLEND_MS aus. Weit weg von jeder Bahn (Parken, Reinigen): gleitet er gerade zur gemeldeten Stelle.
   - Geschätzt: Anteil der erwarteten Schichtzeit (Restzeit / restliche Schichten) → Stelle in der Schicht.
   Zuletzt glättet ein Filter die gezeigte Stelle (Zeitkonstante LV_SMOOTH_S) – Restsprünge werden zu kurzem Gleiten.
   Ansichtskoordinaten: G-Code minus Mitte (lv.cx/cy). Die Schleife läuft nur, solange der Kopf sichtbar ist. */
const LV_SNAP_MM = 8, LV_BLEND_MS = 1500, LV_SMOOTH_S = 0.2, LV_MAX_CORR_S = 4, LV_NEAR_S = 6;

/* Geschwindigkeiten (mm/s) und Beschleunigungen (mm/s²) je Linienart aus den Druckereinstellungen (Orca-Vorlage des
   Druckers) – Geschwindigkeit nur für Vorschauen ohne Vorschub je Bahn, Beschleunigung immer (steht nicht in der Vorschau).
   Prozent bei Geschwindigkeiten: von der Innenwand; bei Beschleunigungen: von der Standardbeschleunigung (Brücke: von der
   Außenwand, wie Orca). */
const LV_TYPE_SPEED = { 'Outer wall': 'outer_wall_speed', 'Inner wall': 'inner_wall_speed', 'Overhang wall': 'overhang_2_4_speed',
  'Sparse infill': 'sparse_infill_speed', 'Internal solid infill': 'internal_solid_infill_speed', 'Solid infill': 'internal_solid_infill_speed',
  'Top surface': 'top_surface_speed', 'Bottom surface': 'initial_layer_speed', 'Bridge': 'bridge_speed', 'Internal Bridge': 'bridge_speed',
  'Gap infill': 'gap_infill_speed', 'Support': 'support_speed', 'Support interface': 'support_interface_speed',
  'Support transition': 'support_speed', 'Prime tower': 'inner_wall_speed', 'Brim': 'skirt_speed', 'Skirt': 'skirt_speed',
  'Ironing': 'ironing_speed' };
const LV_TYPE_ACCEL = { 'Outer wall': 'outer_wall_acceleration', 'Inner wall': 'inner_wall_acceleration', 'Overhang wall': 'outer_wall_acceleration',
  'Sparse infill': 'sparse_infill_acceleration', 'Internal solid infill': 'internal_solid_infill_acceleration',
  'Solid infill': 'internal_solid_infill_acceleration', 'Top surface': 'top_surface_acceleration', 'Bridge': 'bridge_acceleration',
  'Internal Bridge': 'bridge_acceleration' };
function lvSpeeds() {
  if (lv.speeds) return lv.speeds;
  const tpl = typeof exportTemplate === 'function' ? exportTemplate(WB_PRINTER, '0.4') : null, st = (tpl && tpl.settings) || {};
  const raw = k => { const v = st[k]; return Array.isArray(v) ? v[0] : v; };
  const num = (k, def, base) => { const v = String(raw(k) ?? ''), f = parseFloat(v); return !(f > 0) ? def : /%$/.test(v) ? base * f / 100 : f; };
  const inner = num('inner_wall_speed', 150), acc = num('default_acceleration', 5000), outerAcc = num('outer_wall_acceleration', acc, acc);
  const types = {}, accels = {};
  for (const [ty, key] of Object.entries(LV_TYPE_SPEED)) types[ty] = num(key, inner, inner);
  for (const [ty, key] of Object.entries(LV_TYPE_ACCEL)) accels[ty] = num(key, acc, /Bridge/.test(ty) ? outerAcc : acc);
  const travelAcc = num('travel_acceleration', acc, acc);
  // Rückzug + Z-Hop je Leerfahrt (hin und zurück), nur ab der Mindeststrecke
  const retr = num('retraction_length', 0.8, 1), rs = num('retraction_speed', 40, 1), hop = num('z_hop', 0.4, 1), zs = num('machine_max_speed_z', 15, 1);
  return (lv.speeds = { types, accels, other: inner, accel: acc, first: num('initial_layer_speed', 50, inner),
    firstAccel: num('initial_layer_acceleration', 500, acc), travel: num('travel_speed', 300, inner), travelAcc,
    scv: num('machine_max_jerk_x', 5, 1), travelExtra: 2 * retr / rs + 2 * hop / zs, minTravel: num('retraction_minimum_travel', 1, 1) });
}
// Zeit für eine Strecke L mit Anfangs-/Endgeschwindigkeit v0/v1, Höchstgeschwindigkeit vm und Beschleunigung acc (Trapez)
function lvMoveTime(L, v0, v1, vm, acc) {
  if (!(L > 0)) return 0;
  const da = (vm * vm - v0 * v0) / (2 * acc), dd = (vm * vm - v1 * v1) / (2 * acc);
  if (da + dd <= L) return (vm - v0) / acc + (vm - v1) / acc + (L - da - dd) / vm;
  const vp = Math.sqrt(Math.max(v0 * v0, v1 * v1, (2 * acc * L + v0 * v0 + v1 * v1) / 2));
  return Math.max(0, (vp - v0) / acc) + Math.max(0, (vp - v1) / acc);
}
/* Zeit-Tabelle einer Schicht (zwischengespeichert): a[k]/b[k] = Druckzeit bei Anfang/Ende von Bahn start+k, dazwischen die
   Leerfahrt. Vereinfachter Bewegungsplaner wie Klipper: Kurvengeschwindigkeit aus dem Winkel (square_corner_velocity ≈
   Ruck-Einstellung), Vor- und Rückschau für die Rampen, Beschleunigung je Linienart. */
function lvTrack(li) {
  if (lv.track && lv.track.li === li) return lv.track;
  const d = lv.data, start = d.layers[li][1], end = li + 1 < d.layers.length ? d.layers[li + 1][1] : d.count, P = lv.pos, n = end - start;
  const sp = lvSpeeds(), unit = d.speed_unit || 2, first = li === 0, travel = d.travel > 0 ? d.travel : sp.travel;
  // Bewegungen: [Länge, Höchstgeschw., Beschl., dx, dy, Bahn k oder −1 = Fahrt]
  const M = [], skip = lv.skip;
  let prev = -1;    // letzte gedruckte Bahn (übersprungene Objekte zählen nicht – der Drucker fährt direkt weiter)
  for (let k = 0; k < n; k++) {
    const i = start + k, o = i * 6;
    if (skip && skip[i]) continue;
    if (prev >= 0) { const q = prev * 6, dx = P[o] - P[q + 3], dy = P[o + 1] - P[q + 4], L = Math.hypot(dx, dy);
      if (L > 1e-3) M.push([L, travel, first ? Math.min(sp.firstAccel * 2, sp.travelAcc) : sp.travelAcc, dx / L, dy / L, -1]); }
    prev = i;
    const dx = P[o + 3] - P[o], dy = P[o + 4] - P[o + 1], L = Math.hypot(dx, dy), ty = d.types[d.a[2 * i]];
    const v = d.v && d.v[i] ? d.v[i] * unit : first ? sp.first : (sp.types[ty] || sp.other);
    M.push([L, v, first ? sp.firstAccel : (sp.accels[ty] || sp.accel), L ? dx / L : 1, L ? dy / L : 0, k]);
  }
  // Kurvengeschwindigkeit zwischen zwei Bewegungen (Klipper: junction deviation aus square_corner_velocity)
  const m = M.length, vj = new Float64Array(m + 1);   // vj[i] = Geschwindigkeit am Anfang von Bewegung i
  for (let i = 1; i < m; i++) {
    const A = M[i - 1], B = M[i], acc = Math.min(A[2], B[2]), jd = sp.scv * sp.scv * (Math.SQRT2 - 1) / acc;
    const cos = -(A[3] * B[3] + A[4] * B[4]);
    let v;
    if (cos > 0.999999) v = 0; else if (cos < -0.999999) v = Infinity;
    else { const sh = Math.sqrt(0.5 * (1 - cos)); v = Math.sqrt(acc * jd * sh / (1 - sh)); }
    // Rückzug/Z-Hop vor und nach einer längeren Fahrt: dort steht der Kopf kurz
    if ((A[5] < 0 && A[0] >= sp.minTravel) || (B[5] < 0 && B[0] >= sp.minTravel)) v = 0;
    vj[i] = Math.min(v, A[1], B[1]);
  }
  // Rückschau: rechtzeitig bremsen; Vorschau: nur so schnell, wie beschleunigt werden kann
  for (let i = m - 1; i >= 1; i--) vj[i] = Math.min(vj[i], Math.sqrt(vj[i + 1] * vj[i + 1] + 2 * M[i][2] * M[i][0]));
  for (let i = 1; i <= m; i++) vj[i] = Math.min(vj[i], Math.sqrt(vj[i - 1] * vj[i - 1] + 2 * M[i - 1][2] * M[i - 1][0]));
  const a = new Float64Array(n), b = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < m; i++) {
    const [L, vm, acc, , , k] = M[i];
    if (k < 0 && L >= sp.minTravel) t += sp.travelExtra;
    if (k >= 0) a[k] = t;
    t += lvMoveTime(L, vj[i], vj[i + 1], vm, acc);
    if (k >= 0) b[k] = t;
  }
  // übersprungene Bahnen: ohne eigene Zeit (Beginn = Ende = Zeitpunkt der nächsten gedruckten Bahn)
  if (skip) for (let k = n - 1, next = t; k >= 0; k--) { if (skip[start + k]) { a[k] = b[k] = next; } else next = a[k]; }
  return (lv.track = { li, start, end, a, b, len: t });
}
function lvPointAt(tr, s) {
  const n = tr.end - tr.start, P = lv.pos;
  if (!n) return null;
  s = Math.max(0, Math.min(tr.len, s));
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.a[m] <= s) lo = m; else hi = m - 1; }
  const o = (tr.start + lo) * 6;
  if (s <= tr.b[lo]) {                      // auf der Bahn
    const seg = tr.b[lo] - tr.a[lo], k = seg > 0 ? (s - tr.a[lo]) / seg : 0;
    return { x: P[o] + (P[o + 3] - P[o]) * k, y: P[o + 1] + (P[o + 4] - P[o + 1]) * k, z: P[o + 5], seg: tr.start + lo };
  }
  // Leerfahrt zur nächsten Bahn
  const q = o + 6, gap = lo + 1 < n ? tr.a[lo + 1] - tr.b[lo] : 0, k = gap > 0 ? (s - tr.b[lo]) / gap : 1;
  if (lo + 1 >= n) return { x: P[o + 3], y: P[o + 4], z: P[o + 5], seg: tr.start + lo + 1 };
  return { x: P[o + 3] + (P[q] - P[o + 3]) * k, y: P[o + 4] + (P[q + 1] - P[o + 4]) * k, z: P[o + 5], seg: tr.start + lo + 1 };
}
// nächste Stelle auf einer Bahn der Schicht → {s (Druckzeit), dist}. near = erwartete Druckzeit: dann zuerst ±LV_NEAR_S davon
// suchen – bei dichter Füllung liegen Nachbarlinien 0,4 mm auseinander, da wäre die nächste Linie oft die falsche
function lvSegAt(tr, s) { let lo = 0, hi = tr.end - tr.start - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.a[m] <= s) lo = m; else hi = m - 1; } return lo; }
function lvSnap(tr, x, y, near) {
  if (near != null) {
    const r = lvSnapRange(tr, x, y, tr.start + lvSegAt(tr, near - LV_NEAR_S), tr.start + lvSegAt(tr, near + LV_NEAR_S) + 1);
    if (r.dist <= LV_SNAP_MM) return r;
  }
  return lvSnapRange(tr, x, y, tr.start, tr.end);
}
function lvSnapRange(tr, x, y, from, to) {
  const P = lv.pos; let best = Infinity, bs = 0;
  for (let i = from; i < to; i++) {
    const o = i * 6, ax = P[o], ay = P[o + 1], dx = P[o + 3] - ax, dy = P[o + 4] - ay, l2 = dx * dx + dy * dy;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const qx = ax + dx * k - x, qy = ay + dy * k - y, d2 = qx * qx + qy * qy;
    if (d2 < best) { best = d2; bs = tr.a[i - tr.start] + k * (tr.b[i - tr.start] - tr.a[i - tr.start]); }
  }
  return { s: bs, dist: Math.sqrt(best) };
}
// Schicht zur gemeldeten Höhe: die höchste Schicht, die nicht über der Düse liegt (Z-Hop hebt die Düse kurz an)
function lvLayerByZ(z) {
  const L = lv.data.layers; let lo = 0, hi = L.length - 1;
  if (z < L[0][0] - 0.05) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m][0] <= z + 0.05) lo = m; else hi = m - 1; }
  return lo;
}

/* Neuer Stand vom Drucker → Zustand der Kopfbewegung (lv.hs). Rückgabe {real, snapped, li, frac} für Anzeige und Farben. */
function lvHeadSet(st, cur, L, T) {
  const p = st.position, age = st.position_age_s, now = performance.now(), h = lv.hs;
  const real = p && age != null && age < LV_POS_FRESH_S && Number.isFinite(+p.x);
  if (real) {
    /* Schicht aus der Kopfhöhe nur, wenn wirklich gedruckt wird (ab Schicht 1) und die Höhe zum Modell passt – beim Bett
       vermessen/Aufheizen steht der Kopf mitten über dem Bett (S1: Z ≈ 380 mm); das rastete auf der obersten Schicht
       ein, der 3D-Fortschritt zeigte das Modell fertig (2026-10-03). Sonst: Schicht laut Drucker, Kopf trotzdem echt. */
    const x = +p.x - lv.cx, y = +p.y - lv.cy, z = +p.z, key = x + ',' + y + ',' + z;
    const topZ = lv.data.layers[lv.data.layers.length - 1][0], plausible = L >= 1 && z <= topZ + 2;
    const li = plausible ? lvLayerByZ(z) : cur;
    if (h && h.real && h.key === key) return h.info;              // nichts Neues – weiterfahren wie bisher
    const t0 = now - Math.min(8, Math.max(0, +age || 0)) * 1000;   // Zeitpunkt der Messung
    const tr = plausible && li >= 0 ? lvTrack(li) : null, same = h && h.snapped && h.li === li;
    const sn = tr && tr.len > 0 ? lvSnap(tr, x, y, same ? h.s0 + h.v * Math.min(10, (t0 - h.t0) / 1000) : null) : null;
    let hs;
    if (sn && sn.dist <= LV_SNAP_MM) {
      // Verhältnis Druckzeit zu Uhrzeit aus zwei Meldungen auf derselben Schicht (geglättet; ≈ 1, wenn die Zeiten passen)
      let v = h && h.v || 1;
      if (same && sn.s > h.s0 && t0 - h.t0 > 1500) { const vm = (sn.s - h.s0) / ((t0 - h.t0) / 1000); v = Math.max(0.3, Math.min(2.5, 0.7 * v + 0.3 * vm)); }
      // wo der Kopf gerade gezeigt wird → Abweichung weich ausgleichen statt springen
      let corr = 0;
      const shownS = same ? lvHeadS(h, now) : lv.disp && h && h.li === li ? (at => at.dist <= LV_SNAP_MM ? at.s : null)(lvSnap(tr, lv.disp.x, lv.disp.y, sn.s)) : null;
      if (shownS != null) corr = shownS - (sn.s + v * (now - t0) / 1000);
      hs = { real: true, snapped: true, li, s0: sn.s, t0, tc: now, v, corr: Math.max(-LV_MAX_CORR_S, Math.min(LV_MAX_CORR_S, corr)), key };
      hs.info = { real: true, snapped: true, li, frac: tr.len ? sn.s / tr.len : 0 };
    } else {
      hs = { real: true, snapped: false, from: lv.disp || { x, y, z }, to: { x, y, z }, t0: now, dur: h && h.real ? Math.min(6000, Math.max(800, now - (h.tc || h.t0))) : 1, tc: now, key, v: h && h.v, li };
      hs.info = { real: true, snapped: false, li };
    }
    lv.hs = hs;
  } else {
    if (!(L > 0)) { lv.hs = null; lv.disp = null; if (lv.head) { lv.head.visible = false; lv.gantry.visible = false; if (lv.frameFixed) lv.frameFixed.visible = false; if (lv.mechG) lv.mechG.visible = false; } lvRender(); return null; }
    if (cur !== lv.layerAt) { lv.layerAt = cur; lv.layerSince = Date.now(); }
    const rest = +(st.job && st.job.remaining_min) || 0, left = Math.max(1, (T || lv.data.layers.length) - L + 1);
    lv.hs = { real: false, li: cur, dur: rest > 0 ? rest * 60 / left : 60, info: { real: false, li: cur } };
  }
  lv.head.visible = true;
  if (!lv.anim) lv.anim = requestAnimationFrame(lvHeadTick);
  return lv.hs.info;
}
// Druckzeit in der Schicht jetzt (echt, auf der Bahn): Messung + rate × Zeit seit der Messung, Abweichung blendet aus
function lvHeadS(h, now) {
  const dt = Math.min(10, (now - h.t0) / 1000), k = Math.min(1, (now - h.tc) / LV_BLEND_MS), e = k * k * (3 - 2 * k);
  return h.s0 + h.v * dt + h.corr * (1 - e);
}
function lvHeadPos(h, now) {
  if (!h.real) {
    const tr = lvTrack(h.li), frac = Math.min(1, (Date.now() - lv.layerSince) / 1000 / h.dur);
    return lvPointAt(tr, frac * tr.len);
  }
  if (h.snapped) return lvPointAt(lvTrack(h.li), lvHeadS(h, now));
  const k = Math.min(1, (now - h.t0) / h.dur), e = k * k * (3 - 2 * k);   // weich an- und auslaufen
  return { x: h.from.x + (h.to.x - h.from.x) * e, y: h.from.y + (h.to.y - h.from.y) * e, z: h.from.z + (h.to.z - h.from.z) * e };
}
function lvHeadTick(now) {
  lv.anim = 0;
  const h = lv.hs;
  if (!h || !lv.head || !lv.head.visible || !lvOnScreen()) { lv.lastTick = 0; return; }
  if (lv.lastTick && now - lv.lastTick < 30) { lv.anim = requestAnimationFrame(lvHeadTick); return; }   // ~30 Bilder/s wie lvAceAnimate
  const p = lvHeadPos(h, now);
  if (p) {
    // Glätten: gezeigte Stelle folgt dem Ziel mit kurzer Verzögerung; sehr weite Wege (Schichtwechsel, Start) direkt
    const dt = lv.lastTick ? Math.min(0.1, (now - lv.lastTick) / 1000) : 1, d = lv.disp;
    if (!d || Math.hypot(p.x - d.x, p.y - d.y) > 120) lv.disp = { x: p.x, y: p.y, z: p.z };
    else { const a = 1 - Math.exp(-dt / LV_SMOOTH_S); d.x += (p.x - d.x) * a; d.y += (p.y - d.y) * a; d.z += (p.z - d.z) * a; }
    lvPlaceHead(lv.disp);
    if (p.seg != null && h.li === lv.shown) lvColourTo(p.seg);
    lvFilamentAt(p.seg);   // abgefahrene Bahnen orange (die aktuelle erst danach)
    lvDraw();
  }
  lv.lastTick = now;
  if (h.snapped || !h.real || now - h.t0 < h.dur + 1000) lv.anim = requestAnimationFrame(lvHeadTick);
}

// Bis Schicht cur (0-basiert): fertig = Filamentfarbe, aktuell = orange; danach die kommenden Schichten je nach Wahl
/* Farben bis Schicht cur: frühere Schichten in Filamentfarbe. Aktuelle Schicht ohne Kopfposition (done = null) ganz orange;
   mit Kopf: was er schon abgefahren hat orange („gerade gedruckt“), der Rest der Schicht blass – so sieht man das Einfärben
   auch bei dunklem Filament. Danach die kommenden Schichten je nach Wahl (lvGhostApply). */
const LV_PENDING = [0.42, 0.44, 0.48];
/* Übersprungene Objekte (js/skip-ui.js): Bahnen ab der Schicht des Überspringens, deren Mitte im Umriss des Objekts
   liegt, dunkel; der Kopf lässt sie aus (lvTrack) und fährt wie der Drucker gleich zum nächsten Objekt. */
const LV_SKIP = [0.32, 0.2, 0.2];
function lvSkipSet(objs) {
  // objs: [{polygon: [[x,y]…], from: Schicht der Vorschau}] – gleiche Eingabe → nichts tun
  const key = JSON.stringify(objs.map(o => [o.from, o.polygon.length, o.polygon[0]]));
  if (!lv.data || key === lv.skipKey) return;
  lv.skipKey = key;
  const d = lv.data, n = d.count, P = lv.pos, mask = objs.length ? new Uint8Array(n) : null;
  const inside = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  for (const o of objs) {
    const poly = o.polygon.map(([x, y]) => [x - lv.cx, y - lv.cy]), xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const from = d.layers[Math.max(0, Math.min(d.layers.length - 1, o.from))][1];
    for (let i = from; i < n; i++) {
      const q = i * 6, mx = (P[q] + P[q + 3]) / 2, my = (P[q + 1] + P[q + 4]) / 2;
      if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1 && inside(mx, my, poly)) mask[i] = 1;
    }
  }
  lv.skip = mask; lv.track = null;
  if (lv.shown >= 0) lvColour(lv.shown, lv.shownDone);
}
// gerade gedruckt: in der Filamentfarbe der Bahn (2026-10-08, vorher Petrol) – noch nicht gedruckt: blass
function lvFilRgb(i) {
  const k = lv.data.a[2 * i + 1], c = lv.filRgb || (lv.filRgb = {});
  return c[k] || (c[k] = lvVisible(hexToRgb01(lvToolColour(k))));
}
function lvCurColour(i, split, withHead) { return lv.skip && lv.skip[i] ? LV_SKIP : !withHead || i < split ? lvFilRgb(i) : LV_PENDING; }
function lvColour(cur, done) {
  const d = lv.data, cache = {};
  const start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count, withHead = done != null;
  for (let i = 0; i < end; i++) {
    let c;
    if (i < start) { const k = d.a[2 * i + 1]; c = lv.skip && lv.skip[i] ? LV_SKIP : cache[k] || (cache[k] = lvVisible(hexToRgb01(lvToolColour(k)))); }
    else c = lvCurColour(i, done, withHead);
    lvPaint(i, c);
  }
  lvColourDirty(0, end);
  lvRange(end);
  lvGhostApply();
  lv.shown = cur; lv.shownDone = done;
}
/* Während der Kopf fährt: abgefahrene Bahnen der aktuellen Schicht orange; läuft er zurück (Korrektur nach einer Meldung),
   wieder blass. Nur der geänderte Bereich wird neu übertragen. */
function lvColourTo(split) {
  if (lv.shownDone == null) return;          // aktuelle Schicht ohne Kopf gezeichnet (ganz orange)
  const d = lv.data, cur = lv.shown, start = d.layers[cur][1], end = cur + 1 < d.layers.length ? d.layers[cur + 1][1] : d.count;
  split = Math.max(start, Math.min(end, split));
  const was = lv.shownDone;
  if (split === was) return;
  const [a, b] = split > was ? [was, split] : [split, was];
  for (let i = a; i < b; i++) lvPaint(i, lvCurColour(i, split, true));
  lvColourDirty(a, b);
  lv.shownDone = split;
}
function lvGhostApply() {
  if (!lv.ghost) return;
  const m = lvGhostMode(), mat = lv.ghost.material;
  lv.ghost.visible = m !== 'off';
  mat.opacity = LV_GHOST[m]; mat.transparent = m !== 'full'; mat.depthWrite = m === 'full';
  mat.color.setHex(m === 'full' ? 0x3b3d45 : 0x9aa0a8); mat.needsUpdate = true;
  lvRender();
}

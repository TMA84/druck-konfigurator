'use strict';
/* 3D-Fortschritt, Teil Effekte (aus js/live-ui.js): Display am Drucker, Farbwechsel-Animation, Hitze, Gehäuselicht und
   Statusrahmen (lvFx), Lüfter mit Luftstrom. */

// Display am Drucker: Fortschritt in % mit Balken, Schicht und Restzeit; ohne Auftrag „Bereit“ (zeichnet nur bei Änderung neu)
function lvDisplay(st) {
  const D = lv.display; if (!D) return;
  const job = st && st.job, pct = job ? Math.max(0, Math.min(100, Math.round(+job.progress || 0))) : null;
  const own = job && typeof lvRemaining === 'function' && !job.paused ? lvRemaining(st) : null, rem = own ? Math.round(own.s / 60) : job && job.remaining_min;
  const fin = !job && lv.fx && lv.fx.endAt && Date.now() - lv.fx.endAt < LV_END_MS ? lv.fx.end : null;   // gerade fertig/abgebrochen (lvFx)
  const line1 = job ? (job.paused ? t('Pausiert') : t('Druckt')) : fin ? (fin === 'ok' ? t('Fertig') + ' ✓' : t('Abgebrochen')) : st && st.connected === false ? t('Nicht verbunden') : t('Bereit');
  const why = job && job.paused && st.pause_reason ? String(st.pause_reason) : '';
  const prep = job && !(+job.layer >= 1) ? t('Vorbereitung') + (job.status ? ' (' + t(job.status) + ')' : '') : '';   // vor der ersten Schicht
  const line2 = job ? (why ? (why.length > 30 ? why.slice(0, 29) + '…' : why) : prep || t('Schicht {l} von {n}', { l: +job.layer || 0, n: +job.layers || '–' })) : '';
  const line3 = job && rem != null ? (typeof wbMin === 'function' ? wbMin(rem) : rem + ' min') : '';
  const key = [line1, pct, line2, line3].join('|');
  if (key + (fin || '') === D.key) return; D.key = key + (fin || '');
  const g = D.cv.getContext('2d'), W = 320, H = 200;
  g.fillStyle = '#0d1114'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#8fd3c7'; g.font = '600 22px system-ui, sans-serif'; g.textBaseline = 'top'; g.fillText(line1, 16, 14);
  if (job) {
    g.fillStyle = '#ffffff'; g.font = 'bold 64px system-ui, sans-serif'; g.fillText(pct + ' %', 16, 44);
    g.fillStyle = '#2a3338'; g.beginPath(); g.roundRect(16, 120, W - 32, 14, 7); g.fill();
    g.fillStyle = job.paused ? '#f0b44c' : '#2bc4a8'; g.beginPath(); g.roundRect(16, 120, Math.max(14, (W - 32) * pct / 100), 14, 7); g.fill();
    g.fillStyle = '#c9d2d6'; g.font = '20px system-ui, sans-serif'; g.fillText(line2, 16, 148);
    if (line3) { g.textAlign = 'right'; g.fillText(line3, W - 16, 148); g.textAlign = 'left'; }
  } else if (fin) { g.fillStyle = fin === 'ok' ? '#7be0a0' : '#ff7a6b'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText(fin === 'ok' ? '✓' : '✕', 16, 60);
    g.fillStyle = '#c9d2d6'; g.font = '20px system-ui, sans-serif'; const nm = String((st.last_job && st.last_job.name) || ''); g.fillText(nm.length > 26 ? nm.slice(0, 25) + '…' : nm, 16, 150);
  } else { g.fillStyle = '#56636a'; g.font = '20px system-ui, sans-serif'; g.fillText('Kobra S1', 16, 150); }
  D.tex.needsUpdate = true; lvRender();
}


/* Farbwechsel (lv.swap aus lvAceColours): 0–2,5 s läuft das alte Filament rückwärts zur ACE (Spule spult auf),
   2,5–5 s das neue schnell vor, ab 3,5 s fallen Tropfen der Spülmenge (alte → neue Farbe) unter der Düse heraus */
const LV_SWAP_BACK_S = 2.5, LV_SWAP_FEED_S = 5, LV_SWAP_END_S = 7;
function lvSwapTick(now, dt) {
  const w = lv.swap; if (!w) return;
  const a = (now - w.t0) / 1000, back = a < LV_SWAP_BACK_S, feed = !back && a < LV_SWAP_FEED_S;
  const show = (sp, on) => { sp.tubes[1].material = on ? sp.flow : sp.line; sp.strand.material = on ? sp.flowS : sp.line; sp.glow.visible = sp.glowS.visible = on; };
  if (back) {
    show(w.from, true); show(w.to, false);
    for (const m of [w.from.flow, w.from.flowS]) { m.color.copy(w.c0); m.emissive.copy(w.c0).lerp(new THREE.Color(0xffffff), 0.5); m.emissiveMap.offset.x += 3 * LV_FLOW_V / LV_FLOW_MM * dt; }
    for (const o of [w.from.glow, w.from.glowS]) o.material.color.copy(w.c0).lerp(new THREE.Color(0xffffff), 0.3);
    w.from.group.rotation.x -= LV_ACE_SPIN * 3 * dt;
    if (lv.filFlow) lv.filFlow.emissiveMap.offset.x += 4 * LV_FLOW_V / LV_FLOW_MM * dt;   // auch im Kopfschlauch rückwärts
  } else if (feed) {
    show(w.from, false); show(w.to, true);
    for (const m of [w.to.flow, w.to.flowS]) m.emissiveMap.offset.x -= 2 * LV_FLOW_V / LV_FLOW_MM * dt;   // zusätzlich zum normalen Fluss
    if (lv.filFlow) lv.filFlow.emissiveMap.offset.x -= 3 * LV_FLOW_V / LV_FLOW_MM * dt;
  }
  if (a >= 3.5 && a < LV_SWAP_END_S - 1 && lv.head && lv.head.visible && w.drops.length < 7 && a - (w.lastDrop || 0) > 0.45) {
    w.lastDrop = a;
    const k = Math.min(1, w.drops.length / 6), m = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 8), new THREE.MeshStandardMaterial({ color: w.c0.clone().lerp(w.c1, k), roughness: 0.5, transparent: true }));
    m.position.copy(lv.head.position).add(new THREE.Vector3(0, 0, -2)); lv.scene.add(m); w.drops.push({ m, v: 0, t: a });
  }
  for (const d of w.drops) { d.v += 600 * dt; d.m.position.z -= d.v * dt; d.m.material.opacity = Math.max(0, 1 - (a - d.t) / 1.4); d.m.visible = d.m.material.opacity > 0; }
  if (a >= LV_SWAP_END_S) {
    for (const d of w.drops) { lv.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }
    lv.swap = null; lvAceColours(typeof wb !== 'undefined' && wb.st);
  }
}

/* Hitze, Gehäuselicht, Status (aus jedem Druckerstand, liveUpdate): Heizblock/Düse glühen nach Temperatur, die Platte
   schimmert warm, beim Aufheizen pulsiert es; Licht wie am Drucker; Rahmen gelb (Pause), rot (Fehler/Abbruch), grün (fertig) */
const LV_END_MS = 60000, LV_HOT = new THREE.Color(0xff5a14);
function lvFx(st) {
  const fx = lv.fx = lv.fx || {}, T = (st && st.temps) || {}, num = v => (v == null || v === '' || isNaN(+v) ? 0 : +v);
  fx.noz = num(T.curr_nozzle_temp); fx.nozT = num(T.target_nozzle_temp); fx.bed = num(T.curr_hotbed_temp); fx.bedT = num(T.target_hotbed_temp);
  fx.heating = (fx.nozT > 0 && fx.nozT - fx.noz > 5) || (fx.bedT > 0 && fx.bedT - fx.bed > 3);
  const job = st && st.job, lj = st && st.last_job;
  // Druckende: vorher lief ein Auftrag, jetzt keiner – Ergebnis aus last_job (fertig / abgebrochen)
  if (fx.hadJob && !job && lj) { fx.end = lj.status === 'fertig' ? 'ok' : lj.status === 'abgebrochen' ? 'abort' : null; fx.endAt = fx.end ? Date.now() : 0; }
  if (job) { fx.end = null; fx.endAt = 0; }
  // Fehler: Verbindung zum Drucker mitten im Druck verloren (Druckerfehler selbst meldet die Firmware hier nicht)
  fx.err = !!(st && st.connected === false && (fx.hadJob || fx.err));
  fx.hadJob = !!(job && job.name) || (fx.err && fx.hadJob);
  fx.paused = !!(job && job.paused);
  const L = (st && st.lights) || [], on = L.find(l => l && +l.status === 1);
  fx.light = on ? Math.max(0.15, Math.min(1, (+on.brightness || 100) / 100)) : 0;
  lvFxApply(0); lvAceAnimate();
}
function lvFxBusy() {
  const fx = lv.fx; if (!fx) return !!lv.swap || lvFansOn();
  return !!lv.swap || fx.heating || fx.paused || fx.err || (fx.endAt && Date.now() - fx.endAt < LV_END_MS) || lvFansOn();
}
function lvFxApply(ph) {
  const fx = lv.fx; if (!fx) return;
  const pulse = fx.heating ? 0.8 + 0.2 * Math.sin(ph * 4) : 1;
  const kn = Math.max(0, Math.min(1, (fx.noz - 60) / 220)), kb = Math.max(0, Math.min(1, (fx.bed - 35) / 65));
  (lv.hotM || []).forEach((m, i) => { m.emissive.copy(LV_HOT); m.emissiveIntensity = kn * (i ? 0.7 : 1.1) * pulse; });
  if (lv.plate && lv.plate.material.emissive) { lv.plate.material.emissive.copy(LV_HOT); lv.plate.material.emissiveIntensity = kb * 0.28 * pulse; }
  if (lv.encLight) { lv.encLight.light.intensity = fx.light * 2.4; lv.encLight.strip.material.color.set(fx.light ? 0xfff3dd : 0x3a3f43); }
  const ol = lv.statusLine;
  if (ol) {
    const ended = fx.endAt && Date.now() - fx.endAt < LV_END_MS;
    const col = fx.err || (ended && fx.end === 'abort') ? 0xff4a3d : fx.paused ? 0xffc23d : ended ? 0x4fe08a : null;
    ol.visible = col != null;
    if (col != null) { ol.material.color.set(col); ol.material.opacity = 0.55 + 0.4 * Math.sin(ph * (fx.err ? 5 : 2.5)); }
  }
}
function lvFxTick(ph) { lvFxApply(ph); if (lv.display && lv.fx && lv.fx.endAt && typeof wb !== 'undefined') lvDisplay(wb.st); }

/* Lüfter mit Luftstrom (2026-10-08): Bauteillüfter am Kopf (bläst von beiden Seiten zur Düse), Seitenlüfter rechts an der
   Gehäusewand (flacher Fächer übers Bett) und Gehäuselüfter hinten (nach außen) – Stärke und Tempo des Luftstroms nach den gemeldeten
   Werten (st.fans: fan_speed_pct, aux_fan_speed_pct, box_fan_level, je 0–100). Teilchen wandern vom Lüfter weg und verblassen. */
const LV_AIR_N = 110;
let lvAirTex = null;
// weiche runde Flocke für die Luftteilchen
function lvAirSprite() {
  if (lvAirTex) return lvAirTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  LV_SHARED.add(lvAirTex = new THREE.CanvasTexture(c));
  return lvAirTex;
}
function lvAirStream(parent, from, dir, len, spread, key, size) {
  const pos = new Float32Array(LV_AIR_N * 3), col = new Float32Array(LV_AIR_N * 3), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: size || 11, map: lvAirSprite(), vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  pts.renderOrder = 4; parent.add(pts);
  const d = new THREE.Vector3(...dir).normalize(), a = Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(d, a).normalize(), v = new THREE.Vector3().crossVectors(d, u).normalize();
  const t = new Float32Array(LV_AIR_N), r = new Float32Array(LV_AIR_N * 2);
  for (let k = 0; k < LV_AIR_N; k++) { t[k] = Math.random(); const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()); r[2 * k] = Math.cos(ang) * rr; r[2 * k + 1] = Math.sin(ang) * rr; }
  // spread: Radius oder [quer, hoch] (flacher Fächer)
  const [su, sv] = Array.isArray(spread) ? spread : [spread, spread];
  return { pts, from: new THREE.Vector3(...from), d, u, v, len, su, sv, t, r, key };
}
// Lüfterrad: n schräge Flügel um die Nabe (Ebene xy, dreht um z)
function lvRotor(r, n, color) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: color || 0x3b4247, roughness: 0.5, side: THREE.DoubleSide });
  for (let k = 0; k < n; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.78, 0.8), m); const a = k / n * Math.PI * 2;
    b.position.set(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0); b.rotation.z = a - Math.PI / 2 + 0.5; g.add(b); }
  const hub = new THREE.Mesh(new THREE.CircleGeometry(r * 0.28, 20), new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6 })); hub.position.z = 0.6; g.add(hub);
  return g;
}
function lvFansInit(md, g) {
  lv.air = [];
  /* Lüfterräder drehen mit (lvAirTick): Kopf vorn = Bauteillüfter (fan_speed_pct), klein links am Kopf = Hotend-Lüfter (läuft
     beim Drucken immer, key null), Seitenlüfter rechts nach aux_fan_speed_pct */
  if (lv.headFan) { const ro = lvRotor(LV_HEAD.w * 0.2, 9, 0x2c3236); ro.position.z = 0.4; lv.headFan.add(ro); lv.rotors.push({ obj: ro, key: 'fan_speed_pct' }); }
  { const H = LV_HEAD, hf = new THREE.Group(), r = 9;
    hf.add(new THREE.Mesh(new THREE.TorusGeometry(r, 1.2, 8, 28), new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6 })),
      new THREE.Mesh(new THREE.CircleGeometry(r - 0.4, 28), new THREE.MeshStandardMaterial({ color: 0x0f1215, roughness: 0.8 })));
    const ro = lvRotor(r, 7, 0x3b4247); ro.position.z = 0.3; hf.add(ro); lv.rotors.push({ obj: ro, key: null });
    hf.rotation.y = -Math.PI / 2; hf.position.set(-(H.w / 2) - 1.4, -H.d / 2 + r + 8, H.tip + 8 + 12 + r + 2); lv.head.add(hf); }   // vorn unten, knapp über dem orangen Ring
  // Bauteillüfter: Auslässe links und rechts unten am Kopf, Luft zur Düsenspitze
  const H = LV_HEAD;
  for (const sx of [-1, 1]) lv.air.push(lvAirStream(lv.head, [sx * (H.w / 2 - 4), 0, H.tip + 6], [-sx, 0, -0.55], H.w / 2 + 6, 5, 'fan_speed_pct', 4));
  if (md.kin === 'bed' || !lv.xy || !lv.xy.fx0) return;
  if (md.fans && md.fans.aux === false) return;
  /* nach dem Foto des Kobra S1 (2026-10-08): großer Seitenlüfter rechts an der Wand, oben die flache, waagerechte Düse – bläst einen
     flachen Fächer quer übers Bett; Gehäuselüfter hinten links der Mitte (Gitter), etwa auf halber Bauraumhöhe */
  const { fx1, fy1, top } = lv.xy, cx = g.cx, cy = g.cy || 0, zAux = 5 - LV_GANTRY_Z, zBox = top - 200;   // seitliche Düse etwa auf Höhe der Druckkopf-Düse (5 mm darüber): bläst über die aktuelle Schicht
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2023, roughness: 0.6 }), side = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(30, 110, 110), dark); housing.position.set(fx1 - 25, cy, zAux - 150); side.add(housing);
  // Kanal vom tiefer sitzenden Lüfter hoch zur Düse (Düse bleibt auf Kopfhöhe)
  const duct = new THREE.Mesh(new THREE.BoxGeometry(26, 70, 102), dark); duct.position.set(fx1 - 30, cy, zAux - 45); side.add(duct);
  const wheel = new THREE.Mesh(new THREE.CircleGeometry(38, 32), new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.8 })); wheel.rotation.y = -Math.PI / 2; wheel.position.set(fx1 - 40.5, cy, zAux - 155); side.add(wheel);
  { const ro = lvRotor(36, 11), hold = new THREE.Group(); hold.rotation.y = -Math.PI / 2; hold.position.set(fx1 - 41.5, cy, zAux - 155); hold.add(ro); side.add(hold); lv.rotors.push({ obj: ro, key: 'aux_fan_speed_pct' }); }
  const slot = new THREE.Mesh(new THREE.BoxGeometry(34, 92, 12), dark); slot.position.set(fx1 - 26, cy, zAux); side.add(slot);   // flache Düse, nah an der Wand: außerhalb des Kopfwegs
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(6, 84),   // nach der Drehung um y: 6 mm hoch, 84 mm breit (waagerechter Schlitz)
    new THREE.MeshBasicMaterial({ color: 0x050607 })); mouth.rotation.y = -Math.PI / 2; mouth.position.set(fx1 - 43.2, cy, zAux); side.add(mouth);
  lv.gantry.add(side);
  lv.air.push(lvAirStream(lv.gantry, [fx1 - 46, cy, zAux], [-1, 0, -0.04], 250, [40, 3], 'aux_fan_speed_pct'));
  // Ansaugung: Luft aus dem Bauraum strömt als Kegel auf das Lüfterrad zu
  lv.air.push(Object.assign(lvAirStream(lv.gantry, [fx1 - 190, cy, zAux - 155], [1, 0, 0], 145, [48, 48], 'aux_fan_speed_pct'), { funnel: 1 }));
  /* Gehäuselüfter in der Rückwand: Rahmen mit Lüfterrad (dreht nach box_fan_level), davor ein dünnes Gitter. Abluft: innen
     ein Kegel, der auf den Lüfter zuläuft (angesaugt), hinter der Wand ein schmaler Strahl nach draußen */
  const bxx = cx - 70, byy = fy1 - 12, fan = new THREE.Group(), fr = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.6 });
  for (const [w, h, x, z] of [[78, 8, 0, 35], [78, 8, 0, -35], [8, 78, -35, 0], [8, 78, 35, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 12, h), fr); b.position.set(x, 0, z); fan.add(b); }
  const back = new THREE.Mesh(new THREE.CircleGeometry(33, 32), new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.9, side: THREE.DoubleSide })); back.rotation.x = Math.PI / 2; back.position.y = 4; fan.add(back);
  { const ro = lvRotor(31, 7, 0x4a5258), hold = new THREE.Group(); hold.rotation.x = Math.PI / 2; hold.position.y = -1; hold.add(ro); fan.add(hold); lv.rotors.push({ obj: ro, key: 'box_fan_level' }); }
  for (let k = -3; k <= 3; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(70, 1.6, 1.6), fr); bar.position.set(0, -8, k * 10); fan.add(bar); }   // dünnes Gitter davor
  fan.position.set(bxx, byy, zBox); lv.gantry.add(fan);
  lv.air.push(Object.assign(lvAirStream(lv.gantry, [bxx, byy - 140, zBox], [0, 1, 0], 210, [44, 36], 'box_fan_level'), { funnel: 140 / 210 }));
}
/* Lüfter und Luftstrom weiterdrehen – aus der Kopfbewegung (lvMechUpdate) und aus der Effekt-Schleife (lvAceAnimate):
   mit echter Kopfposition steht die Kopfbewegung zwischen zwei Meldungen still, die Lüfter blieben dann nach ein paar
   Sekunden stehen (2026-10-16). Gemeinsame Zeit lv.airT – laufen beide, dreht nichts doppelt so schnell. */
function lvFanTick() {
  const now = performance.now(), dt = lv.airT ? Math.min(0.1, (now - lv.airT) / 1000) : 0; lv.airT = now; lvAirTick(dt);
}
function lvFansOn() {
  const f = (typeof wb !== 'undefined' && wb.st && wb.st.fans) || {};
  return !!(lv.head && lv.head.visible && lv.mechG && lv.mechG.visible && Object.values(f).some(v => +v > 0));
}
function lvAirTick(dt) {
  const st = typeof wb !== 'undefined' && wb.st, fans = (st && st.fans) || {};
  for (const ro of lv.rotors || []) { const pct = ro.key ? Math.max(0, Math.min(100, +fans[ro.key] || 0)) : 100; ro.obj.rotation.z -= dt * 30 * pct / 100; }
  if (!lv.air || !lv.air.length) return;
  for (const a of lv.air) {
    const pct = Math.max(0, Math.min(100, +fans[a.key] || 0));
    a.pts.visible = pct > 0 && lv.head.visible;
    if (!a.pts.visible) continue;
    const pos = a.pts.geometry.attributes.position.array, col = a.pts.geometry.attributes.color.array, speed = 0.15 + 0.85 * pct / 100;
    const live = Math.round(LV_AIR_N * (0.25 + 0.75 * pct / 100));   // mehr Leistung = dichterer Strom
    a.pts.geometry.setDrawRange(0, live);
    for (let k = 0; k < live; k++) {
      let t = a.t[k] + dt * speed * 0.9; if (t >= 1) t -= 1; a.t[k] = t;
      // Abluft (funnel): innen Kegel zum Lüfter hin enger, danach schmaler Strahl; sonst Fächer, der sich aufweitet
      const g = a.funnel ? (t < a.funnel ? 1.25 - 1.0 * t / a.funnel : 0.25 + 0.35 * (t - a.funnel) / (1 - a.funnel)) : 0.4 + t, l = t * a.len, x = a.r[2 * k] * a.su * g, y = a.r[2 * k + 1] * a.sv * g;
      pos[3 * k] = a.from.x + a.d.x * l + a.u.x * x + a.v.x * y; pos[3 * k + 1] = a.from.y + a.d.y * l + a.u.y * x + a.v.y * y; pos[3 * k + 2] = a.from.z + a.d.z * l + a.u.z * x + a.v.z * y;
      const f = (1 - t) * (0.35 + 0.65 * pct / 100);   // verblasst mit dem Weg, stärker bei mehr Leistung
      col[3 * k] = 0.45 * f; col[3 * k + 1] = 0.75 * f; col[3 * k + 2] = 1.0 * f;
    }
    a.pts.geometry.attributes.position.needsUpdate = true; a.pts.geometry.attributes.color.needsUpdate = true;
  }
}

'use strict';
/* Dialog „Modell erstellen“ (Datei → Erstellen …, leere 3D-Ansicht): Schild, Anhänger, QR-Schild, Lithophane, Bild-Relief.
   Die Geometrie kommt aus js/makers.js; das Ergebnis wird wie eine geladene Datei ein Projekt (oder hinzugefügt).
   Zweifarbiges: Platte und Motiv sind Körper eines Teils mit eigenem Slot (Slot-Chips im Dialog).
   Dazu „Teil schneiden“ im Schnitt-Feld der 3D-Ansicht (js/cut.js). Eingaben bleiben gemerkt – außer Bild und WLAN-Passwort. */

const MK_KINDS = ['sign', 'key', 'qr', 'litho', 'relief'];
const MK_DEF = {
  sign: { text: 'Werkstatt', textH: 10, plateT: 3, topT: 1, border: true, hole: 'none' },
  key: { text: 'Name', textH: 7, plateT: 2.5, topT: 0.8 },
  qr: { qrKind: 'url', qrText: 'https://', ssid: '', sec: 'WPA', caption: '', module: 2, ecl: 'M', plateT: 2.5, topT: 1, hole: 'none' },
  litho: { width: 100, shape: 'stand', angle: 120, minT: 0.8, maxT: 3, frame: 3 },
  relief: { width: 60, mode: 'plate', thr: 50, inv: false, plateT: 2, topT: 1.2, hole: 'none' }
};
const mk = { kind: 'sign', vals: {}, img: null, imgName: '', pass: '', slotA: null, slotB: null, timer: 0, gridCache: null, built: null };

function mkLoad() {
  const s = (store.settings && store.settings.makers) || {};
  mk.kind = MK_KINDS.includes(s.kind) ? s.kind : 'sign';
  for (const k of MK_KINDS) mk.vals[k] = { ...MK_DEF[k], ...((s.vals || {})[k] || {}) };
}
function mkSave() {
  store.settings.makers = { kind: mk.kind, vals: mk.vals }; persist();
}

// Felder: [id, Beschriftung, Art, für welche Arten, Zusatz]
const MK_FIELDS = [
  ['text', 'Text', 'area', 'sign key', { hint: 'bis zu 3 Zeilen' }],
  ['qrKind', 'Inhalt', 'sel', 'qr', { opts: [['url', 'Link oder Text'], ['wifi', 'WLAN-Zugang']] }],
  ['qrText', 'Link / Text', 'text', 'qr', { when: v => v.qrKind !== 'wifi' }],
  ['ssid', 'WLAN-Name', 'text', 'qr', { when: v => v.qrKind === 'wifi' }],
  ['pass', 'Passwort', 'pass', 'qr', { when: v => v.qrKind === 'wifi', hint: 'wird nicht gespeichert' }],
  ['sec', 'Verschlüsselung', 'sel', 'qr', { when: v => v.qrKind === 'wifi', opts: [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'offen']] }],
  ['caption', 'Beschriftung', 'text', 'qr', { hint: 'optional, unter dem Code' }],
  ['img', 'Bild', 'file', 'litho relief', {}],
  ['textH', 'Schrifthöhe', 'num', 'sign key', { u: 'mm', min: 3, max: 60, step: 0.5 }],
  ['module', 'Modulgröße', 'num', 'qr', { u: 'mm', min: 0.8, max: 8, step: 0.1 }],
  ['ecl', 'Fehlerkorrektur', 'sel', 'qr', { opts: [['L', 'L – 7 %'], ['M', 'M – 15 %'], ['Q', 'Q – 25 %'], ['H', 'H – 30 %']] }],
  ['width', 'Breite', 'num', 'litho relief', { u: 'mm', min: 10, max: 250, step: 1 }],
  ['shape', 'Form', 'sel', 'litho', { opts: [['stand', 'flach, stehend'], ['lie', 'flach, liegend'], ['curved', 'gebogen']] }],
  ['angle', 'Biegung', 'num', 'litho', { u: '°', min: 30, max: 360, step: 5, when: v => v.shape === 'curved' }],
  ['minT', 'Dicke hell', 'num', 'litho', { u: 'mm', min: 0.4, max: 3, step: 0.1 }],
  ['maxT', 'Dicke dunkel', 'num', 'litho', { u: 'mm', min: 1, max: 8, step: 0.1 }],
  ['frame', 'Rahmen', 'num', 'litho', { u: 'mm', min: 0, max: 15, step: 0.5 }],
  ['mode', 'Art', 'sel', 'relief', { opts: [['plate', 'Motiv auf Platte (zweifarbig)'], ['cutout', 'nur das Motiv (Umriss)']] }],
  ['thr', 'Schwelle', 'range', 'relief', { min: 5, max: 95, step: 1 }],
  ['inv', 'Umkehren', 'check', 'relief', { hint: 'helle statt dunkle Flächen' }],
  ['plateT', 'Plattendicke', 'num', 'sign key qr relief', { u: 'mm', min: 0.8, max: 10, step: 0.1 }],
  ['topT', 'Erhaben', 'num', 'sign key qr relief', { u: 'mm', min: 0.4, max: 5, step: 0.1 }],
  ['border', 'Rand', 'check', 'sign', { hint: 'erhabener Rahmen in der Schriftfarbe' }],
  ['hole', 'Loch', 'sel', 'sign qr relief', { opts: [['none', 'keins'], ['top', 'oben (zum Aufhängen)'], ['corners', '4 Ecken (zum Schrauben)']], optsFor: { qr: ['none', 'top'], relief: ['none', 'top'] }, when: (v, k) => k !== 'relief' || v.mode !== 'cutout' }]
];

function mkDialog() {
  let d = $('makeDlg');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'makeDlg'; d.className = 'make-dlg'; d.setAttribute('aria-labelledby', 'mkTitle');
  const tabs = [['sign', 'Schild'], ['key', 'Anhänger'], ['qr', 'QR-Code'], ['litho', 'Lithophane'], ['relief', 'Bild / Logo']];
  d.innerHTML = '<div class="ed-head"><h2 id="mkTitle">' + esc(t('Modell erstellen')) + '</h2><div class="muted">' +
    esc(t('Schilder, Anhänger, QR-Codes, Lithophanes und Logos aus Bildern – direkt als druckfertiges Modell, zweifarbig über die ACE.')) + '</div></div>' +
    '<div class="ed-body"><span class="seg mk-tabs" role="group" aria-label="' + esc(t('Was erstellen?')) + '">' +
    tabs.map(([k, l]) => '<button type="button" data-mk="' + k + '" aria-pressed="false">' + esc(t(l)) + '</button>').join('') + '</span>' +
    '<div class="mk-grid"><div class="mk-form" id="mkForm"></div><div class="mk-side"><canvas id="mkPrev" width="360" height="260" aria-label="' + esc(t('Vorschau von oben')) + '"></canvas>' +
    '<p class="muted small" id="mkInfo" role="status"></p><div class="mk-slots" id="mkSlots"></div></div></div></div>' +
    '<div class="ed-foot"><button class="btn sec" type="button" data-close>' + esc(t('Abbrechen')) + '</button>' +
    '<button class="btn sec" type="button" id="mkAdd">' + esc(t('Zum Projekt hinzufügen')) + '</button>' +
    '<button class="btn" type="button" id="mkCreate">' + esc(t('Erstellen')) + '</button></div>';
  document.body.appendChild(d);
  d.addEventListener('click', e => {
    if (e.target === d) { d.close(); return; }
    const b = e.target.closest('[data-mk]');
    if (b) { mk.kind = b.dataset.mk; mkSave(); mkRender(); return; }
    const c = e.target.closest('[data-mkslot]');
    if (c) {
      const which = c.dataset.mkslot;
      openSlotPicker(c, which === 'a' ? mkSlotA() : mkSlotB(), { title: t('Slot wählen') }, s => { if (s == null) return; mk[which === 'a' ? 'slotA' : 'slotB'] = s; mkSlotsRender(); mkPreview(); });
    }
  });
  d.addEventListener('input', mkInput);
  d.addEventListener('change', mkInput);
  $('mkCreate').addEventListener('click', () => mkBuild(false));
  $('mkAdd').addEventListener('click', () => mkBuild(true));
  return d;
}

function mkOpen(kind) {
  mkLoad();
  if (kind && MK_KINDS.includes(kind)) mk.kind = kind;
  const d = mkDialog();
  mkRender();
  d.showModal();
}

const mkVals = () => mk.vals[mk.kind];
function mkRender() {
  const k = mk.kind, v = mkVals();
  document.querySelectorAll('#makeDlg [data-mk]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mk === k)));
  $('mkForm').innerHTML = MK_FIELDS.filter(f => f[3].split(' ').includes(k)).map(([id, label, type, , o]) => {
    if (o.when && !o.when(v, k)) return '';
    const val = id === 'pass' ? mk.pass : v[id], fid = 'mk_' + id;
    let inp;
    if (type === 'area') inp = '<textarea id="' + fid + '" rows="3" maxlength="140">' + esc(val ?? '') + '</textarea>';
    else if (type === 'sel') {
      const allowed = o.optsFor && o.optsFor[k];
      inp = '<select id="' + fid + '">' + o.opts.filter(([x]) => !allowed || allowed.includes(x)).map(([x, l]) => '<option value="' + x + '"' + (x === val ? ' selected' : '') + '>' + esc(t(l)) + '</option>').join('') + '</select>';
    } else if (type === 'check') inp = '<label class="mk-check"><input type="checkbox" id="' + fid + '"' + (val ? ' checked' : '') + '> ' + esc(t(o.hint || '')) + '</label>';
    else if (type === 'file') inp = '<input type="file" id="' + fid + '" accept="image/*"><span class="u" id="mkImgName">' + esc(mk.imgName) + '</span>';
    else if (type === 'range') inp = '<input type="range" id="' + fid + '" min="' + o.min + '" max="' + o.max + '" step="' + o.step + '" value="' + val + '"><span class="u">' + val + ' %</span>';
    else if (type === 'num') inp = '<input id="' + fid + '" type="number" inputmode="decimal" min="' + o.min + '" max="' + o.max + '" step="' + o.step + '" value="' + val + '"><span class="u">' + esc(o.u) + '</span>';
    else inp = '<input id="' + fid + '" type="' + (type === 'pass' ? 'password' : 'text') + '" autocomplete="off" value="' + esc(val ?? '') + '"' + (type === 'pass' ? '' : ' maxlength="1200"') + '>';
    const hint = o.hint && type !== 'check' ? '<small class="muted mk-hint">' + esc(t(o.hint)) + '</small>' : '';
    return '<div class="ed-row"><label for="' + fid + '">' + esc(t(label)) + '</label><div class="ed-in">' + inp + '</div>' + hint + '</div>';
  }).join('');
  $('mkAdd').classList.toggle('hidden', !project);
  mkSlotsRender();
  mkPreview();
}

function mkInput(e) {
  const el = e.target, id = el.id && el.id.startsWith('mk_') ? el.id.slice(3) : null;
  if (!id) return;
  const f = MK_FIELDS.find(x => x[0] === id), v = mkVals();
  if (id === 'img') { if (e.type === 'change' && el.files && el.files[0]) mkReadImage(el.files[0]); return; }
  if (id === 'pass') mk.pass = el.value;
  else if (f[2] === 'check') v[id] = el.checked;
  else if (f[2] === 'num' || f[2] === 'range') { const n = num(el.value); if (Number.isFinite(n)) v[id] = Math.max(f[4].min, Math.min(f[4].max, n)); if (f[2] === 'range') el.nextElementSibling.textContent = v[id] + ' %'; }
  else v[id] = el.value;
  mkSave();
  // Felder, die andere ein- oder ausblenden: neu aufbauen (nur bei „change“, damit Tippen den Fokus behält)
  if (e.type === 'change' && ['qrKind', 'shape', 'mode'].includes(id)) { mkRender(); return; }
  clearTimeout(mk.timer);
  mk.timer = setTimeout(mkPreview, mk.kind === 'relief' ? 300 : 150);
}

/* ---------- Slots ---------- */
function slotLum(hex) { const c = validSlotHex(hex) ? hexRgb(hex) : [0.8, 0.8, 0.8]; return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function mkSlotA() { const n = slotChoices().length; return mk.slotA != null && mk.slotA < n ? mk.slotA : Math.min(defaultSlot(), Math.max(0, n - 1)); }
// zweiter Slot: der mit dem größten Helligkeitsunterschied zum ersten (weiße Platte → schwarze Schrift)
function mkSlotB() {
  const s = slotChoices(), a = mkSlotA();
  if (mk.slotB != null && mk.slotB < s.length) return mk.slotB;
  let best = s.length > 1 ? (a + 1) % s.length : a, d = -1;
  s.forEach((x, i) => { if (i === a || x.present === false) return; const dd = Math.abs(slotLum(x.colour) - slotLum((s[a] || {}).colour)); if (dd > d) { d = dd; best = i; } });
  return best;
}
const mkTwo = () => ['sign', 'key', 'qr'].includes(mk.kind) || (mk.kind === 'relief' && mkVals().mode !== 'cutout');
function mkSlotsRender() {
  const s = slotChoices();
  if (!s.length) { $('mkSlots').innerHTML = ''; return; }
  const lab = mk.kind === 'qr' ? t('QR-Code') : mk.kind === 'relief' ? t('Motiv') : t('Schrift');
  $('mkSlots').innerHTML = '<span>' + esc(mkTwo() ? t('Platte') : t('Slot')) + ' ' + slotChipHTML(mkSlotA(), null, 'data-mkslot="a"', t('Platte')) + '</span>' +
    (mkTwo() ? '<span>' + esc(lab) + ' ' + slotChipHTML(mkSlotB(), null, 'data-mkslot="b"', lab) + '</span>' : '');
}
const mkHex = i => slotColour(i, slotChoices());

/* ---------- Bild ---------- */
async function mkReadImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    if (mk.img && mk.img.close) mk.img.close();
    mk.img = bmp; mk.imgName = file.name; mk.gridCache = null;
    const n = $('mkImgName'); if (n) n.textContent = file.name;
    mkPreview();
  } catch (err) { toast(t('Bild konnte nicht gelesen werden')); }
}
function mkGray(kind) {
  const v = mkVals(), aspect = mk.img.height / mk.img.width, g = imageGrid(kind, v.width, aspect), key = kind + '|' + g.w + '|' + g.h;
  if (mk.gridCache && mk.gridCache.key === key) return mk.gridCache;
  const c = document.createElement('canvas'); c.width = g.w; c.height = g.h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(mk.img, 0, 0, g.w, g.h);
  mk.gridCache = { key, w: g.w, h: g.h, gray: rgbaToGray(x.getImageData(0, 0, g.w, g.h).data, g.w, g.h) };
  return mk.gridCache;
}

/* ---------- Modell ---------- */
function mkModel() {
  const k = mk.kind, v = mkVals(), lines = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 3);
  if (k === 'sign') return signModel({ lines: lines(v.text), textH: v.textH, plateT: v.plateT, textT: v.topT, border: v.border, hole: v.hole });
  if (k === 'key') return signModel({ ...KEYCHAIN_DEFAULTS, lines: lines(v.text).slice(0, 2), textH: v.textH, plateT: v.plateT, textT: v.topT, keychain: true });
  if (k === 'qr') {
    const text = v.qrKind === 'wifi' ? (v.ssid ? qrWifiText(v.ssid, mk.pass, v.sec) : '') : String(v.qrText || '').trim();
    if (v.qrKind !== 'wifi' && (!text || text === 'https://')) throw Error(t('Bitte Inhalt für den QR-Code eingeben.'));
    if (v.qrKind === 'wifi' && !v.ssid) throw Error(t('Bitte den WLAN-Namen eingeben.'));
    return qrSignModel({ text, ecl: v.ecl, module: v.module, plateT: v.plateT, qrT: v.topT, caption: v.caption, hole: v.hole === 'top' ? 'top' : 'none' });
  }
  if (!mk.img) throw Error(t('Bitte ein Bild wählen.'));
  const g = mkGray(k);
  if (k === 'litho') {
    if (!(v.maxT > v.minT)) throw Error(t('„Dicke dunkel“ muss größer sein als „Dicke hell“.'));
    return lithophaneModel(g.gray, g.w, g.h, { width: v.width, minT: v.minT, maxT: v.maxT, frame: v.frame, shape: v.shape === 'curved' ? 'curved' : 'flat', angle: v.angle, standing: v.shape !== 'lie' });
  }
  return reliefModel(g.gray, g.w, g.h, { width: v.width, threshold: v.thr / 100, invert: v.inv, mode: v.mode, plateT: v.plateT, reliefT: v.topT, hole: v.hole === 'top' ? 'top' : 'none' });
}

// Vorschau von oben: Lithophane als Graubild (so wie gegen Licht), Relief als Maske, sonst die Deckflächen des Netzes
function mkPreview() {
  const cv = $('mkPrev'); if (!cv) return;
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, info = $('mkInfo');
  x.clearRect(0, 0, W, H);
  const k = mk.kind, v = mkVals();
  try {
    if ((k === 'litho' || k === 'relief') && mk.img) {
      const g = mkGray(k), f = Math.min(W / g.w, H / g.h), img = x.createImageData(g.w, g.h);
      const a = validSlotHex(mkHex(mkSlotA())) ? hexRgb(mkHex(mkSlotA())) : [0.9, 0.9, 0.9], b = hexRgb(mkHex(mkSlotB()));
      for (let i = 0; i < g.w * g.h; i++) {
        let c;
        if (k === 'litho') { const l = g.gray[i]; c = [l, l * 0.97, l * 0.9]; }
        else { const ink = (g.gray[i] < v.thr / 100) !== !!v.inv; c = ink ? (v.mode === 'cutout' ? a : b) : (v.mode === 'cutout' ? [0, 0, 0, 0] : a); }
        img.data.set([c[0] * 255, c[1] * 255, c[2] * 255, c.length > 3 ? 0 : 255], i * 4);
      }
      const tmp = document.createElement('canvas'); tmp.width = g.w; tmp.height = g.h; tmp.getContext('2d').putImageData(img, 0, 0);
      x.drawImage(tmp, (W - g.w * f) / 2, (H - g.h * f) / 2, g.w * f, g.h * f);
      const mm = imageSizeMm(k, v, g);
      info.textContent = mm + (k === 'litho' ? ' · ' + t('Vorschau wie gegen Licht') : '');
      mk.built = null;
      return;
    }
    if (k === 'litho' || k === 'relief') { info.textContent = t('Bild wählen (JPG, PNG …)'); return; }
    const m = mkModel(); mk.built = m;
    mkDrawTop(x, W, H, m.parts[0]);
    info.textContent = de(m.size[0], 1) + ' × ' + de(m.size[1], 1) + ' × ' + de(m.size[2], 1) + ' mm' +
      (m.qr ? ' · ' + t('QR Version {v} ({n} × {n} Module)', { v: m.qr.version, n: m.qr.modules }) : '') + (m.notes.length ? ' · ' + m.notes.join(' ') : '');
  } catch (err) { info.textContent = t(err.message); mk.built = null; }
}
function imageSizeMm(k, v, g) {
  const h = v.width * (g.h - 1) / (g.w - 1);
  return k === 'litho' ? de(v.width, 0) + ' × ' + de(h, 0) + ' mm · ' + de(v.minT, 1) + '–' + de(v.maxT, 1) + ' mm' : t('Breite {w} mm', { w: de(v.width, 0) });
}
function mkDrawTop(x, W, H, part) {
  const pos = part.pos, bodies = part.bodies || [{ count: pos.length / 9 }];
  let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) { mn = [Math.min(mn[0], pos[i]), Math.min(mn[1], pos[i + 1])]; mx = [Math.max(mx[0], pos[i]), Math.max(mx[1], pos[i + 1])]; }
  const f = Math.min((W - 16) / (mx[0] - mn[0]), (H - 16) / (mx[1] - mn[1])), ox = (W - (mx[0] - mn[0]) * f) / 2, oy = (H - (mx[1] - mn[1]) * f) / 2;
  const X = v => ox + (v - mn[0]) * f, Y = v => H - oy - (v - mn[1]) * f;
  let s = 0;
  bodies.forEach((b, bi) => {
    x.fillStyle = mkHex(bi === 0 ? mkSlotA() : mkSlotB()); x.strokeStyle = x.fillStyle; x.lineWidth = 0.6;
    x.beginPath();
    for (let o = s * 9; o < (s + b.count) * 9; o += 9) {
      const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], wx = pos[o + 6] - pos[o], wy = pos[o + 7] - pos[o + 1];
      if (ux * wy - uy * wx <= 1e-9) continue;   // nur nach oben zeigende Flächen
      x.moveTo(X(pos[o]), Y(pos[o + 1])); x.lineTo(X(pos[o + 3]), Y(pos[o + 4])); x.lineTo(X(pos[o + 6]), Y(pos[o + 7])); x.closePath();
    }
    x.fill(); x.stroke();
    s += b.count;
  });
  // Plattenkante dunkel nachziehen, damit eine weiße Platte auf hellem Grund sichtbar ist
  x.strokeStyle = 'rgba(0,0,0,.25)';
}

// Große Netze (Lithophane) rechnen gut eine Sekunde – erst „erstelle …“ zeigen, dann rechnen
function mkBuild(add) {
  $('mkInfo').textContent = t('erstelle …');
  $('mkCreate').disabled = $('mkAdd').disabled = true;
  setTimeout(() => { try { mkFinish(add); } finally { $('mkCreate').disabled = $('mkAdd').disabled = false; } }, 30);
}
function mkFinish(add) {
  let m;
  try { m = mkModel(); } catch (err) { $('mkInfo').textContent = t(err.message); return; }
  const a = mkSlotA(), b = mkSlotB();
  for (const p of m.parts) {
    p.extruder = a + 1;
    if (p.bodies) { p.bodies[0].extruder = a + 1; p.bodies[1].extruder = b + 1; }
  }
  const imp = { name: m.name, parts: m.parts, threemf: null, notes: m.notes };
  $('makeDlg').close();
  if (add && project) { addParts(imp); return; }
  if (typeof importStop === 'function') importStop();
  showProject({ name: imp.name, parts: partsFromImport(imp), threemf: null, notes: imp.notes });
  if (typeof adoptSlotMaterialFor === 'function' && adoptSlotMaterialFor(project.parts)) update();
  toast(t('{name} erstellt – unter ② Druckwerte und ③ Slicen geht es weiter', { name: m.name }));
}

ACTIONS.make = () => mkOpen();

/* ---------- Teil schneiden ---------- */
const CUT_NAMES = [['links', 'rechts'], ['vorne', 'hinten'], ['unten', 'oben']];
function cutSelected() {
  const part = project && project.parts[project.selected];
  if (!part) return;
  if (typeof plateView !== 'undefined' && plateView) { toast(t('Zum Schneiden die Ganze-Platte-Ansicht ausschalten')); return; }
  const axis = ['X', 'Y', 'Z'].findIndex(a => $('clipAxis' + a).classList.contains('active')), k = axis < 0 ? 0 : axis;
  const g = part.geom, fr = Number($('clipSlider').value) / 100;
  const value = (g.mn[k] + g.mx[k]) / 2 - fr * (g.mx[k] - g.mn[k]) / 2;
  // Körper einzeln schneiden – so behalten zweifarbige Teile ihre Körper und Slots
  const src = part.bodies || [{ name: part.name, start: 0, count: g.pos.length / 9, slot: null, partId: null }];
  const cuts = src.map(b => cutMesh(g.pos.subarray(b.start * 9, (b.start + b.count) * 9), k, value));
  const open = cuts.reduce((s, c) => s + c.open, 0), side = j => cuts.reduce((s, c) => s + (j ? c.hi : c.lo).length, 0);
  if (!side(0) || !side(1)) { toast(t('Die Schnittebene liegt nicht im Teil – Regler verschieben')); return; }
  const tm = project.threemf, i = project.selected;
  const pieces = [0, 1].map(j => {
    const arrs = cuts.map(c => (j ? c.hi : c.lo)), pos = new Float32Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0, start = 0;
    const bodies = [];
    arrs.forEach((a, bi) => { pos.set(a, o); o += a.length; if (a.length) { bodies.push({ ...src[bi], start, count: a.length / 9 }); start += a.length / 9; } });
    // jedes Stück aufs Bett
    let mz = Infinity; for (let q = 2; q < pos.length; q += 3) mz = Math.min(mz, pos[q]);
    for (let q = 2; q < pos.length; q += 3) pos[q] -= mz;
    const name = part.name + ' · ' + t(CUT_NAMES[k][j]);
    const piece = { ...part, name, origPos: pos, R: IDENTITY3, scale: null, bodies: part.bodies && bodies.length > 1 ? bodies : null, holes: [], holeGeom: null, holeCands: null, copyGroup: null, texts: [],
      input: part.input && { ...part.input }, paintUser: null, paintSup: null, paintSeam: null, paintCodes: null, paintSrc: null, supCodes: null, seamCodes: null,
      paintState: null, paintSlots: [], painted: false, paintTris: false, modVols: [], modSlots: [], inchHint: false };
    if (part.bodies && bodies.length === 1) piece.slot = bodies[0].slot ?? part.slot ?? null;
    if (tm) Object.assign(piece, { extra: true, objectId: null, instance: 0, dSlot: null });
    if (piece.bodies) piece.bodies.forEach(b => { if (tm) { b.dSlot = null; b.partId = null; } });
    piece.geom = partGeom(piece);
    return piece;
  });
  if (tm) tm.removed = true;
  const lost = (part.texts && part.texts.length) || part.paintUser || part.paintCodes || part.paintState;
  replaceParts([...project.parts.slice(0, i), ...pieces, ...project.parts.slice(i + 1)], i);
  toast(t('{name} in zwei Teile geschnitten', { name: part.name }) + (lost ? ' – ' + t('Beschriftung und Bemalung entfallen dabei') : '') +
    (open ? ' – ' + t('Netz nicht ganz geschlossen, Schnittfläche evtl. lückenhaft') : ''), { label: t('Rückgängig'), fn: () => undoStep(-1) });
}
{
  const pnl = $('clipPanel');
  if (pnl) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'clipCut'; b.className = 'clip-cut';
    b.textContent = t('Hier teilen');
    b.title = t('Das gewählte Teil an dieser Ebene in zwei Teile schneiden (Schnittflächen werden geschlossen)');
    b.addEventListener('click', cutSelected);
    pnl.appendChild(b);
  }
}

'use strict';
/* Ladebalken im Tab ③ (und Kreisel am Reiter): zeigt, dass nach einer Änderung neu geslict wird.
   Phasen: wait (Änderung erkannt, kurze Wartezeit vor dem automatischen Slicen) → slice (OrcaSlicer rechnet; der Balken
   füllt sich nach der erwarteten Dauer – gelernt je Platte aus den letzten Läufen, store.settings.sliceMsPerPlate) →
   preview (Schichtvorschau wird geladen) → done (voll, blendet aus). error blendet sofort aus (die Meldung steht links).
   OrcaSlicer meldet keinen Fortschritt – der Balken ist eine Schätzung, deshalb nie über 95 %, bis das Ergebnis da ist. */
const SB_DEFAULT_MS = 6000, SB_MIN_MS = 1500;
const sb = { phase: null, t0: 0, expected: SB_DEFAULT_MS, plates: 0, timer: 0, raf: 0, note: '' };

function sbExpected(plates) {
  const per = +store.settings.sliceMsPerPlate || SB_DEFAULT_MS;
  return Math.max(SB_MIN_MS, per * Math.max(1, plates));
}
// Dauer eines Laufs merken (gleitender Mittelwert je Platte)
function sbLearn(ms, plates) {
  if (!(ms > 300) || !(plates > 0)) return;
  const per = ms / plates, old = +store.settings.sliceMsPerPlate;
  store.settings.sliceMsPerPlate = Math.round(old > 0 ? old * 0.6 + per * 0.4 : per);
  persist();
}
function sliceBar(phase, opts = {}) {
  clearTimeout(sb.timer);
  const prev = sb.phase;
  sb.phase = phase; sb.note = opts.note || '';
  if (phase === 'slice') { sb.t0 = performance.now(); sb.plates = opts.plates || 1; sb.expected = sbExpected(sb.plates); }
  const bar = $('sliceBar'), busy = phase === 'wait' || phase === 'slice' || phase === 'preview';
  $('sliceSpin').classList.toggle('hidden', !(phase === 'slice' || phase === 'preview'));
  if (!phase || phase === 'error') { bar.classList.add('hidden'); cancelAnimationFrame(sb.raf); sb.raf = 0; sb.phase = null; return; }
  bar.classList.remove('hidden');
  bar.classList.toggle('waiting', phase === 'wait');
  bar.classList.toggle('done', phase === 'done');
  if (phase === 'slice' && prev !== 'slice') $('sliceBarFill').style.width = '0%';
  if (phase === 'done') {
    sbPaint(100, t('Fertig'));
    sb.timer = setTimeout(() => sliceBar(null), 900);
    return;
  }
  if (busy && !sb.raf) sb.raf = requestAnimationFrame(sbTick);
  sbTick();
}
function sbPaint(pct, text) {
  $('sliceBarFill').style.width = pct + '%';
  $('sliceBar').setAttribute('aria-valuenow', String(Math.round(pct)));
  $('sliceBarText').textContent = text;
}
function sbTick() {
  cancelAnimationFrame(sb.raf); sb.raf = 0;
  if (sb.phase === 'wait') { sbPaint(0, t('Änderung erkannt – wird gleich neu geslict …')); }
  else if (sb.phase === 'slice') {
    const el = performance.now() - sb.t0, f = 1 - Math.exp(-1.6 * el / sb.expected);   // nähert sich 95 %, bleibt dort, bis das Ergebnis kommt
    sbPaint(Math.min(95, f * 100), (sb.note || t('Slicen mit OrcaSlicer …')) + ' ' + t('{s} s', { s: Math.floor(el / 1000) }) +
      (el < sb.expected ? ' ' + t('(etwa {s} s)', { s: Math.ceil(sb.expected / 1000) }) : ''));
    sb.raf = requestAnimationFrame(sbTick);
  } else if (sb.phase === 'preview') { sbPaint(97, t('Lade Vorschau …')); }
}

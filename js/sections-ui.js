'use strict';
/* Werkzeuge für das gewählte Teil in der Modellkarte (Tab ①): Platten, Lage, Größe, Mehrfarbig, Bohrlöcher, Beschriftung als
   Reiter – immer genau einer offen, damit die Spalte kurz bleibt (bis 10.8 waren es aufklappbare Abschnitte untereinander).
   Ein Reiter erscheint nur, wenn sein Abschnitt für das Teil da ist (die Abschnitte schalten sich selbst über „hidden“ an/aus);
   im Reiter steht eine Kurzinfo (secSum, z. B. „2 Platten“, „150 %“). Der gewählte Reiter bleibt gemerkt (store.settings.secTab). */
const SECTIONS = { plates: 'plateBox', orient: 'orientBox', size: 'sizeBox', bodies: 'bodyBox', holes: 'holeBox', text: 'textBox' };
const SEC_ORDER = ['plates', 'orient', 'size', 'bodies', 'holes', 'text'];
const SEC_LABEL = { plates: t('Platten'), orient: t('Lage'), size: t('Größe'), bodies: t('Farben'), holes: t('Bohrlöcher'), text: t('Text') };
const secSums = {};

const secAvailable = () => SEC_ORDER.filter(k => { const b = $(SECTIONS[k]); return b && !b.classList.contains('hidden'); });
function secCurrent() {
  const av = secAvailable(), want = store.settings.secTab;
  return av.includes(want) ? want : av[0] || null;
}
// alte Abfrage (js/toolbar-ui.js): ist der Abschnitt gerade zu sehen?
const secOpen = key => secCurrent() === key;

function secInit() {
  const first = $(SECTIONS[SEC_ORDER[0]]);
  if (!first || $('secTabs')) return;
  const bar = document.createElement('div');
  bar.id = 'secTabs'; bar.className = 'sec-tabs hidden'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', t('Werkzeuge für das gewählte Teil'));
  first.before(bar);
  for (const key of SEC_ORDER) {
    const box = $(SECTIONS[key]); if (!box) continue;
    box.dataset.sec = key; box.classList.add('sec'); box.setAttribute('role', 'tabpanel');
    // Abschnitte schalten sich selbst an/aus (hidden) – dann Reiter neu
    new MutationObserver(secRefresh).observe(box, { attributes: true, attributeFilter: ['class'] });
  }
  bar.addEventListener('click', e => { const b = e.target.closest('[data-sec-tab]'); if (b) secSelect(b.dataset.secTab); });
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const av = secAvailable(), i = av.indexOf(secCurrent()), k = av[(i + (e.key === 'ArrowRight' ? 1 : av.length - 1)) % av.length];
    if (k) { secSelect(k); const b = bar.querySelector('[data-sec-tab="' + k + '"]'); if (b) b.focus(); e.preventDefault(); }
  });
  secRefresh();
}
let secBusy = false;
function secRefresh() {
  if (secBusy) return;
  secBusy = true;
  try {
    const bar = $('secTabs'); if (!bar) return;
    const av = secAvailable(), cur = secCurrent();
    bar.classList.toggle('hidden', !av.length);
    bar.innerHTML = av.map(k => {
      const box = $(SECTIONS[k]), title = box.querySelector('.eyebrow[id]'), on = k === cur;
      return '<button type="button" role="tab" data-sec-tab="' + k + '" aria-selected="' + on + '" aria-controls="' + SECTIONS[k] + '" tabindex="' + (on ? 0 : -1) + '" title="' + esc(title ? title.textContent.replace(/\s*·.*$/, '') : '') + '">' +
        esc(SEC_LABEL[k] || k) + '<span class="sec-sum">' + esc(secSums[k] || '') + '</span></button>';
    }).join('');
    for (const k of SEC_ORDER) { const box = $(SECTIONS[k]); if (box) box.classList.toggle('sec-off', k !== cur); }
  } finally { secBusy = false; }
}
function secSelect(key) {
  store.settings.secTab = key; persist();
  secRefresh();
}
// Kurzinfo im Reiter
function secSum(key, text) {
  if ((secSums[key] || '') === (text || '')) return;
  secSums[key] = text || '';
  secRefresh();
}
// alte Aufrufe (js/toolbar-ui.js): Abschnitt zeigen
function secApply(key) { secSelect(key); }
secInit();

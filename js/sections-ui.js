'use strict';
/* Aufklappbare Abschnitte in der Modellkarte (Tab ①): Farben des Designers, Platten, Lage, Mehrfarbig, Bohrlöcher,
   Beschriftung. Der Titel wird ein Knopf mit Pfeil und Kurzinfo (secSum, z. B. „2 Platten“, „keine“); zugeklappt
   bleibt nur die Kopfzeile. Offen/zu je Abschnitt merkt sich das Tool (store.settings.secOpen). */
const SECTIONS = { design: 'designBox', plates: 'plateBox', orient: 'orientBox', size: 'sizeBox', bodies: 'bodyBox', holes: 'holeBox', text: 'textBox' };
const SEC_DEFAULT_OPEN = { design: true, plates: true, orient: true, size: false, bodies: true, holes: true, text: false };
const secOpen = key => { const o = store.settings.secOpen || {}; return key in o ? !!o[key] : SEC_DEFAULT_OPEN[key]; };

function secInit() {
  for (const [key, id] of Object.entries(SECTIONS)) {
    const box = $(id), title = box && box.querySelector('.eyebrow[id]');
    if (!title || box.dataset.sec) continue;
    box.dataset.sec = key; box.classList.add('sec');
    let head = title.closest('.orient-head');
    if (!head) { head = document.createElement('div'); head.className = 'orient-head'; title.replaceWith(head); head.appendChild(title); }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sec-toggle'; btn.setAttribute('aria-controls', id);
    title.replaceWith(btn);
    btn.append(title, Object.assign(document.createElement('span'), { className: 'sec-sum' }));
    btn.addEventListener('click', () => {
      const open = box.classList.contains('collapsed');
      store.settings.secOpen = { ...(store.settings.secOpen || {}), [key]: open }; persist();
      secApply(key);
    });
    secApply(key);
  }
}
function secApply(key) {
  const box = $(SECTIONS[key]); if (!box) return;
  const open = secOpen(key);
  box.classList.toggle('collapsed', !open);
  const btn = box.querySelector('.sec-toggle'); if (btn) btn.setAttribute('aria-expanded', String(open));
}
// Kurzinfo im Titel (auch zugeklappt sichtbar)
function secSum(key, text) {
  const box = $(SECTIONS[key]), el = box && box.querySelector('.sec-sum');
  if (el) el.textContent = text ? ' · ' + text : '';
}
secInit();

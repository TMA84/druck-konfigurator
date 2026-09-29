'use strict';
/* Feste Texte der Seite (index.html) übersetzen – läuft vor allen Modulen, damit sie schon übersetzte Texte vorfinden.
   Einheit ist ein „Block“: ein Element mit eigenem Text, das sonst nur Inline-Elemente enthält (<p>Text <b>fett</b></p>).
   Schlüssel = sein Text (Leerraum zusammengefasst), Wert = englisches innerHTML (mit denselben Inline-Tags und ids).
   Übrige Textknoten einzeln; Attribute title, placeholder, aria-label, alt nach genauem Wert.
   Wörterbuch: js/i18n/en-html.js. I18N.collect() listet alle Blöcke (zum Pflegen des Wörterbuchs). */
(() => {
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'SMALL', 'CODE', 'A', 'SPAN', 'BR', 'KBD', 'SUB', 'SUP', 'ABBR', 'U', 'MARK', 'LABEL']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'svg', 'SVG', 'CANVAS', 'VIDEO']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const hasText = el => [...el.childNodes].some(n => n.nodeType === 3 && /[A-Za-zÄÖÜäöüß]/.test(n.nodeValue));
  const isBlock = el => hasText(el) && [...el.children].every(c => INLINE.has(c.tagName) && !c.querySelector('input,select,textarea,button'));

  function walk(el, fn) {
    if (SKIP.has(el.tagName)) return;
    for (const a of ATTRS) if (el.hasAttribute && el.hasAttribute(a)) fn({ kind: 'attr', el, attr: a, key: norm(el.getAttribute(a)) });
    // erst den Block ersetzen, dann die Attribute seiner (neuen) Inline-Elemente
    if (el !== document.body && isBlock(el)) { fn({ kind: 'block', el, key: norm(el.textContent) }); el.querySelectorAll('*').forEach(c => ATTRS.forEach(a => c.hasAttribute(a) && fn({ kind: 'attr', el: c, attr: a, key: norm(c.getAttribute(a)) }))); return; }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) { if (/[A-Za-zÄÖÜäöüß]/.test(n.nodeValue)) fn({ kind: 'text', node: n, key: norm(n.nodeValue) }); }
      else if (n.nodeType === 1) walk(n, fn);
    }
  }

  I18N.collect = () => {
    const out = new Map();
    walk(document.body, x => { if (x.key && !out.has(x.key)) out.set(x.key, x.kind === 'block' ? norm(x.el.innerHTML) : x.key); });
    document.querySelectorAll('title').forEach(el => out.set(norm(el.textContent), norm(el.textContent)));
    return [...out].map(([key, html]) => ({ key, html }));
  };

  if (I18N.lang === 'de') return;
  document.documentElement.lang = I18N.lang;
  const d = I18N.dict;
  if (d[document.title]) document.title = d[document.title];
  walk(document.body, x => {
    const v = d[x.key]; if (!v || v === x.key) return;   // gleiches Wort (z. B. „Filament“): nichts anfassen
    if (x.kind === 'attr') x.el.setAttribute(x.attr, v);
    else if (x.kind === 'block') {
      // Inline-Elemente mit id (z. B. <span id="matBadge">) müssen erhalten bleiben – sonst nur die Textknoten übersetzen
      const ids = [...x.el.querySelectorAll('[id]')].map(e => e.id);
      if (ids.every(id => v.includes('id="' + id + '"'))) x.el.innerHTML = v;
      else { const tn = [...x.el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim()); if (tn && !/</.test(v)) tn.nodeValue = tn.nodeValue.replace(/\S[\s\S]*\S|\S/, v); }
    }
    else x.node.nodeValue = x.node.nodeValue.replace(/\S[\s\S]*\S|\S/, v);
  });
})();

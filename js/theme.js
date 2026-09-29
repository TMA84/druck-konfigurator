'use strict';
/* Darstellung hell/dunkel: html[data-theme]. Gespeichert als „light“, „dark“ oder „auto“ (folgt dem System).
   Steht im <head>, damit die Seite nicht erst hell aufblitzt. Knöpfe: [data-theme-set], Sprache: [data-lang]. */
(() => {
  const KEY = 'druckKonfigurator.theme', mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const mode = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } };
  const apply = () => { const m = mode(); document.documentElement.dataset.theme = m === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : m; mark(); };
  const mark = () => {
    document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode())));
    if (typeof I18N !== 'undefined') document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === I18N.lang)));
  };
  window.THEME = { set(m) { try { localStorage.setItem(KEY, m); } catch (e) { /* ohne Speicher nur für diese Sitzung */ } apply(); }, mode };
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    mark();
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-theme-set]'); if (t) { THEME.set(t.dataset.themeSet); return; }
      const l = e.target.closest('[data-lang]'); if (l && typeof I18N !== 'undefined' && l.dataset.lang !== I18N.lang) I18N.set(l.dataset.lang);
    });
  });
})();

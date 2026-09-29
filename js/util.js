'use strict';
/* Kleine Helfer, von allen Modulen genutzt (unverändert aus v4). */
const $=id=>document.getElementById(id);
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
/* Sprache (Deutsch/Englisch): t('Deutscher Text {n}', {n: 3}) – der deutsche Text ist der Schlüssel,
   Übersetzungen in js/i18n/en-*.js (I18N.add). Ohne Übersetzung bleibt der deutsche Text; in den Tests (Node)
   ist die Sprache immer Deutsch. Feste Texte der Seite übersetzt js/i18n/dom.js beim Laden. */
const I18N={
  lang:(()=>{try{const s=localStorage.getItem('druckKonfigurator.lang');if(s==='de'||s==='en')return s}catch(e){}
    return typeof navigator!=='undefined'&&navigator.language&&!/^de\b/i.test(navigator.language)?'en':'de'})(),
  dict:Object.create(null),rx:[],
  add(o){Object.assign(this.dict,o)},
  // Muster für Texte mit wechselnden Teilen, v. a. Meldungen des Servers: [[/^Deutsch (.*)$/, 'English $1'], …]
  addRx(list){this.rx.push(...list)},
  set(lang){try{localStorage.setItem('druckKonfigurator.lang',lang)}catch(e){}location.reload()}
};
function t(s,p){let r=s;
  if(I18N.lang!=='de'&&typeof s==='string'){const d=I18N.dict[s];if(d)r=d;else{const m=I18N.rx.find(([re])=>re.test(s));if(m)r=s.replace(m[0],m[1])}}
  if(p)r=r.replace(/\{(\w+)\}/g,(m,k)=>k in p?p[k]:m);return r}
const LOCALE=()=>I18N.lang==='de'?'de-DE':'en-GB';
// Zahl mit d Nachkommastellen im Format der Sprache (Name aus v4: „de“)
function de(v,d){return Number(v).toLocaleString(LOCALE(),{minimumFractionDigits:d,maximumFractionDigits:d})}
const nkey=d=>String(Number(d));
const num=v=>{if(v===null||v===undefined)return NaN;const n=parseFloat(String(v).trim().replace(',','.'));return n};

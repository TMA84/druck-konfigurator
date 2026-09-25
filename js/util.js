'use strict';
/* Kleine Helfer, von allen Modulen genutzt (unverändert aus v4). */
const $=id=>document.getElementById(id);
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function de(v,d){return Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d})}
const nkey=d=>String(Number(d));
const num=v=>{if(v===null||v===undefined)return NaN;const n=parseFloat(String(v).trim().replace(',','.'));return n};

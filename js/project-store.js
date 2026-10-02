'use strict';
/* Das geladene Projekt übersteht ein Neuladen der Seite: nach jeder Änderung (kurz verzögert) wird es in der IndexedDB des
   Browsers gespeichert – Teile mit Netz (origPos), Lage, Slots, Filament und Werte je Teil, Kopien, Platten, Körper,
   Beschriftung, Bohrlöcher und bei Makerworld-3MF die ganze Datei des Designers (für den Export). Abgeleitetes (geom,
   Lochsuche) wird beim Laden neu berechnet. Nur dieser Browser; „Modell entfernen“ löscht den Stand. */
const PS_DB = 'druckKonfigurator', PS_STORE = 'project', PS_KEY = 'current', PS_DELAY_MS = 1200;
let psTimer = 0, psRestoring = false;

function psOpen() {
  return new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') { no(Error('IndexedDB fehlt')); return; }
    const r = indexedDB.open(PS_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(PS_STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function psTx(mode, fn) {
  const db = await psOpen();
  return new Promise((ok, no) => {
    const tx = db.transaction(PS_STORE, mode), st = tx.objectStore(PS_STORE), req = fn(st);
    tx.oncomplete = () => { db.close(); ok(req && req.result); }; tx.onerror = () => { db.close(); no(tx.error); };
  });
}
/* Große, unveränderliche Daten (Netze, Bemalung, Dateien der 3MF) liegen einzeln unter eigener Id und werden nur einmal
   geschrieben; der Stand selbst verweist darauf ({__blob: id}). So kostet eine Änderung nur ein paar Kilobyte. */
const PS_DERIVED = ['geom', 'holeGeom', 'holeCands'];
const psIds = new WeakMap(); let psSeq = 0;
const psBig = v => (ArrayBuffer.isView(v) && v.byteLength > 4096);
function psRef(v, blobs) {
  let id = psIds.get(v);
  if (!id) { id = 'b' + Date.now().toString(36) + '-' + (psSeq++); psIds.set(v, id); }
  blobs.set(id, v);
  return { __blob: id };
}
// Kopie des Stands mit Verweisen statt großer Daten (rekursiv über einfache Objekte und Listen)
function psStrip(v, blobs, depth = 0) {
  if (psBig(v)) return psRef(v, blobs);
  if (depth > 8 || v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return v.map(x => psStrip(x, blobs, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) if (!(depth === 1 && PS_DERIVED.includes(k))) o[k] = psStrip(x, blobs, depth + 1);
  return o;
}
function psFill(v, blobs, depth = 0) {
  if (v && typeof v === 'object' && typeof v.__blob === 'string') return blobs.get(v.__blob);
  if (depth > 8 || v === null || typeof v !== 'object' || ArrayBuffer.isView(v) || v instanceof Set) return v;
  if (Array.isArray(v)) return v.map(x => psFill(x, blobs, depth + 1));
  for (const k of Object.keys(v)) v[k] = psFill(v[k], blobs, depth + 1);
  return v;
}
let psStored = new Set();     // Ids, die schon in der Datenbank liegen
function psSnapshot(blobs) {
  const parts = project.parts.map(p => psStrip(p, blobs, 1));
  return { v: 2, saved: Date.now(), name: project.name, notes: project.notes || [], threemf: project.threemf ? psStrip(project.threemf, blobs, 1) : null,
    platesFixed: !!project.platesFixed, keepSets: project.keepSets !== false, printSeq: project.printSeq || 'layer', selected: project.selected || 0, parts, blobs: [...blobs.keys()] };
}
function scheduleProjectSave() {
  if (psRestoring) return;
  clearTimeout(psTimer);
  psTimer = setTimeout(async () => {
    try {
      if (!project) { await psTx('readwrite', st => st.clear()); psStored = new Set(); return; }
      const blobs = new Map(), snap = psSnapshot(blobs), keep = new Set(snap.blobs);
      await psTx('readwrite', st => {
        for (const [id, v] of blobs) if (!psStored.has(id)) st.put(v, 'blob:' + id);
        for (const id of psStored) if (!keep.has(id)) st.delete('blob:' + id);   // nicht mehr gebraucht (Teil entfernt …)
        return st.put(snap, PS_KEY);
      });
      psStored = keep;
    } catch (e) { console.warn('Projekt nicht gespeichert:', e.message); }
  }, PS_DELAY_MS);
}
async function restoreProject() {
  let snap;
  try { snap = await psTx('readonly', st => st.get(PS_KEY)); } catch (e) { return false; }
  if (!snap || snap.v !== 2 || !snap.parts || !snap.parts.length || project) return false;
  const blobs = new Map();
  try { for (const id of snap.blobs || []) blobs.set(id, await psTx('readonly', st => st.get('blob:' + id))); } catch (e) { return false; }
  if ([...blobs.values()].some(v => v === undefined)) return false;
  for (const [id, v] of blobs) psIds.set(v, id);
  psStored = new Set(blobs.keys());
  snap.parts = psFill(snap.parts, blobs); snap.threemf = snap.threemf && psFill(snap.threemf, blobs);
  psRestoring = true;
  try {
    for (const p of snap.parts) p.geom = partGeom(p);
    showProject({ name: snap.name, parts: snap.parts, threemf: snap.threemf, notes: snap.notes, platesFixed: snap.platesFixed, printSeq: snap.printSeq });
    project.platesFixed = snap.platesFixed;
    project.keepSets = snap.keepSets !== false;
    if (snap.selected && snap.selected < project.parts.length) selectPart(snap.selected);
    toast(t('Projekt „{name}“ wiederhergestellt', { name: snap.name }));
    return true;
  } catch (e) {
    console.warn('Projekt nicht wiederhergestellt:', e);
    project = null;
    return false;
  } finally { psRestoring = false; }
}
// letztes Skript der Seite: alles ist geladen – gespeichertes Projekt wiederherstellen
restoreProject();

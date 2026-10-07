'use strict';
/* Erzeugt docs/Handbuch.pdf aus HANDBUCH.md: kleiner Markdown-Umsetzer (nur was das Handbuch nutzt)
   → docs/handbuch.html → PDF über Chrome headless. Aufruf: node tools/build-handbuch.js
   Chrome-Pfad per CHROME=<Pfad> änderbar (sonst Standardpfad je System, siehe tools/headless.js). */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MD = path.join(ROOT, 'HANDBUCH.md');
const HTML = path.join(ROOT, 'docs', 'handbuch.html');
const PDF = path.join(ROOT, 'docs', 'Handbuch.pdf');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Anker wie GitHub: klein, Satzzeichen weg (Umlaute bleiben), Leerzeichen → "-"
const slug = s => s.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');
function inline(s) {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => '<img alt="' + alt + '" src="' + src.replace(/^docs\//, '') + '">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => '<a href="' + h + '">' + t + '</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

function toHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n'), out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,3}) (.*)$/.exec(l))) { out.push('<h' + m[1].length + ' id="' + slug(m[2]) + '">' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if (/^---+$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.startsWith('> ')) { const b = []; while (i < lines.length && lines[i].startsWith('> ')) b.push(lines[i++].slice(2)); out.push('<blockquote>' + inline(b.join(' ')) + '</blockquote>'); continue; }
    if (l.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      out.push('<table><thead><tr>' + cells(rows[0]).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.slice(2).map(r => '<tr>' + cells(r).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^(\d+\.|-) /.test(l)) {
      // Liste mit einer Unterebene (zwei oder drei Leerzeichen eingerückt)
      const ordered = /^\d+\./.test(l), items = [];
      while (i < lines.length && (/^(\d+\.|-) /.test(lines[i]) || /^ {2,3}(\d+\.|-) /.test(lines[i]))) {
        const li = lines[i++];
        if (/^ {2,3}/.test(li)) (items[items.length - 1].sub = items[items.length - 1].sub || []).push(li.replace(/^ +(\d+\.|-) /, ''));
        else items.push({ text: li.replace(/^(\d+\.|-) /, '') });
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map(it => '<li>' + inline(it.text) + (it.sub ? '<ul>' + it.sub.map(s => '<li>' + inline(s) + '</li>').join('') + '</ul>' : '') + '</li>').join('') + '</' + tag + '>');
      continue;
    }
    const p = []; while (i < lines.length && lines[i].trim() && !/^(#|>|\||---|\d+\. |- )/.test(lines[i])) p.push(lines[i++]);
    out.push('<p>' + inline(p.join(' ')) + '</p>');
  }
  return out.join('\n');
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1b1f24; }
h1 { font-family: Bahnschrift, "Segoe UI", sans-serif; font-size: 24pt; color: #b0440b; margin: 0 0 8pt; }
h2 { font-family: Bahnschrift, "Segoe UI", sans-serif; font-size: 15pt; color: #b0440b; margin: 18pt 0 6pt; border-bottom: 1px solid #d8d4ca; padding-bottom: 3pt; break-after: avoid; }
h2 + * { break-before: avoid; }
hr { display: none; }
p, li { margin: 4pt 0; }
code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 9.5pt; background: #f1eee8; padding: 0 3pt; border-radius: 3px; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #fbe6d9; border-left: 3px solid #b0440b; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #d8d4ca; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f1eee8; }
img { width: 100%; border: 1px solid #d8d4ca; border-radius: 4px; margin: 6pt 0; break-inside: avoid; }
a { color: #b0440b; text-decoration: none; }
`;

const body = toHtml(fs.readFileSync(MD, 'utf8'));
fs.writeFileSync(HTML, '<!doctype html><html lang="de"><meta charset="utf-8"><title>Druckwerkstatt – Handbuch</title><style>' + CSS + '</style><body>' + body + '</body></html>');
console.log('→ ' + path.relative(ROOT, HTML));
// PDF über das DevTools-Protokoll (tools/headless.js): zuverlässig auch am Mac, wo Chrome nach --print-to-pdf
// nicht von selbst endet (2026-09-29)
(async () => {
  const { open } = require('./headless');
  const b = await open();
  try {
    await b.go('file://' + (HTML.startsWith('/') ? '' : '/') + HTML.replace(/\\/g, '/'));
    await new Promise(r => setTimeout(r, 1500));   // Bilder laden
    const pdf = await b.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    fs.writeFileSync(PDF, Buffer.from(pdf.data, 'base64'));
  } finally { b.close(); }
  console.log('→ ' + path.relative(ROOT, PDF) + ' (' + Math.round(fs.statSync(PDF).size / 1024) + ' KB)');
})().catch(e => { console.error(e.message); process.exitCode = 2; });

'use strict';
/* Chrome ohne Fenster fernsteuern (DevTools-Protokoll, ohne Zusatzpakete; braucht Node ≥ 22 wegen WebSocket).
   Eigenes, leeres Chrome-Profil – der Browser des Nutzers bleibt unberührt. Der Server muss laufen (tools/serve.py).
     node tools/headless.js smoke [URL]            Bedientest tests/ui-smoke.js (Standard: …/index.html?alle-drucker)
     node tools/headless.js shot URL DATEI.png [JS] [Wartezeit ms]   Screenshot, vorher JS in der Seite ausführen
     node tools/headless.js eval URL JS            JS ausführen, Ergebnis ausgeben (für eigene Prüfungen)
   Chrome-Pfad per CHROME=…, Fenstergröße per SIZE=1500x950. */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe') : 'google-chrome');
const [W, H] = (process.env.SIZE || '1500x950').split('x').map(Number);
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-headless-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, '--no-first-run',
    '--window-size=' + W + ',' + H, '--lang=de-DE', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let page;
  // auf langsamen CI-Rechnern braucht Chrome beim ersten Start länger – bis 30 s warten
  for (let i = 0; i < 300 && !page && proc.exitCode === null; i++) {
    await sleep(100);
    try { page = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(t => t.type === 'page'); } catch (e) { /* startet noch */ }
  }
  if (!page) {   // Chrome beenden, sonst hält der Kindprozess Node am Leben und der Aufruf endet nie
    proc.kill('SIGKILL');
    throw Error('Chrome startet nicht: ' + CHROME + (proc.exitCode !== null ? ' (beendet mit ' + proc.exitCode + ')' : ''));
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(), events = [];
  let id = 0;
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
  const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; pending.set(i, d => d.error ? no(Error(method + ': ' + d.error.message)) : ok(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expr, timeout = 600000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  // erst warten, bis die neue Seite da ist (sonst läuft JS noch in der alten), dann bis sie fertig geladen hat
  const go = async url => {
    const before = await evaluate('performance.timeOrigin');
    await send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try { if (await evaluate('performance.timeOrigin') !== before && await evaluate('document.readyState') === 'complete') break; } catch (e) { /* lädt */ }
    }
    await sleep(800);
  };
  const close = () => { try { ws.close(); } catch (e) { /* zu */ } proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* Chrome schreibt noch – Temp-Ordner bleibt */ } }, 500); };
  return { send, evaluate, go, close, events };
}

async function main() {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  const base = 'http://127.0.0.1:' + (process.env.KONFIGURATOR_PORT || 8765) + '/';
  const b2 = await open();
  try {
    if (cmd === 'smoke') {
      // der Bedientest prüft deutsche Texte und beginnt mit leerem Speicher
      const url = a || base + 'index.html?alle-drucker';
      await b2.go(url); await b2.evaluate("localStorage.clear(); localStorage.setItem('druckKonfigurator.lang','de'); true"); await b2.go(url);
      const r = await b2.evaluate(`(async()=>{await new Promise(r=>{const s=document.createElement('script');s.src='tests/ui-smoke.js?'+Date.now();s.onload=r;document.head.appendChild(s)});const x=await runSmoke();return {ok:x.log.length,fail:x.fail,errors:x.errors||[]}})()`);
      console.log(r.ok + ' ok, ' + r.fail.length + ' fehlgeschlagen');
      r.fail.forEach(f => console.log('  ' + f));
      process.exitCode = r.fail.length ? 1 : 0;
    } else if (cmd === 'shot') {
      await b2.go(a);
      if (c) await b2.evaluate('(async()=>{' + c + '})()');
      await sleep(+d || 1200);
      const png = await b2.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(b, Buffer.from(png.data, 'base64'));
      console.log('gespeichert: ' + b);
    } else if (cmd === 'eval') {
      await b2.go(a);
      console.log(JSON.stringify(await b2.evaluate('(async()=>{' + b + '})()'), null, 1));
    } else {
      console.log('Aufruf: node tools/headless.js smoke [URL] | shot URL DATEI.png [JS] [ms] | eval URL JS');
    }
  } finally { b2.close(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(2); });
module.exports = { open };

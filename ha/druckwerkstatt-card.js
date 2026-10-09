/* Dashboard-Karte „Druckwerkstatt 3D“ für Home Assistant: 3D-Fortschritt (?ansicht=3d) für jeden Benutzer.
   Eine Webseiten-Karte mit der Ingress-Adresse braucht die Ingress-Sitzung (Cookie ingress_session), die Home Assistant
   nur beim Öffnen des Add-on-Panels anlegt – ohne sie „401 Unauthorized“ (2026-10-09, Benutzer ohne Admin-Rechte).
   Diese Karte legt die Sitzung selbst an (wie das Panel: supervisor/api /ingress/session, auch ohne Admin erlaubt),
   hält sie jede Minute frisch und zeigt die Ansicht darin. Das Add-on legt die Datei bei jedem Start unter
   /local/druckwerkstatt/ ab. Karte:
     type: custom:druckwerkstatt-card
     aspect_ratio: 80%            # optional, Höhe zur Breite (Standard 56%)
     slug: d761c650_druck_konfigurator   # optional */
const DW_SLUG = 'd761c650_druck_konfigurator';
const DW_KEEPALIVE_MS = 60000;

class DruckwerkstattCard extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({ slug: DW_SLUG, aspect_ratio: '56%' }, config || {});
    if (this._frame) this._layout();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._frame) this._build();
    if (!this._started && this.isConnected) this._start();
  }
  connectedCallback() { if (this._hass && !this._started) this._start(); }
  disconnectedCallback() { clearInterval(this._timer); this._started = false; }
  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 6, min_rows: 3 }; }
  static getStubConfig() { return { aspect_ratio: '56%' }; }

  _build() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{display:block;height:100%}ha-card{overflow:hidden;height:100%}.box{position:relative;box-sizing:border-box;width:100%;height:100%;min-height:100%}'
      + 'iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#14161a}'
      + '.msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;color:var(--secondary-text-color)}</style>'
      + '<ha-card><div class="box"><iframe title="Druckwerkstatt 3D" allow="fullscreen"></iframe><div class="msg">Druckwerkstatt wird geladen …</div></div></ha-card>';
    this._box = root.querySelector('.box'); this._frame = root.querySelector('iframe'); this._msg = root.querySelector('.msg');
    this._layout();
    // iOS übernimmt eine spätere Größenänderung der Kachel nicht in die eingebettete Seite – feste Pixelgröße setzen
    // und die Seite (gleicher Ursprung) neu messen lassen
    new ResizeObserver(() => this._fit()).observe(this._box);
  }
  _fit() {
    const w = this._box.clientWidth, h = this._box.clientHeight;
    if (!w || !h) return;
    // CSS-Zoom der Oberfläche (z. B. lovelace-global-mod „zoom-drawer“: home-assistant-main { zoom: 0.75 }) für die
    // eingebettete Seite aufheben – iOS rechnet ihn doppelt, die 3D-Ansicht blieb bei 75 % der Kachel (2026-10-09)
    const z = this._zoom();
    this._frame.style.zoom = z === 1 ? '' : String(1 / z);
    this._frame.style.width = (w * z) + 'px'; this._frame.style.height = (h * z) + 'px';
    try { this._frame.contentWindow.dispatchEvent(new Event('resize')); } catch (e) { /* noch nicht geladen */ }
  }
  _zoom() {
    let z = 1;
    for (let n = this._box; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
      const v = n.nodeType === 1 && n !== this._frame ? parseFloat(getComputedStyle(n).zoom) : 1;
      if (v > 0 && v !== 1) z *= v;
    }
    return z;
  }
  _layout() {
    // Höhe aus dem Seitenverhältnis, aber mindestens die ganze Kachel (min-height 100 %, greift nur bei fester Kachelhöhe
    // wie in Abschnitten) – auf dem Handy ist die Kachel höher als 80 % der schmalen Breite (2026-10-09)
    const r = String(this._config.aspect_ratio || '').trim();
    this._box.style.height = ''; this._box.style.paddingTop = '';
    if (r) { this._box.style.height = '0'; this._box.style.paddingTop = /%$/.test(r) ? r : (parseFloat(r) * 100) + '%'; }
  }
  _ws(endpoint, method, data) {
    return this._hass.callWS(Object.assign({ type: 'supervisor/api', endpoint, method: method || 'get' }, data ? { data } : {}));
  }
  _cookie(session) {
    document.cookie = 'ingress_session=' + session + ';path=/api/hassio_ingress/;SameSite=Strict' + (location.protocol === 'https:' ? ';Secure' : '');
  }
  async _session() {
    const res = await this._ws('/ingress/session', 'post');
    this._sid = res.session; this._cookie(res.session);
  }
  async _start() {
    this._started = true;
    clearInterval(this._timer);
    try {
      const info = await this._ws('/addons/' + this._config.slug + '/info');
      if (!info.ingress_url) throw Error('Das Add-on hat keinen Ingress');
      await this._session();
      const src = info.ingress_url + '?ansicht=3d';
      if (this._frame.getAttribute('src') !== src) { this._frame.onload = () => this._fit(); this._frame.setAttribute('src', src); }
      this._msg.style.display = 'none';
      this._timer = setInterval(() => this._keep(), DW_KEEPALIVE_MS);
    } catch (e) {
      this._started = false;
      this._msg.style.display = '';
      this._msg.textContent = 'Druckwerkstatt nicht erreichbar: ' + ((e && (e.message || e.code)) || e) + ' – nächster Versuch in 30 s';
      setTimeout(() => { if (this.isConnected && !this._started) this._start(); }, 30000);
    }
  }
  async _keep() {
    try { await this._ws('/ingress/validate_session', 'post', { session: this._sid }); }
    catch (e) { try { await this._session(); } catch (e2) { /* nächste Minute */ } }
  }
}
if (!customElements.get('druckwerkstatt-card')) customElements.define('druckwerkstatt-card', DruckwerkstattCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === 'druckwerkstatt-card'))
  window.customCards.push({ type: 'druckwerkstatt-card', name: 'Druckwerkstatt 3D', description: '3D-Fortschritt des Druckers – auch für Benutzer ohne Admin-Rechte' });

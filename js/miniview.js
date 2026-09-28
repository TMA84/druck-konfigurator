'use strict';
/* Kleine 3D-Vorschau in der Modell-Spalte: zeigt das gewählte Teil in seiner aktuellen Lage auf dem Bett,
   eingefärbt wie die große 3D-Ansicht (Bett/Überhang). Bewusst schlank: eigener Renderer, gezeichnet wird
   nur bei Änderungen (kein Dauer-Loop), keine Werkzeuge. */
const MiniView = (() => {
  const COLORS = { bed: [.60, .66, .74], over: [.90, .32, .31], near: [.95, .71, .24], ok: [.25, .66, .96] };
  let renderer = null, scene, camera, controls, host, mesh = null, grid = null, geomRef = null;

  const available = () => typeof THREE !== 'undefined' && !!THREE.OrbitControls;
  const render = () => { if (renderer) renderer.render(scene, camera); };

  function init(el) {
    host = el;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1e1e);
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.0));
    const d = new THREE.DirectionalLight(0xffffff, 0.55); d.position.set(1, -1, 2); scene.add(d);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', render);
    new ResizeObserver(resize).observe(host);
    resize();
  }

  function resize() {
    if (!renderer) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    render();
  }

  function dispose() {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
  }

  // Teil wie auf dem Bett: XY-Mitte, Unterkante auf z = 0
  function show(geom) {
    if (!renderer) return;
    dispose();
    geomRef = geom;
    const cx = (geom.mn[0] + geom.mx[0]) / 2, cy = (geom.mn[1] + geom.mx[1]) / 2, cz = geom.mn[2];
    const p = new Float32Array(geom.pos.length);
    for (let i = 0; i < p.length; i += 3) { p[i] = geom.pos[i] - cx; p[i + 1] = geom.pos[i + 1] - cy; p[i + 2] = geom.pos[i + 2] - cz; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.length), 3));
    g.computeVertexNormals();
    mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .05, flatShading: true, side: THREE.DoubleSide }));
    scene.add(mesh);
    const size = Math.max(geom.x, geom.y, geom.z) || 10;
    const span = Math.ceil(Math.max(geom.x, geom.y) * 1.4 / 10) * 10 || 20;
    grid = new THREE.GridHelper(span, Math.max(4, span / 10), 0x555555, 0x333333);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    camera.position.set(size * 1.6, -size * 1.9, size * 0.35); // eher flach, damit Überhänge an der Unterseite sichtbar sind
    camera.near = size / 100; camera.far = size * 60; camera.updateProjectionMatrix();
    controls.target.set(0, 0, geom.z / 2); controls.update();
    render();
  }

  let paint = null, lastTh = 45;
  function colorize(th) {
    lastTh = th;
    if (!mesh || !geomRef) return;
    const geom = geomRef, c = mesh.geometry.attributes.color.array;
    for (let i = 0; i < geom.n; i++) {
      const a = geom.ang[i], inner = geom.hidden && geom.hidden[i] > 0.5;
      const col = geom.bed[i] ? COLORS.bed : inner ? COLORS.ok : a > th ? COLORS.over : (a > th * .6 && a > 0) ? COLORS.near : COLORS.ok;
      for (let v = 0; v < 3; v++) { const k = (i * 3 + v) * 3; c[k] = col[0]; c[k + 1] = col[1]; c[k + 2] = col[2]; }
    }
    // Körperfarben (Mehrfarbdruck) überdecken die Überhangfarben: [{start, count, rgb:[r,g,b]}]
    if (paint) for (const b of paint) for (let i = b.start; i < b.start + b.count && i < geom.n; i++)
      for (let v = 0; v < 3; v++) { const k = (i * 3 + v) * 3; c[k] = b.rgb[0]; c[k + 1] = b.rgb[1]; c[k + 2] = b.rgb[2]; }
    mesh.geometry.attributes.color.needsUpdate = true;
    render();
  }
  function setPaint(p) { paint = p && p.length ? p : null; colorize(lastTh); }

  function clear() { dispose(); geomRef = null; render(); }

  return { available, init, show, colorize, clear, setPaint };
})();

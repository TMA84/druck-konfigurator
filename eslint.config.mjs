/* Statische Prüfung (CI-Job „lint“, lokal: npm ci && npx eslint .).
 *
 * Die Seite lädt js/*.js als klassische <script>-Tags (index.html) – alle Dateien teilen sich EINEN globalen
 * Gültigkeitsbereich: was eine Datei auf oberster Ebene deklariert (function/const/let/var/class), sehen alle anderen.
 * Damit no-undef trotzdem greift, sammelt diese Datei beim Start selbst die obersten Deklarationen aller Seitendateien
 * (espree, derselbe Parser wie ESLint) – keine gepflegte Namensliste, keine erzeugte Datei, kein Zusatzschritt in der CI.
 * Neue Funktion in js/foo.js → sofort in allen anderen Dateien bekannt; Tippfehler oder ein Name, den es nirgends gibt
 * (z. B. eine lokale Variable einer anderen Funktion), → Fehler.
 *
 * Jede Datei bekommt die Namen der ANDEREN Dateien als Globals. no-redeclare mit builtinGlobals meldet dadurch auch
 * dieselbe oberste Deklaration in zwei Dateien (im Browser: SyntaxError bei let/const, stilles Überschreiben bei function).
 * const/class der anderen Dateien sind schreibgeschützt (no-global-assign → im Browser TypeError), let/var/function beschreibbar.
 *
 * js/nest-worker.js läuft als Web Worker (importScripts('nest.js')) und sieht nur nest.js.
 * js/orca-printers/*.js sind erzeugte Daten (tools/build-orca-printers.js) – nicht geprüft, ihre Namen zählen aber mit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';
import globals from 'globals';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Bibliotheken aus vendor/ (index.html): three.min.js, OrbitControls.js (hängt an THREE), fflate.min.js, mpegts.min.js
const VENDOR = { THREE: 'readonly', fflate: 'readonly', mpegts: 'readonly' };

const listJs = dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => dir + '/' + f);
const PAGE_FILES = [...listJs('js'), ...listJs('js/i18n'), ...listJs('js/orca-printers')]
  .filter(f => f !== 'js/nest-worker.js');

function patternNames(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => patternNames(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(q => patternNames(q, out));
  else if (p.type === 'RestElement') patternNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
  return out;
}

/** oberste Deklarationen einer Datei → { name: 'readonly' | 'writable' } */
function topLevel(file) {
  const ast = espree.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
  const out = {};
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration') out[n.id.name] = 'writable';   // Tests ersetzen Funktionen durch Attrappen
    else if (n.type === 'ClassDeclaration') out[n.id.name] = 'readonly';
    else if (n.type === 'VariableDeclaration')
      for (const d of n.declarations) for (const name of patternNames(d.id, [])) out[name] = n.kind === 'const' ? 'readonly' : 'writable';
  }
  return out;
}

const DECLS = Object.fromEntries(PAGE_FILES.map(f => [f, topLevel(f)]));
// window.THEME = … (js/theme.js) – einzige Eigenschaft, die als globaler Name gesetzt wird
const PAGE_EXTRA = { THEME: 'readonly' };
const othersOf = file => {
  const g = {};
  for (const [f, d] of Object.entries(DECLS)) if (f !== file) Object.assign(g, d);
  return g;
};
const ALL_PAGE = othersOf(null);

const RULES = {
  // typeof: auch „typeof foo === 'function'“-Weichen prüfen – ein umbenannter Name schaltet sonst still eine Funktion ab
  'no-undef': ['error', { typeof: true }],
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-redeclare': ['error', { builtinGlobals: true }],
  'no-global-assign': 'error',
  'no-func-assign': 'error',
  'no-const-assign': 'error',
  'no-import-assign': 'error',
  'no-obj-calls': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-unsafe-negation': 'error',
  'no-compare-neg-zero': 'error',
  // weitere Regeln, die nur echte Fehler melden (beim Einführen ohne Treffer – schützen vor Rückfällen)
  'no-unsafe-finally': 'error',
  'no-loss-of-precision': 'error',
  'no-fallthrough': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-self-compare': 'error',
  'no-constant-binary-expression': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-invalid-regexp': 'error',
  'no-empty-pattern': 'error',
  'getter-return': 'error',
  'no-setter-return': 'error',
  'no-async-promise-executor': 'error',
  'no-template-curly-in-string': 'warn',
};

const node = { ...globals.node };

export default [
  { ignores: ['vendor/**', 'docs/**', 'node_modules/**', 'js/orca-printers/**', '.claude/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  // Seitendateien: jede Datei mit den Namen der übrigen als Globals (siehe oben)
  ...PAGE_FILES.filter(f => !f.startsWith('js/orca-printers/')).map(f => ({
    files: [f],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, ...VENDOR, ...PAGE_EXTRA, ...othersOf(f) },
    },
    rules: {
      ...RULES,
      // Top-Level-Funktionen werden aus anderen Dateien oder aus HTML-Attributen aufgerufen → nur lokale Variablen melden
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', vars: 'local', varsIgnorePattern: '^_' }],
    },
  })),

  // js/import-worker.js: Web Worker mit denselben Parsern wie die Seite (importScripts util/stl/paint/import + fflate)
  { files: ['js/import-worker.js'], languageOptions: { globals: { ...globals.worker } } },

  {
    files: ['js/nest-worker.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.worker, ...DECLS['js/nest.js'] },
    },
    // lexLess usw. stehen für nest.js bereit (im Fenster kommen sie aus export3mf.js)
    rules: { ...RULES, 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', vars: 'local' }] },
  },

  // Home-Assistant-Karte: eigenständiges Skript im HA-Frontend
  {
    files: ['ha/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: globals.browser },
    rules: RULES,
  },

  // tests/ui-smoke.js läuft in der Seite (tools/headless.js smoke)
  {
    files: ['tests/ui-smoke.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, ...VENDOR, ...PAGE_EXTRA, ...ALL_PAGE },
    },
    rules: { ...RULES, 'no-redeclare': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', vars: 'local' }] },
  },

  // Node-Skripte (CommonJS; viele Tests laden js/*.js per vm in einen eigenen Kontext)
  {
    files: ['tests/**/*.js', 'tools/**/*.js'],
    ignores: ['tests/ui-smoke.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: node },
    rules: { ...RULES, 'no-redeclare': 'error' },
  },

  {
    files: ['eslint.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: node },
    rules: RULES,
  },
];

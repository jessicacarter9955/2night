// Patch the generated HaxeFlixel runtime *inside its closure* at build time.
// No server process is needed by the 2Night runtime inspector or navigator.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const compiled = path.join(root, 'public', 'games', 'friday-night-funkin', 'Funkin.js');
const entrypoint = 'ApplicationMain.main();';

const extensions = [
  ['scripts/haxeflixel-inspector.inject.js', 'function _2nightNativeDrawInspector()'],
  ['scripts/fnf-screen-navigator.inject.js', 'function _2nightScreenNavigator()'],
  ['scripts/fnf-animation-workbench.inject.js', 'function _2nightFNFAnimationWorkbench()'],
];

let source = fs.readFileSync(compiled, 'utf8');
const first = source.indexOf(entrypoint);
const last = source.lastIndexOf(entrypoint);
if (first < 0 || first !== last) {
  throw new Error('Cannot safely instrument Funkin.js: unique entrypoint missing');
}
let updates = 0;
for (const [filename, signature] of extensions) {
  if (source.includes(signature)) {
    console.log('[2Night] Already installed:', filename);
    continue;
  }
  const bridge = fs.readFileSync(path.join(root, filename), 'utf8');
  source = source.replace(entrypoint, bridge + '\n' + entrypoint);
  updates++;
  console.log('[2Night] Installed runtime bridge:', filename);
}
if (updates) fs.writeFileSync(compiled, source, 'utf8');

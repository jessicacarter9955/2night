// Node/Vercel build-time instrumentation. Does not ship any extra backend.
// The renderer is generated Haxe code inside a closure; code injected here
// can access FlxSprite.drawSimple/drawComplex, unlike external page scripts.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const compiled = path.join(root, 'public', 'games', 'friday-night-funkin', 'Funkin.js');
const bridge = path.join(root, 'scripts', 'haxeflixel-inspector.inject.js');
const anchor = 'ApplicationMain.main();';
const signature = 'function _2nightNativeDrawInspector()';

const input = fs.readFileSync(compiled, 'utf8');
if (input.includes(signature)) {
  console.log('[2Night] HaxeFlixel runtime bridge already installed');
} else {
  const first = input.indexOf(anchor);
  const last = input.lastIndexOf(anchor);
  if (first < 0 || first !== last) {
    throw new Error('Cannot safely instrument Funkin.js: unique application entrypoint missing');
  }
  const code = fs.readFileSync(bridge, 'utf8');
  const output = input.slice(0, first) + '\n' + code + '\n' + input.slice(first);
  fs.writeFileSync(compiled, output, 'utf8');
  console.log('[2Night] Native HaxeFlixel draw inspector installed');
}

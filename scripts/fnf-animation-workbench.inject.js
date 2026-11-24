// FNF/HaxeFlixel-specific animation adapter. Injected inside Funkin.js closure.
// Keeps all timeline operations local to the actual running game.
(function _2nightFNFAnimationWorkbench() {
  if (typeof window === 'undefined' || window.__2nightAnimation) return;
  var snapshots = new Map();
  var sceneFrozen = false;

  function spriteById(id) {
    return window.__2nightDrawInspector &&
      window.__2nightDrawInspector.getSprite(id);
  }

  function getFrameName(sprite, index) {
    var frames = sprite.frames && sprite.frames.frames;
    var frame = frames && frames[index];
    return frame && frame.name || '';
  }

  function getClipFrames(sprite, animation) {
    if (!animation || !Array.isArray(animation.frames)) return [];
    return animation.frames.map(function(index, i) {
      return {
        position: i,
        index: index,
        name: getFrameName(sprite, index)
      };
    });
  }

  function inspect(id) {
    var sprite = spriteById(id);
    if (!sprite) return null;
    var controller = sprite.animation;
    var all = controller && controller._animations && controller._animations.h || {};
    var current = controller && controller._curAnim;
    var clips = [];
    Object.keys(all).forEach(function(name) {
      var animation = all[name];
      if (!animation || !Array.isArray(animation.frames)) return;
      clips.push({
        name: animation.name || name,
        frameRate: animation.frameRate || 0,
        looped: !!animation.looped,
        current: animation === current,
        frames: getClipFrames(sprite, animation)
      });
    });
    clips.sort(function(a, b) {
      return Number(b.current) - Number(a.current) ||
        a.name.localeCompare(b.name);
    });

    var graphic = sprite.graphic || {};
    return {
      id: String(id),
      gameId: 'friday-night-funkin',
      engine: 'haxeflixel',
      className: sprite.__class__ && sprite.__class__.__name__ || 'FlxSprite',
      atlas: String(graphic.key || ''),
      graphicWidth: graphic.width || 0,
      graphicHeight: graphic.height || 0,
      frame: sprite.frame && sprite.frame.name || '',
      activeClip: current && current.name || '',
      currentPosition: current ? current.curFrame : 0,
      paused: !!(current && current.paused),
      sceneFrozen: sceneFrozen,
      clips: clips
    };
  }

  function pauseScene() {
    if (sceneFrozen) return;
    sceneFrozen = true;
    flixel_FlxG.vcr.paused = true;
    flixel_FlxG.sound.pause();
  }

  function resumeScene() {
    if (!sceneFrozen) return;
    sceneFrozen = false;
    flixel_FlxG.vcr.paused = false;
    flixel_FlxG.sound.resume();
  }

  function control(id, action, opts) {
    opts = opts || {};
    var sprite = spriteById(id);
    if (!sprite) return {ok:false,error:'Sprite non più presente nella scena'};
    var controller = sprite.animation;
    if (!controller) return {ok:false,error:'Questo oggetto non ha un controller di animazione'};
    try {
      if (action === 'freeze') pauseScene();
      else if (action === 'unfreeze') resumeScene();
      else if (action === 'seek') {
        var name = String(opts.name || controller._curAnim && controller._curAnim.name || '');
        var clip = controller.getByName(name);
        if (!clip) return {ok:false,error:'Animazione non trovata: ' + name};
        var position = Math.max(0, Math.min(
          clip.frames.length - 1, Number(opts.position) | 0
        ));
        // Freeze state first, then seek the exact original Haxe animation.
        pauseScene();
        controller.play(name, true, false, position);
        controller.pause();
      } else if (action === 'playClip') {
        var clipName = String(opts.name || '');
        if (!controller.getByName(clipName)) {
          return {ok:false,error:'Animazione non trovata: ' + clipName};
        }
        controller.play(clipName, true, false, 0);
        resumeScene();
      } else if (action === 'pauseClip') {
        controller.pause();
      } else {
        return {ok:false,error:'Comando non supportato'};
      }
      return {ok:true,data:inspect(id)};
    } catch (e) {
      return {ok:false,error:String(e && e.message || e)};
    }
  }

  function applyAtlas(id, dataUrl) {
    return new Promise(function(resolve) {
      var sprite = spriteById(id);
      if (!sprite || !sprite.graphic) {
        resolve({ok:false,error:'Sprite non presente nella scena'});
        return;
      }
      var graphic = sprite.graphic;
      var key = graphic.key || '__unknown';
      var old = snapshots.get(key);
      if (!old) snapshots.set(key, {graphic:graphic,bitmap:graphic.bitmap});
      var img = new Image();
      img.onerror = function() {
        resolve({ok:false,error:'Immagine anteprima non caricabile'});
      };
      img.onload = function() {
        try {
          if (img.width !== graphic.width || img.height !== graphic.height) {
            resolve({ok:false,error:'Dimensioni atlante diverse dall’originale'});
            return;
          }
          var canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          var bitmap = openfl_display_BitmapData.fromCanvas(canvas);
          if (!bitmap) throw new Error('BitmapData non disponibile');
          graphic.set_bitmap(bitmap);
          resolve({ok:true,key:key,method:'FlxGraphic.set_bitmap'});
        } catch(e) {
          resolve({ok:false,error:String(e && e.message || e)});
        }
      };
      img.src = dataUrl;
    });
  }

  function restoreAtlas(id) {
    var sprite = spriteById(id);
    if (!sprite || !sprite.graphic) return {ok:false,error:'Sprite non presente'};
    var key = sprite.graphic.key || '__unknown';
    var old = snapshots.get(key);
    if (!old) return {ok:true,unchanged:true};
    try {
      old.graphic.set_bitmap(old.bitmap);
      snapshots.delete(key);
      return {ok:true};
    } catch(e) {
      return {ok:false,error:String(e && e.message || e)};
    }
  }

  window.__2nightAnimation = {
    version: 1,
    inspect: inspect,
    control: control,
    applyAtlas: applyAtlas,
    restoreAtlas: restoreAtlas,
    sceneFrozen: function(){return sceneFrozen;},
    release: resumeScene
  };
})();

// Injected inside Funkin.js Haxe closure before ApplicationMain.main().
// Real scene objects, not image matching. Keep this in-engine bridge synchronous.
(function _2nightNativeDrawInspector() {
  if (typeof window === 'undefined' || window.__2nightDrawInspector) return;
  var proto = flixel_FlxSprite.prototype;
  var originalSimple = proto.drawSimple;
  var originalComplex = proto.drawComplex;
  var records = new Map();
  var identities = new WeakMap();
  var nextId = 1;
  var sequence = 0;
  var sampleCount = 0;
  var errors = 0;

  function number(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function getCorners(matrix, width, height) {
    var p = [[0, 0], [width, 0], [width, height], [0, height]];
    return p.map(function(pair) {
      return {
        x: matrix.a * pair[0] + matrix.c * pair[1] + matrix.tx,
        y: matrix.b * pair[0] + matrix.d * pair[1] + matrix.ty
      };
    });
  }

  function record(sprite, camera, complex) {
    if (!sprite || sprite.alpha <= 0 || !sprite.visible || !sprite.exists) return;
    var frame = sprite._frame || sprite.frame;
    if (!frame) return;
    var frameRect = frame.frame || {};
    var width = number(frameRect.width, number(sprite.frameWidth, number(sprite.width, 0)));
    var height = number(frameRect.height, number(sprite.frameHeight, number(sprite.height, 0)));
    if (width <= 0 || height <= 0) return;

    var corners = complex && sprite._matrix
      ? getCorners(sprite._matrix, width, height)
      : (function() {
          var p = sprite._point || {x: sprite.x || 0, y: sprite.y || 0};
          return [
            {x: p.x, y: p.y},
            {x: p.x + width, y: p.y},
            {x: p.x + width, y: p.y + height},
            {x: p.x, y: p.y + height}
          ];
        })();

    var xs = corners.map(function(p) { return p.x; });
    var ys = corners.map(function(p) { return p.y; });
    var x = Math.min.apply(null, xs);
    var y = Math.min.apply(null, ys);
    var right = Math.max.apply(null, xs);
    var bottom = Math.max.apply(null, ys);
    if (!isFinite(x + y + right + bottom) ||
        right <= x || bottom <= y || (right - x) * (bottom - y) > 15000000) return;
    var uid = identities.get(sprite);
    if (!uid) { uid = nextId++; identities.set(sprite, uid); }

    var graphics = sprite.graphic || {};
    var frames = sprite.frames || {};
    var assetKey = graphics.key || (frames.parent && frames.parent.key) || '';
    var frameName = frame.name || '';
    var className = (sprite.__class__ && sprite.__class__.__name__) ||
      (sprite.constructor && sprite.constructor.__name__) || 'FlxSprite';
    var anim = sprite.animation && sprite.animation._curAnim;
    var animName = anim && (anim.name || anim._name) || '';
    var cameraInfo = camera || {};
    records.set(uid, {
      id: 'flx:' + uid,
      engine: 'openfl',
      name: String(frameName || className),
      className: String(className),
      source: String(assetKey),
      frame: String(frameName),
      animation: String(animName),
      x: x, y: y, w: right - x, h: bottom - y,
      worldX: number(sprite.x, x), worldY: number(sprite.y, y),
      scaleX: number(sprite.scale && sprite.scale.x, 1),
      scaleY: number(sprite.scale && sprite.scale.y, 1),
      angle: number(sprite.angle, 0),
      alpha: number(sprite.alpha, 1),
      originX: number(sprite.origin && sprite.origin.x, 0),
      originY: number(sprite.origin && sprite.origin.y, 0),
      cameraX: number(cameraInfo.x, 0), cameraY: number(cameraInfo.y, 0),
      order: ++sequence,
      lastSeen: performance.now(),
      sourceType: 'actual draw call'
    });
    sampleCount++;
  }

  proto.drawSimple = function(camera) {
    var result = originalSimple.call(this, camera);
    try { record(this, camera, false); } catch (e) { errors++; }
    return result;
  };
  proto.drawComplex = function(camera) {
    var result = originalComplex.call(this, camera);
    try { record(this, camera, true); } catch (e) { errors++; }
    return result;
  };

  window.__2nightDrawInspector = {
    version: 1,
    engine: 'openfl',
    read: function() {
      var now = performance.now();
      var fresh = [];
      records.forEach(function(item, key) {
        if (now - item.lastSeen > 900) records.delete(key);
        else fresh.push(item);
      });
      fresh.sort(function(a,b) {return a.order - b.order;});
      var currentState = flixel_FlxG.game && flixel_FlxG.game._state;
      return {
        items: fresh.slice(-800),
        screen: currentState && (
          (currentState.__class__ && currentState.__class__.__name__) ||
          (currentState.constructor && currentState.constructor.__name__)
        ) || 'OpenFL',
        activeDrawCalls: sampleCount,
        errors: errors,
        canvasW: (flixel_FlxG.width || 1280),
        canvasH: (flixel_FlxG.height || 720)
      };
    }
  };
})();

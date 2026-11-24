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
  var lastState = null;
  var lastReadDrawCalls = 0;

  function getState() {
    return flixel_FlxG.game && flixel_FlxG.game._state || null;
  }

  // The FlxGame renderer stops drawing when the iframe loses focus.
  // Keep the last visible draw records in that case: the pixels are
  // still present on the canvas. A new scene must not retain old sprites.
  function syncScene() {
    var current = getState();
    if (current !== lastState) {
      records.clear();
      lastState = current;
      lastReadDrawCalls = sampleCount;
    }
    return current;
  }

  function liveMembers(root) {
    var live = new Set();
    var words = [];
    var visited = new WeakSet();
    var remaining = 5000;
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || visited.has(node) ||
          depth > 12 || remaining-- <= 0 ||
          node.visible === false || node.exists === false) return;
      visited.add(node);
      if (node instanceof flixel_FlxSprite) live.add(node);
      // Alphabet extends FlxTypedSpriteGroup: its letter sprites live in
      // node.group.members rather than directly on node.members.
      if (node.__class__ && node.__class__.__name__ === 'Alphabet' &&
          typeof node.text === 'string' && node.text.trim()) {
        words.push(node);
      }
      if (node.group && node.group !== node) walk(node.group, depth + 1);
      var members = node.members;
      if (Array.isArray(members)) {
        for (var i = 0; i < members.length; i++) walk(members[i], depth + 1);
      }
      if (node._subState) walk(node._subState, depth + 1);
    }
    walk(root, 0);
    return { sprites: live, words: words };
  }

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
    syncScene();
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
    // FlxText and custom text classes often generate a bitmap frame.
    // The user-facing text is the actual node identity.
    var label = typeof sprite.text === 'string' && sprite.text.trim()
      ? sprite.text.trim().slice(0, 120) : '';
    var className = (sprite.__class__ && sprite.__class__.__name__) ||
      (sprite.constructor && sprite.constructor.__name__) || 'FlxSprite';
    var anim = sprite.animation && sprite.animation._curAnim;
    var animName = anim && (anim.name || anim._name) || '';
    var cameraInfo = camera || {};
    records.set(uid, {
      sprite: sprite,
      data: {
      id: 'flx:' + uid,
      engine: 'openfl',
      name: String(label || frameName || className),
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
      sourceType: label ? 'Live FlxText draw call' : 'actual draw call'
      }
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
    // Runtime-only bridge for game-specific animation adapter.
    // The ID is emitted by the native draw inspector. Returned sprite
    // is never serialized or transmitted to a backend.
    getSprite: function(id) {
      var value = String(id || '');
      if (!/^flx:[0-9]+$/.test(value)) return null;
      var entry = records.get(Number(value.substring(4)));
      return entry && entry.sprite || null;
    },
    read: function() {
      var game = flixel_FlxG.game;
      if (game && flixel_FlxG.autoPause) {
        flixel_FlxG.autoPause = false;
        if (game.stage) game.stage.set_frameRate(flixel_FlxG.drawFramerate);
      }
      var now = performance.now();
      var currentState = syncScene();
      var renderedSinceLastRead = sampleCount !== lastReadDrawCalls;
      var active = liveMembers(currentState);
      var fresh = [];
      var bySprite = new WeakMap();
      records.forEach(function(entry, key) {
        var sprite = entry.sprite;
        if (!sprite || sprite.exists === false || sprite.visible === false ||
            sprite.alpha <= 0) {
          records.delete(key);
          return;
        }
        var stillInScene = active.sprites.has(sprite);
        var elapsed = now - entry.data.lastSeen;
        // Do NOT use a wall-clock TTL if the renderer is paused.
        // HaxeFlixel pauses on blur; previously all boxes vanished in 900ms.
        // When drawing resumes, only prune abandoned off-tree objects.
        if (!stillInScene && renderedSinceLastRead && elapsed > 2500) {
          records.delete(key);
          return;
        }
        fresh.push(entry.data);
        bySprite.set(sprite, entry.data);
      });
      // Expose whole rendered words as hover targets. FNF menus implement
      // Tutorial/Bopeebo etc. as Alphabet containers holding AlphaCharacter
      // sprite children. Their box is the union of the *real drawn letters*.
      active.words.forEach(function(group) {
        var children = group.group && group.group.members || [];
        var bounds = [];
        function collect(node, depth) {
          if (!node || depth > 5 || node.visible === false ||
              node.exists === false) return;
          var rect = bySprite.get(node);
          if (rect) bounds.push(rect);
          if (node.group && node.group.members) {
            node.group.members.forEach(function(child) {
              collect(child, depth + 1);
            });
          }
        }
        children.forEach(function(child) { collect(child, 0); });
        if (!bounds.length) return;
        var left = Math.min.apply(null, bounds.map(function(b) { return b.x; }));
        var top = Math.min.apply(null, bounds.map(function(b) { return b.y; }));
        var right = Math.max.apply(null, bounds.map(function(b) { return b.x + b.w; }));
        var bottom = Math.max.apply(null, bounds.map(function(b) { return b.y + b.h; }));
        if (!isFinite(left + top + right + bottom) ||
            right - left < 1 || bottom - top < 1) return;
        var id = identities.get(group);
        if (!id) { id = nextId++; identities.set(group, id); }
        fresh.push({
          id: 'flx:' + id,
          engine: 'openfl',
          name: group.text.trim().slice(0, 140),
          className: 'Alphabet',
          source: 'assets/images/alphabet.png',
          frame: group.text.trim().slice(0, 140),
          animation: '',
          x: left, y: top,
          w: right - left, h: bottom - top,
          worldX: number(group.x, left), worldY: number(group.y, top),
          scaleX: number(group.scale && group.scale.x, 1),
          scaleY: number(group.scale && group.scale.y, 1),
          angle: number(group.angle, 0),
          alpha: number(group.alpha, 1),
          originX: 0, originY: 0,
          order: Math.max.apply(null, bounds.map(function(b) { return b.order; })) + 0.25,
          lastSeen: now,
          sourceType: 'Live Alphabet text group'
        });
      });
      lastReadDrawCalls = sampleCount;
      fresh.sort(function(a,b) { return a.order - b.order; });
      return {
        items: fresh.slice(-800),
        screen: currentState && (
          (currentState.__class__ && currentState.__class__.__name__) ||
          (currentState.constructor && currentState.constructor.__name__)
        ) || 'OpenFL',
        paused: !renderedSinceLastRead,
        activeDrawCalls: sampleCount,
        errors: errors,
        canvasW: (flixel_FlxG.width || 1280),
        canvasH: (flixel_FlxG.height || 720)
      };
    }
  };
})();

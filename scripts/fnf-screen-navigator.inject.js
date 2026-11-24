// Installed inside the compiled HaxeFlixel closure at build time.
// Allows 2Night to navigate real states without artificial key sequences.
(function _2nightScreenNavigator() {
  if (typeof window === 'undefined' || window.__2nightNavigate) return;

  var weekForSong = {
    tutorial: 0,
    bopeebo: 1, fresh: 1, dadbattle: 1,
    spookeez: 2, south: 2, monster: 2,
    pico: 3, philly: 3, blammed: 3,
    'satin-panties': 4, high: 4, milf: 4,
    cocoa: 5, eggnog: 5, 'winter-horrorland': 5,
    senpai: 6, roses: 6, thorns: 6
  };

  function currentState() {
    var game = flixel_FlxG.game;
    var state = game && game._state;
    return state && state.__class__ && state.__class__.__name__ || 'Boot';
  }

  function jump(request) {
    try {
      if (!request || typeof request.id !== 'string') {
        return { ok: false, error: 'Destinazione mancante' };
      }
      var game = flixel_FlxG.game;
      // The editor's controls live outside the game iframe. Clicking them
      // normally triggers HaxeFlixel autoPause, which prevents transitions
      // and makes the switcher appear stuck. Keep the actual game ticking.
      if (flixel_FlxG.autoPause) {
        flixel_FlxG.autoPause = false;
        if (game && game.stage) {
          game.stage.set_frameRate(flixel_FlxG.drawFramerate);
        }
      }
      if (!game || !game._state) {
        return { ok: false, error: 'Il motore non è ancora pronto' };
      }
      var id = request.id;
      var target = null;
      var expect = '';
      var song = '';

      if (id.indexOf('song:') === 0) {
        song = id.substring(5).toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(weekForSong, song)) {
          return { ok: false, error: 'Brano non disponibile: ' + song };
        }
        var difficulty = request.difficulty === 0 ? 0
          : request.difficulty === 2 ? 2 : 1;
        // Native code path used by FreeplayState.handlePlay.
        // LoadingState fetches the chart/music before PlayState begins.
        PlayState.isStoryMode = false;
        PlayState.storyPlaylist = [];
        PlayState.storyWeek = weekForSong[song];
        PlayState.storyDifficulty = difficulty;
        PlayState.SONG = Song.loadFromJson(
          Highscore.formatSong(song, difficulty), song
        );
        target = LoadingState.getNextState(new PlayState(), false);
        expect = 'PlayState';
      } else {
        if (id === 'title') {
          target = new TitleState();
          expect = 'TitleState';
        } else if (id === 'menu') {
          target = new MainMenuState();
          expect = 'MainMenuState';
        } else if (id === 'freeplay') {
          target = new FreeplayState();
          expect = 'FreeplayState';
        } else if (id === 'story') {
          target = new StoryMenuState();
          expect = 'StoryMenuState';
        } else {
          return { ok: false, error: 'Schermata non supportata: ' + id };
        }
        // The menu states assume FlxG.sound.music is initialized, whereas
        // a direct jump from TitleState can precede music initialization.
        if (id !== 'title') {
          flixel_FlxG.sound.playMusic(
            Paths.getPath('music/freakyMenu.mp3', 'MUSIC', null)
          );
        }
      }

      if (game._state.__class__ && game._state.__class__.__name__ === expect &&
          id.indexOf('song:') !== 0) {
        return { ok: true, state: expect, alreadyThere: true };
      }

      // This is the same game-state request mechanism used by FNF itself.
      // Never replace _state directly: let FlxGame run its lifecycle.
      game._requestedState = target;
      return {
        ok: true,
        state: expect,
        loading: target.__class__ &&
          target.__class__.__name__ === 'LoadingState',
        song: song
      };
    } catch (error) {
      console.error('[2Night screen navigator]', error);
      return {
        ok: false,
        error: String(error && error.message || error)
      };
    }
  }

  window.__2nightNavigate = jump;
  window.__2nightGetScene = function() {
    return { state: currentState(), ready: !!(flixel_FlxG.game &&
      flixel_FlxG.game._state) };
  };
})();

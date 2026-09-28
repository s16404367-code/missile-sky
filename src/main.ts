import './styles/main.css';

import { EventBus } from './game/Events';
import { Game } from './game/Game';
import type { GameEventMap } from './game/types';
import { AudioSystem } from './systems/AudioSystem';
import { InputSystem } from './systems/InputSystem';
import { ProgressionSystem } from './systems/ProgressionSystem';
import { SaveSystem } from './systems/SaveSystem';
import { HUD } from './ui/HUD';
import { ScreenUI } from './ui/ScreenUI';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiRoot = document.querySelector<HTMLElement>('#ui');
const fatal = document.querySelector<HTMLElement>('#fatal');

function fail(message: string): void {
  const p = document.querySelector<HTMLElement>('#fatal-text');
  if (p) p.textContent = message;
  if (fatal) fatal.hidden = false;
}

if (!canvas || !uiRoot || !canvas.getContext) {
  fail('This browser does not support the canvas features required by Missile Sky. Please try a recent version of Chrome, Edge, Firefox or Safari.');
} else {
  try {
    const save = new SaveSystem();
    const audio = new AudioSystem();
    const input = new InputSystem();
    const events = new EventBus<GameEventMap>();
    const progression = new ProgressionSystem(save, events);

    // Construct simulation first; UI layers attach through small interfaces.
    const game = new Game({ canvas, save, audio, input, progression, events });
    const hud = new HUD(uiRoot);
    game.hud = hud;
    input.attach(document.body);
    const screens = new ScreenUI(uiRoot, game, input, save, progression);

    // Expose nothing globally; all progress is local to this browser.
    game.applySettings();
    game.resize();
    game.start();

    const onResize = () => game.resize();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    window.addEventListener('pagehide', () => save.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save.flush();
    });

    // Avoid unused binding elimination; Screens owns all DOM event listeners.
    void screens;

    // Recover gracefully from local runtime errors with a user-facing notice.
    window.addEventListener('error', (event) => {
      console.error('[Missile Sky]', event.error ?? event.message);
    });
  } catch (error) {
    console.error('[Missile Sky] Failed to start', error);
    fail('Missile Sky could not start. Please reload the page or try a different browser. Your saved progress has not been modified.');
  }
}

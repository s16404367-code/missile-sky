/**
 * ScreenUI — menus, hangar, upgrades, missions, settings, pause and game-over.
 * Menus are DOM overlays; game rendering continues below them in canvas.
 */

import type { Game } from '../game/Game';
import { GameState, type RunStats } from '../game/types';
import { AIRCRAFT, getAircraft } from '../data/aircraft';
import { MODES } from '../data/modes';
import { MISSIONS } from '../data/missions';
import { ACHIEVEMENTS } from '../data/achievements';
import { UPGRADES } from '../data/upgrades';
import { formatTime } from '../game/util/math';
import type { InputSystem } from '../systems/InputSystem';
import type { ProgressionSystem } from '../systems/ProgressionSystem';
import type { SaveSystem } from '../systems/SaveSystem';
import { VirtualJoystick } from './VirtualJoystick';

function aircraftSvg(id: string): string {
  const a = getAircraft(id);
  const pts = a.outline;
  const upper = pts.map(([x, y]) => `${x},${-y}`).join(' ');
  const lower = [...pts].reverse().map(([x, y]) => `${x},${y}`).join(' ');
  const canopy = a.canopy;
  return `<svg class="aircraft-preview" viewBox="-25 -20 55 40" role="img" aria-label="${a.name} aircraft">
    <defs><linearGradient id="plane-${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a.colors.body}"/><stop offset="1" stop-color="${a.colors.accent}"/></linearGradient></defs>
    <polygon points="${upper} ${lower}" fill="url(#plane-${id})" stroke="rgba(255,255,255,.56)" stroke-width=".7"/>
    <ellipse cx="${canopy[0]}" cy="0" rx="${canopy[2]}" ry="${canopy[3]}" fill="${a.colors.glass}"/>
    <path d="M-17 0 H-22" stroke="${a.colors.trail}" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

export class ScreenUI {
  readonly overlay: HTMLDivElement;
  readonly joystick: VirtualJoystick;
  readonly touchActions: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private current: GameState | null = null;
  private selectedMode = 'normal';
  private previewAircraft: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private root: HTMLElement,
    private game: Game,
    private input: InputSystem,
    private save: SaveSystem,
    private progression: ProgressionSystem,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'screen-overlay';
    this.root.appendChild(this.overlay);

    this.joystick = new VirtualJoystick(this.root, input);
    this.touchActions = document.createElement('div');
    this.touchActions.id = 'touch-actions';
    this.touchActions.innerHTML = `
      <button class="touch-btn touch-boost" type="button" aria-label="Boost" data-action="touch-boost"><span>⇧</span><b>BOOST</b></button>
      <button class="touch-btn touch-shield" type="button" aria-label="Activate shield" data-action="touch-shield"><span>◇</span><b>SHIELD</b></button>
    `;
    this.root.appendChild(this.touchActions);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.toastEl);

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => {
      const select = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-setting="quality"]');
      if (!select) return;
      if (select.value === 'low' || select.value === 'medium' || select.value === 'high') {
        this.save.data.settings.quality = select.value;
        this.save.save();
        this.game.applySettings();
        this.renderSettings();
      }
    });
    this.root.addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="touch-boost"], [data-action="touch-shield"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.action === 'touch-boost') this.input.pressBoost();
      if (btn.dataset.action === 'touch-shield') this.input.pressShield();
      btn.classList.add('pressed');
      btn.setPointerCapture?.(e.pointerId);
    });
    this.root.addEventListener('pointerup', (e) => {
      (e.target as HTMLElement).closest('.touch-btn')?.classList.remove('pressed');
    });
    this.root.addEventListener('pointercancel', (e) => {
      (e.target as HTMLElement).closest('.touch-btn')?.classList.remove('pressed');
    });

    game.hooks.onStateChange = (state) => this.showState(state);
    game.hooks.onGameOver = (stats) => this.renderGameOver(stats);
    game.hooks.onToast = (text) => this.toast(text);
    this.showState(game.state);
    this.syncTouch();
  }

  showState(state: GameState): void {
    this.current = state;
    this.joystick.setEnabled(state === GameState.PLAYING);
    this.touchActions.classList.toggle('visible', state === GameState.PLAYING);
    if (state === GameState.PLAYING) {
      this.overlay.innerHTML = '';
      this.overlay.className = '';
      this.syncTouch();
      return;
    }
    this.overlay.className = 'screen-visible';
    switch (state) {
      case GameState.MENU: this.renderMenu(); break;
      case GameState.PAUSED: this.renderPause(); break;
      case GameState.GAME_OVER: break; // populated after run settlement
      case GameState.HANGAR: this.renderHangar(); break;
      case GameState.UPGRADES: this.renderUpgrades(); break;
      case GameState.MISSIONS: this.renderMissions(); break;
      case GameState.SETTINGS: this.renderSettings(); break;
    }
    this.syncTouch();
  }

  private syncTouch(): void {
    this.joystick.setShowFixed(this.save.data.settings.showJoystick);
    this.joystick.zone.classList.toggle('game-active', this.current === GameState.PLAYING);
  }

  private shell(content: string, extra = ''): void {
    this.overlay.innerHTML = `<section class="screen-card ${extra}" role="dialog" aria-modal="true">${content}</section>`;
  }

  private renderMenu(): void {
    const d = this.save.data;
    const level = this.progression.level;
    const xp = this.progression.xpProgress();
    const activeMode = MODES.find((m) => m.id === this.selectedMode) ?? MODES[0];
    const modeCards = MODES.map((m) => `
      <button class="mode-card ${this.selectedMode === m.id ? 'selected' : ''}" data-action="mode" data-mode="${m.id}" type="button">
        <span class="mode-orbit"></span><b>${m.name}</b><small>${m.desc}</small>
      </button>`).join('');
    this.shell(`
      <div class="menu-layout">
        <div class="menu-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span>OPEN-AIR SURVIVAL · EST. 2026</div>
          <h1 class="game-title">MISSILE<br><em>SKY</em><span class="title-mark">✦</span></h1>
          <p class="menu-tagline">The sky is wide. The missiles are not.</p>
          <p class="menu-desc">Fly free. Let them chase. Make them cross.<br>Turn the swarm into fireworks.</p>
          <div class="mode-picker"><div class="section-label">SELECT FLIGHT PLAN</div><div class="mode-grid">${modeCards}</div></div>
          <div class="menu-actions">
            <button class="btn btn-primary btn-launch" data-action="start" type="button"><span>▶</span> LAUNCH <small>${activeMode.name}</small></button>
            <button class="btn btn-ghost" data-action="screen" data-screen="hangar" type="button">✈ HANGAR</button>
            <button class="btn btn-ghost" data-action="screen" data-screen="upgrades" type="button">⚙ UPGRADES</button>
            <button class="btn btn-ghost" data-action="screen" data-screen="missions" type="button">✧ MISSIONS</button>
            <button class="btn btn-icon" data-action="screen" data-screen="settings" type="button" aria-label="Settings">⚙</button>
          </div>
          <div class="menu-footer"><span>WASD / ARROWS TO FLY</span><span>SPACE BOOST · Q SHIELD</span></div>
        </div>
        <aside class="menu-side">
          <div class="pilot-card">
            <div class="pilot-art"><div class="radar-ring ring-a"></div><div class="radar-ring ring-b"></div>${aircraftSvg(d.selectedAircraft)}<span class="pilot-spark">✦</span></div>
            <div class="pilot-meta"><small>YOUR AIRCRAFT</small><strong>${getAircraft(d.selectedAircraft).name}</strong><span>LVL ${level} PILOT</span></div>
          </div>
          <div class="progress-card"><div class="progress-top"><span>PILOT LEVEL</span><b>${level}</b></div><div class="progress-track"><i style="width:${Math.round(xp.pct * 100)}%"></i></div><small>${xp.current.toLocaleString()} / ${xp.needed.toLocaleString()} XP</small></div>
          <div class="record-card"><span class="record-icon">◈</span><div><small>PERSONAL BEST</small><strong>${(d.bestScore[this.selectedMode] ?? 0).toLocaleString()}</strong><span>${formatTime(d.bestTime[this.selectedMode] ?? 0)} SURVIVED</span></div></div>
          <div class="sky-quote">“The best defense is making<br>your enemies miss each other.”</div>
          <div class="menu-credit">ALL FLIGHT DATA SAVED ON THIS DEVICE</div>
        </aside>
      </div>
    `, 'menu-screen');
  }

  private renderPause(): void {
    this.shell(`
      <div class="pause-mark">Ⅱ</div><div class="eyebrow">FLIGHT PAUSED</div>
      <h2>TAKE A BREATH.</h2><p class="screen-copy">The missiles can wait. They are very patient.</p>
      <div class="pause-stats"><span>SURVIVED<strong>${formatTime(this.game.world.runTime)}</strong></span><span>SCORE<strong>${this.game.getScore().toLocaleString()}</strong></span><span>THREATS<strong>${this.game.missileMgr.activeCount()}</strong></span></div>
      <button class="btn btn-primary btn-wide" data-action="resume" type="button">▶ RESUME FLIGHT</button>
      <div class="button-row"><button class="btn btn-ghost" data-action="retry" type="button">↻ RESTART</button><button class="btn btn-ghost" data-action="menu" type="button">⌂ QUIT TO MENU</button></div>
      <div class="screen-hint">PRESS P OR ESC TO RESUME</div>
    `, 'compact-screen');
  }

  private renderGameOver(stats: RunStats): void {
    const modeBest = this.progression.bestScore(stats.mode);
    const earnedMissions = stats.missionsCompleted.length;
    this.current = GameState.GAME_OVER;
    this.overlay.className = 'screen-visible';
    this.shell(`
      <div class="gameover-top"><div class="gameover-emblem">✦</div><div><div class="eyebrow">FLIGHT COMPLETE</div><h2>GAME OVER</h2></div></div>
      <div class="gameover-hero"><small>SURVIVAL TIME</small><strong>${formatTime(stats.time)}</strong><span>${stats.newBest ? 'NEW PERSONAL BEST' : `BEST ${formatTime(this.progression.bestTime(stats.mode))}`}</span></div>
      <div class="results-grid">
        <div class="result-cell"><span>SCORE</span><strong>${stats.score.toLocaleString()}</strong><small>${stats.newBest ? '★ NEW BEST' : `BEST ${modeBest.toLocaleString()}`}</small></div>
        <div class="result-cell"><span>MISSILES</span><strong>${stats.missilesDestroyed}</strong><small>DESTROYED</small></div>
        <div class="result-cell"><span>BEST CHAIN</span><strong>×${stats.maxChain}</strong><small>REACTION</small></div>
        <div class="result-cell result-reward"><span>REWARDS</span><strong>◈ ${stats.coinsEarned}</strong><small>+ ${stats.xpEarned} XP${earnedMissions ? ` · ${earnedMissions} MISSION${earnedMissions > 1 ? 'S' : ''}` : ''}</small></div>
      </div>
      <div class="button-row gameover-actions"><button class="btn btn-primary" data-action="retry" type="button">↻ FLY AGAIN</button><button class="btn btn-ghost" data-action="screen" data-screen="hangar" type="button">✈ HANGAR</button><button class="btn btn-ghost" data-action="menu" type="button">⌂ MAIN MENU</button></div>
      <div class="screen-hint">RUN SAVED AUTOMATICALLY · ${stats.mode.toUpperCase()} MODE</div>
    `, 'compact-screen gameover-screen');
  }

  private renderHangar(): void {
    const d = this.save.data;
    const selected = getAircraft(this.previewAircraft ?? d.selectedAircraft);
    const stat = (name: string, value: number, max: number) => `<div class="stat-row"><span>${name}</span><div class="stat-bar"><i style="width:${Math.min(100, value / max * 100)}%"></i></div><b>${Math.round(value)}</b></div>`;
    const unlocked = AIRCRAFT.filter((a) => d.unlockedAircraft.includes(a.id));
    const cards = AIRCRAFT.map((a) => {
      const owned = d.unlockedAircraft.includes(a.id);
      const locked = !owned;
      return `<button class="aircraft-card ${a.id === selected.id ? 'selected' : ''} ${locked ? 'locked' : ''}" type="button" data-action="aircraft" data-aircraft="${a.id}">
        <span class="aircraft-card-art">${aircraftSvg(a.id)}</span><span class="aircraft-card-name">${a.name}</span>
        <small>${owned ? (a.id === d.selectedAircraft ? 'ACTIVE' : 'OWNED') : `◈ ${a.cost}`}</small>
      </button>`;
    }).join('');
    const isOwned = d.unlockedAircraft.includes(selected.id);
    const afford = this.progression.canUnlock(selected).ok;
    const action = isOwned
      ? `<button class="btn ${selected.id === d.selectedAircraft ? 'btn-disabled' : 'btn-primary'} btn-wide" data-action="select-aircraft" data-aircraft="${selected.id}" type="button" ${selected.id === d.selectedAircraft ? 'disabled' : ''}>${selected.id === d.selectedAircraft ? '✓ CURRENT AIRCRAFT' : 'SELECT AIRCRAFT'}</button>`
      : `<button class="btn ${afford ? 'btn-primary' : 'btn-disabled'} btn-wide" data-action="unlock-aircraft" data-aircraft="${selected.id}" type="button" ${afford ? '' : 'disabled'}>◈ UNLOCK · ${selected.cost} COINS${this.progression.level < selected.levelReq ? ` · LVL ${selected.levelReq}` : ''}</button>`;
    this.shell(`
      <div class="screen-heading"><div><div class="eyebrow">FLIGHT DECK · ${unlocked.length} / ${AIRCRAFT.length} AIRCRAFT</div><h2>THE HANGAR</h2></div><div class="currency-pill">◈ <b>${d.coins.toLocaleString()}</b><small>COINS</small></div></div>
      <div class="hangar-layout">
        <div class="aircraft-list">${cards}</div>
        <div class="aircraft-detail">
          <div class="aircraft-big-art"><div class="radar-ring ring-a"></div><div class="radar-ring ring-b"></div>${aircraftSvg(selected.id)}</div>
          <div class="aircraft-heading"><div><span class="eyebrow">${isOwned ? 'READY FOR FLIGHT' : `UNLOCK AT LEVEL ${selected.levelReq}`}</span><h3>${selected.name}</h3></div><span class="aircraft-number">0${AIRCRAFT.indexOf(selected) + 1}</span></div>
          <p class="screen-copy">${selected.desc}</p>
          <div class="aircraft-stats">${stat('SPEED', selected.base.maxSpeed, 420)}${stat('AGILITY', selected.base.turn, 9)}${stat('ACCELERATION', selected.base.accel, 1200)}${stat('SHIELD', selected.base.shieldCharges, 3)}${stat('BOOST', selected.base.boostDuration, 1.8)}</div>
          <div class="passive-note"><span>✧</span><div><small>FLIGHT TRAIT</small><b>${selected.passive}</b></div></div>
          ${action}
        </div>
      </div>
      <div class="screen-bottom"><button class="btn btn-ghost" data-action="back-menu" type="button">← BACK TO FLIGHT DECK</button><span>UPGRADES APPLY TO EVERY AIRCRAFT</span></div>
    `, 'wide-screen hangar-screen');
  }

  private renderUpgrades(): void {
    const d = this.save.data;
    const cards = UPGRADES.map((u) => {
      const lvl = this.progression.upgradeLevel(u.id);
      const cost = this.progression.costFor(u.id);
      const maxed = lvl >= u.maxLevel;
      const canBuy = !maxed && d.coins >= cost;
      const pips = Array.from({ length: u.maxLevel }, (_, i) => `<i class="upgrade-pip ${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<article class="upgrade-card">
        <div class="upgrade-icon">${upgradeIcon(u.id)}</div><div class="upgrade-main"><div class="upgrade-top"><h3>${u.name}</h3><span>LV ${lvl}<small> / ${u.maxLevel}</small></span></div><p>${u.desc}</p><div class="upgrade-bottom"><div class="upgrade-pips">${pips}</div><small>${u.effectText}</small></div></div>
        <button class="btn upgrade-buy ${canBuy ? 'can-buy' : ''}" data-action="upgrade" data-upgrade="${u.id}" type="button" ${canBuy ? '' : 'disabled'}>${maxed ? 'MAX' : `◈ ${cost}`}</button>
      </article>`;
    }).join('');
    this.shell(`
      <div class="screen-heading"><div><div class="eyebrow">PERMANENT FLIGHT MODIFICATIONS</div><h2>UPGRADES</h2></div><div class="currency-pill">◈ <b>${d.coins.toLocaleString()}</b><small>COINS</small></div></div>
      <p class="screen-copy upgrade-intro">Every upgrade changes how your aircraft handles in the sky. Pick a system, invest, then feel the difference.</p>
      <div class="upgrade-grid">${cards}</div>
      <div class="screen-bottom"><button class="btn btn-ghost" data-action="back-menu" type="button">← BACK TO FLIGHT DECK</button><span>LEVELS ARE SAVED AUTOMATICALLY</span></div>
    `, 'wide-screen upgrades-screen');
  }

  private renderMissions(): void {
    const d = this.save.data;
    const cards = MISSIONS.map((m) => {
      const p = d.missions[m.id] ?? { progress: 0, completed: false };
      const pct = Math.min(100, p.progress / m.target * 100);
      const progress = m.kind === 'survive' || m.kind === 'noShield'
        ? `${formatTime(p.progress)} / ${formatTime(m.target)}`
        : `${Math.floor(p.progress)} / ${m.target}`;
      return `<article class="mission-card ${p.completed ? 'completed' : ''}">
        <div class="mission-symbol">${missionIcon(m.kind)}</div><div class="mission-main"><div class="mission-head"><h3>${m.title}</h3><span class="mission-reward">◈ ${m.rewardCoins} <small>· ${m.rewardXp} XP</small></span></div><p>${m.desc}</p><div class="mission-progress-row"><div class="progress-track"><i style="width:${p.completed ? 100 : pct}%"></i></div><small>${p.completed ? 'COMPLETE' : progress}</small></div></div>
      </article>`;
    }).join('');
    const done = MISSIONS.filter((m) => d.missions[m.id]?.completed).length;
    const achievementsEarned = ACHIEVEMENTS.filter((a) => d.achievements.includes(a.id)).length;
    const achievementCards = ACHIEVEMENTS.map((a) => {
      const earned = d.achievements.includes(a.id);
      return `<div class="achievement-chip ${earned ? 'earned' : ''}"><span>${earned ? '✦' : '◇'}</span><div><b>${a.title}</b><small>${a.desc}</small></div><em>${earned ? 'EARNED' : `◈ ${a.coins}`}</em></div>`;
    }).join('');
    this.shell(`
      <div class="screen-heading"><div><div class="eyebrow">FLIGHT OBJECTIVES · ${done} / ${MISSIONS.length} COMPLETE</div><h2>MISSIONS</h2></div><div class="mission-medal">✧</div></div>
      <p class="screen-copy">Complete objectives during a single run and claim your rewards. Your best progress is kept locally.</p>
      <div class="mission-list">${cards}</div>
      <div class="achievement-heading"><span>FLIGHT RIBBONS</span><small>${achievementsEarned} / ${ACHIEVEMENTS.length} UNLOCKED · ONE-TIME REWARDS</small></div>
      <div class="achievement-grid">${achievementCards}</div>
      <div class="screen-bottom"><button class="btn btn-ghost" data-action="back-menu" type="button">← BACK TO FLIGHT DECK</button><span>REWARDS ARE AWARDED AFTER YOUR FLIGHT</span></div>
    `, 'wide-screen missions-screen');
  }

  private renderSettings(): void {
    const s = this.save.data.settings;
    this.shell(`
      <div class="screen-heading"><div><div class="eyebrow">YOUR DEVICE · YOUR PREFERENCES</div><h2>SETTINGS</h2></div><span class="settings-gear">⚙</span></div>
      <div class="settings-list">
        ${toggleRow('sound', 'Sound effects', 'Procedural in-game audio', s.sound)}
        ${toggleRow('music', 'Ambient music', 'Soft generative music bed', s.music)}
        ${toggleRow('vibration', 'Vibration', 'Haptic feedback on supported devices', s.vibration)}
        ${toggleRow('showJoystick', 'Show joystick', 'Display a fixed mobile joystick base', s.showJoystick)}
        ${toggleRow('reducedMotion', 'Reduced motion', 'Reduce shake and visual movement', s.reducedMotion)}
        <label class="setting-row quality-row"><span class="setting-symbol">◉</span><span class="setting-copy"><b>Graphics quality</b><small>Adjust visual effects for your device</small></span><select data-setting="quality" aria-label="Graphics quality"><option value="low" ${s.quality === 'low' ? 'selected' : ''}>LOW</option><option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>MEDIUM</option><option value="high" ${s.quality === 'high' ? 'selected' : ''}>HIGH</option></select></label>
      </div>
      <div class="privacy-note"><span>◉</span> No account. No tracking. Your progress stays in this browser on this device.</div>
      <div class="settings-danger"><div><b>Reset all progress</b><small>Permanently erase coins, aircraft, upgrades and records.</small></div><button class="btn btn-danger" data-action="reset" type="button">RESET</button></div>
      <div class="screen-bottom"><button class="btn btn-ghost" data-action="back-menu" type="button">← BACK TO FLIGHT DECK</button><span>MISSILE SKY · LOCAL BUILD</span></div>
    `, 'compact-screen settings-screen');
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'mode') {
      this.selectedMode = button.dataset.mode ?? 'normal';
      this.renderMenu();
      this.game.playUiSound('click');
      return;
    }
    switch (action) {
      case 'start':
        this.game.initAudio();
        this.game.playUiSound('click');
        this.game.startRun(this.selectedMode as 'normal' | 'fast' | 'endless');
        break;
      case 'pause': this.game.pause(); break;
      case 'resume': this.game.resume(); break;
      case 'retry': this.game.startRun(this.game.mode.id); break;
      case 'menu': case 'back-menu': this.game.quitToMenu(); break;
      case 'screen': {
        const s = button.dataset.screen;
        const map: Record<string, GameState> = {
          hangar: GameState.HANGAR,
          upgrades: GameState.UPGRADES,
          missions: GameState.MISSIONS,
          settings: GameState.SETTINGS,
        };
        if (s && map[s]) this.game.gotoMenuScreen(map[s]);
        break;
      }
      case 'aircraft': {
        const id = button.dataset.aircraft;
        if (id) {
          // Locked cards are preview-selectable without unlocking.
          this.previewAircraft = id;
          this.renderHangar();
        }
        break;
      }
      case 'select-aircraft': {
        const id = button.dataset.aircraft;
        if (id) this.progression.selectAircraft(id);
        this.previewAircraft = null;
        this.renderHangar();
        break;
      }
      case 'unlock-aircraft': {
        const id = button.dataset.aircraft;
        if (id && this.progression.unlockAircraft(id)) {
          this.previewAircraft = null;
          this.toast(`${getAircraft(id).name} UNLOCKED — READY TO FLY`);
          this.renderHangar();
        } else this.toast('NOT ENOUGH COINS OR PILOT LEVEL');
        break;
      }
      case 'upgrade': {
        const id = button.dataset.upgrade;
        if (id && this.progression.buyUpgrade(id)) {
          this.game.applySettings();
          this.renderUpgrades();
          this.toast('UPGRADE INSTALLED');
        } else this.toast('NOT ENOUGH COINS');
        break;
      }
      case 'toggle': {
        const k = button.dataset.setting;
        if (k && k in this.save.data.settings) {
          const key = k as keyof typeof this.save.data.settings;
          if (typeof this.save.data.settings[key] === 'boolean') {
            const mutable = this.save.data.settings as unknown as Record<string, unknown>;
            mutable[key] = !this.save.data.settings[key] as boolean;
            this.save.save();
            this.game.applySettings();
            this.renderSettings();
          }
        }
        break;
      }
      case 'reset':
        if (window.confirm('Reset all Missile Sky progress? This cannot be undone.')) {
          this.progression.resetProgress();
          this.game.applySettings();
          this.toast('PROGRESS RESET');
          this.renderSettings();
        }
        break;
      case 'touch-boost': this.input.pressBoost(); break;
      case 'touch-shield': this.input.pressShield(); break;
    }
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('visible'), 2600);
  }
}

function toggleRow(id: string, title: string, desc: string, on: boolean): string {
  return `<div class="setting-row"><span class="setting-symbol">${id === 'sound' ? '♫' : id === 'music' ? '♪' : id === 'vibration' ? '⌁' : id === 'showJoystick' ? '⊕' : '◌'}</span><span class="setting-copy"><b>${title}</b><small>${desc}</small></span><button class="toggle ${on ? 'on' : ''}" type="button" data-action="toggle" data-setting="${id}" role="switch" aria-checked="${on}" aria-label="${title}"><i></i></button></div>`;
}

function upgradeIcon(id: string): string {
  const icons: Record<string, string> = {
    engine: '◉', agility: '⤴', acceleration: '➤', shield: '⬡',
    boostDuration: 'ϟ', boostCooldown: '⟳', armor: '▣',
  };
  return icons[id] ?? '✧';
}

function missionIcon(kind: string): string {
  const icons: Record<string, string> = {
    survive: '◷', destroy: '✹', stars: '✦', chain: '⛓', noShield: '◇',
  };
  return icons[kind] ?? '✧';
}

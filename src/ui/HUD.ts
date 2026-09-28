/**
 * Lightweight DOM HUD (master plan §38). Updated in place; no per-frame DOM rebuild.
 */

import type { HudInfo, HudLike } from '../game/Game';
import { formatTime } from '../game/util/math';

export class HUD implements HudLike {
  readonly root: HTMLDivElement;
  private timeEl: HTMLElement;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private missilesEl: HTMLElement;
  private comboEl: HTMLElement;
  private coinsEl: HTMLElement;
  private hpEl: HTMLElement;
  private shieldEl: HTMLElement;
  private boostFill: HTMLElement;
  private modeEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.setAttribute('aria-label', 'Game status');
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-chip hud-clock"><span class="hud-label">TIME</span><strong data-hud="time">0:00</strong></div>
        <div class="hud-chip hud-score"><span class="hud-label">SCORE</span><strong data-hud="score">0</strong><small>BEST <b data-hud="best">0</b></small></div>
        <div class="hud-chip hud-threat"><span class="hud-label">THREATS</span><strong><i class="missile-dot"></i><span data-hud="missiles">0</span></strong></div>
        <div class="hud-chip hud-coins"><span class="hud-label">COINS</span><strong>◈ <span data-hud="coins">0</span></strong></div>
        <div class="hud-chip hud-mode"><span data-hud="mode">NORMAL</span></div>
        <button type="button" class="hud-pause" data-action="pause" aria-label="Pause game">Ⅱ</button>
      </div>
      <div class="hud-bottom">
        <div class="hud-status">
          <div class="hud-health" aria-label="Hull integrity" data-hud="hp"></div>
          <div class="hud-shields" aria-label="Shield charges" data-hud="shield"></div>
        </div>
        <div class="hud-combo" data-hud="combo" hidden></div>
        <div class="hud-boost-meter"><span>BOOST</span><div class="boost-track"><i data-hud="boost"></i></div></div>
      </div>
      <div class="hud-help">WASD / ARROWS · SPACE BOOST · Q SHIELD · P PAUSE</div>
    `;
    container.appendChild(this.root);

    const $ = (name: string) => this.root.querySelector<HTMLElement>(`[data-hud="${name}"]`)!;
    this.timeEl = $('time');
    this.scoreEl = $('score');
    this.bestEl = $('best');
    this.missilesEl = $('missiles');
    this.comboEl = $('combo');
    this.coinsEl = $('coins');
    this.hpEl = $('hp');
    this.shieldEl = $('shield');
    this.boostFill = $('boost');
    this.modeEl = $('mode');
  }

  update(info: HudInfo): void {
    this.timeEl.textContent = formatTime(info.time);
    this.scoreEl.textContent = Math.floor(info.score).toLocaleString();
    this.bestEl.textContent = Math.floor(info.best).toLocaleString();
    this.missilesEl.textContent = String(info.missiles);
    this.coinsEl.textContent = String(info.coins);
    this.modeEl.textContent = info.mode;

    this.comboEl.hidden = info.combo < 2;
    this.comboEl.textContent = info.combo >= 2 ? `COMBO ×${info.combo}  ·  ${Math.ceil(info.comboPct * 100)}%` : '';
    this.comboEl.style.setProperty('--combo-pct', `${Math.round(info.comboPct * 100)}%`);

    this.hpEl.innerHTML = '';
    for (let i = 0; i < info.maxHp; i++) {
      const pip = document.createElement('i');
      pip.className = `hp-pip${i < info.hp ? ' full' : ''}`;
      this.hpEl.appendChild(pip);
    }
    this.shieldEl.innerHTML = '';
    for (let i = 0; i < info.shieldMax; i++) {
      const pip = document.createElement('i');
      pip.className = `shield-pip${i < info.shieldCharges ? ' full' : ''}`;
      this.shieldEl.appendChild(pip);
    }
    this.boostFill.style.width = `${Math.round(info.boostPct * 100)}%`;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('visible', v);
    this.root.setAttribute('aria-hidden', String(!v));
  }
}

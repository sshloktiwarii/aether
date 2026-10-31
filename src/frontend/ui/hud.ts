/**
 * Swiss Brutalist Tactical Terminal HUD & Status Bar.
 * Live telemetry display, CRT toggles, and performance indicators.
 */

import type { CrtOptions, TelemetryMetrics } from '../types/terminal.ts';

export class TerminalHud {
  public element: HTMLElement;
  public footerElement: HTMLElement;
  private fpsDisplay: HTMLElement;
  private glyphCountDisplay: HTMLElement;
  private viewportDisplay: HTMLElement;
  private memoryDisplay: HTMLElement;
  private cursorDisplay: HTMLElement;
  private crtBtn: HTMLButtonElement;
  private bloomBtn: HTMLButtonElement;
  private scanlinesBtn: HTMLButtonElement;
  private curveBtn: HTMLButtonElement;

  constructor(
    private container: HTMLElement,
    private crtOptions: CrtOptions,
    private onCrtChange: (options: CrtOptions) => void
  ) {
    this.element = document.createElement('header');
    this.element.className = 'terminal-hud';

    this.footerElement = document.createElement('footer');
    this.footerElement.className = 'terminal-footer';

    this.element.innerHTML = `
      <div class="hud-group">
        <span class="hud-tag">AETHER // WEBGPU CORE</span>
        <span class="hud-metric highlight" id="hud-fps"><strong>120</strong> FPS</span>
        <span class="hud-metric" id="hud-glyphs">GLYPHS: <strong>0</strong></span>
        <span class="hud-metric" id="hud-viewport">GRID: <strong>0x0</strong></span>
      </div>
      <div class="hud-controls">
        <button class="hud-btn active" id="btn-crt">CRT: ON</button>
        <button class="hud-btn active" id="btn-bloom">BLOOM</button>
        <button class="hud-btn active" id="btn-scanlines">SCANLINES</button>
        <button class="hud-btn active" id="btn-curve">CURVATURE</button>
      </div>
    `;

    this.footerElement.innerHTML = `
      <div id="footer-cursor">LN 1, COL 1 | UTF-8 | DEC-ANSI</div>
      <div id="footer-memory">WASM DMA: OK | ATLAS: 2048² | TELEMETRY: RFC-7</div>
    `;

    this.container.appendChild(this.element);
    this.container.appendChild(this.footerElement);

    this.fpsDisplay = this.element.querySelector('#hud-fps')!;
    this.glyphCountDisplay = this.element.querySelector('#hud-glyphs')!;
    this.viewportDisplay = this.element.querySelector('#hud-viewport')!;
    this.memoryDisplay = this.footerElement.querySelector('#footer-memory')!;
    this.cursorDisplay = this.footerElement.querySelector('#footer-cursor')!;

    this.crtBtn = this.element.querySelector('#btn-crt')!;
    this.bloomBtn = this.element.querySelector('#btn-bloom')!;
    this.scanlinesBtn = this.element.querySelector('#btn-scanlines')!;
    this.curveBtn = this.element.querySelector('#btn-curve')!;

    this.bindButtons();
  }

  private bindButtons(): void {
    this.crtBtn.addEventListener('click', () => {
      this.crtOptions.enabled = !this.crtOptions.enabled;
      this.crtBtn.textContent = `CRT: ${this.crtOptions.enabled ? 'ON' : 'OFF'}`;
      this.crtBtn.classList.toggle('active', this.crtOptions.enabled);
      this.onCrtChange(this.crtOptions);
    });

    this.bloomBtn.addEventListener('click', () => {
      this.crtOptions.bloomStrength = this.crtOptions.bloomStrength > 0 ? 0 : 0.35;
      this.bloomBtn.classList.toggle('active', this.crtOptions.bloomStrength > 0);
      this.onCrtChange(this.crtOptions);
    });

    this.scanlinesBtn.addEventListener('click', () => {
      this.crtOptions.scanlineIntensity = this.crtOptions.scanlineIntensity > 0 ? 0 : 0.28;
      this.scanlinesBtn.classList.toggle('active', this.crtOptions.scanlineIntensity > 0);
      this.onCrtChange(this.crtOptions);
    });

    this.curveBtn.addEventListener('click', () => {
      this.crtOptions.curvature = this.crtOptions.curvature > 0 ? 0 : 0.08;
      this.curveBtn.classList.toggle('active', this.crtOptions.curvature > 0);
      this.onCrtChange(this.crtOptions);
    });
  }

  public updateMetrics(m: TelemetryMetrics, cols: number, rows: number): void {
    this.fpsDisplay.innerHTML = `<strong>${Math.round(m.fps)}</strong> FPS (${m.frameTimeMs.toFixed(2)}ms)`;
    this.glyphCountDisplay.innerHTML = `GLYPHS: <strong>${m.glyphCount.toLocaleString()}</strong>`;
    this.viewportDisplay.innerHTML = `GRID: <strong>${cols}x${rows}</strong>`;
    this.cursorDisplay.textContent = `LN ${m.cursorRow + 1}, COL ${m.cursorCol + 1} | UTF-8 | DEC-ANSI`;
    this.memoryDisplay.textContent = `WASM: ${(m.wasmMemoryBytes / (1024 * 1024)).toFixed(1)}MB | ATLAS: ${(m.atlasOccupancy * 100).toFixed(1)}% | FLEET: ACTIVE`;
  }
}

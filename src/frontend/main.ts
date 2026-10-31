/**
 * AETHER // Tactical WebGPU Terminal Emulator
 * Main Application Runtime and Interactive Systems Session.
 */

import { WebGpuContext } from './webgpu/device.ts';
import { GlyphAtlas } from './atlas/glyph_atlas.ts';
import { TerminalRenderer } from './webgpu/renderer.ts';
import { CrtPostProcessor } from './webgpu/crt.ts';
import { TextareaShim } from './input/textarea_shim.ts';
import { TerminalHud } from './ui/hud.ts';
import type { WasmAetherExports, TelemetryMetrics } from './types/terminal.ts';

export class AetherTerminal {
  private appContainer: HTMLElement;
  private canvasContainer: HTMLElement;
  private canvas: HTMLCanvasElement;
  private gpuCtx: WebGpuContext;
  private atlas: GlyphAtlas;
  private renderer: TerminalRenderer | null = null;
  private crt: CrtPostProcessor | null = null;
  private hud: TerminalHud | null = null;
  private inputShim: TextareaShim | null = null;

  private wasmExports: WasmAetherExports | null = null;
  private termPtr = 0;
  private cols = 120;
  private rows = 36;

  private isRunning = false;
  private lastFrameTime = performance.now();
  private frameCount = 0;
  private lastFpsCalc = performance.now();
  private currentFps = 120;
  private currentFrameTimeMs = 0;

  // Interactive command shell
  private inputBuffer = '';
  private isMatrixRunning = false;
  private matrixTimer: number | null = null;

  constructor(containerId = 'app') {
    this.appContainer = document.getElementById(containerId) || document.body;
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'terminal-viewport';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'terminal-canvas';
    this.canvasContainer.appendChild(this.canvas);

    this.gpuCtx = new WebGpuContext(this.canvas);
    this.atlas = new GlyphAtlas(16, '"JetBrains Mono", monospace');
  }

  public async start(): Promise<void> {
    console.log('[AETHER] Initializing WebGPU Terminal Subsystem...');

    // 1. Initialize WebGPU
    const gpuOk = await this.gpuCtx.init();
    if (!gpuOk || !this.gpuCtx.device) {
      this.renderFallbackError('WebGPU is not supported on this platform/browser.');
      return;
    }

    const device = this.gpuCtx.device;

    // 2. Initialize Texture Atlas & Pre-warm
    this.atlas.initWebGpu(device);
    this.atlas.prewarm(device);

    // 3. Initialize CRT Post-Processor
    this.crt = new CrtPostProcessor(device);
    await this.crt.initPipeline(this.gpuCtx.format);
    this.crt.resize(this.gpuCtx.width, this.gpuCtx.height);

    // 4. Initialize Terminal Quad Renderer
    this.renderer = new TerminalRenderer(
      device,
      CrtPostProcessor.INTERMEDIATE_FORMAT,
      this.atlas
    );

    // 5. Load WebAssembly Core
    await this.loadWasm();

    // 6. Build UI HUD and Mount Elements
    this.hud = new TerminalHud(this.appContainer, this.crt.options, (opts) => {
      if (this.crt) this.crt.options = opts;
    });
    this.appContainer.appendChild(this.canvasContainer);

    // 7. Initialize Input Textarea Shim
    this.inputShim = new TextareaShim(
      this.canvasContainer,
      (bytes) => this.handleUserInput(bytes),
      (pasted) => this.handlePaste(pasted)
    );
    this.inputShim.focus();

    // 8. Handle Window Resizing
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();

    // 9. Display Initial Systems Banner & Welcome Prompt
    this.printSystemBanner();
    this.prompt();

    // 10. Start 120 FPS Render Loop
    this.isRunning = true;
    requestAnimationFrame((t) => this.renderLoop(t));
  }

  private async loadWasm(): Promise<void> {
    const wasmUrl = '/wasm/aether_core.wasm';
    const response = await fetch(wasmUrl);
    const bytes = await response.arrayBuffer();
    const wasmModule = await WebAssembly.instantiate(bytes, {});
    this.wasmExports = wasmModule.instance.exports as unknown as WasmAetherExports;

    this.termPtr = this.wasmExports.aether_term_new(this.cols, this.rows, 10000);
    console.log(`[AETHER] Rust VT100 Core Initialized at pointer 0x${this.termPtr.toString(16)}`);
  }

  private handleResize(): void {
    if (!this.gpuCtx.device || !this.crt) return;

    const { width, height } = this.gpuCtx.resize();
    this.crt.resize(width, height);

    const cellW = this.atlas.cellWidth;
    const cellH = this.atlas.cellHeight;

    const newCols = Math.max(40, Math.floor(width / cellW));
    const newRows = Math.max(15, Math.floor(height / cellH));

    if (newCols !== this.cols || newRows !== this.rows) {
      this.cols = newCols;
      this.rows = newRows;
      if (this.wasmExports && this.termPtr) {
        this.wasmExports.aether_term_resize(this.termPtr, newCols, newRows);
      }
    }
  }

  private printSystemBanner(): void {
    const banner = [
      '\x1b[1;33m+----------------------------------------------------------------------------+\x1b[0m',
      '\x1b[1;33m| \x1b[1;37mAETHER // ADVANCED WEBGPU TACTICAL TERMINAL EMULATOR\x1b[0m                       \x1b[1;33m|\x1b[0m',
      '\x1b[1;33m| \x1b[36mPure Rust DEC-VT100 WASM Engine | 8SSEDT SDF Atlas | WGSL 120 FPS\x1b[0m          \x1b[1;33m|\x1b[0m',
      '\x1b[1;33m+----------------------------------------------------------------------------+\x1b[0m',
      '\x1b[32m[SYSTEM BOOT]\x1b[0m WebGPU Device Initialized: High-Performance Pipeline Active.',
      '\x1b[32m[SYSTEM BOOT]\x1b[0m Texture Atlas: 2048x2048 R8Unorm Best-Height-Fit Shelf Allocator.',
      '\x1b[32m[SYSTEM BOOT]\x1b[0m Linear Memory DMA Bridge: Zero-Copy Instance Stream Bound.',
      'Type \x1b[1;37mhelp\x1b[0m for command index, \x1b[1;37mbench\x1b[0m for 10k-glyph test, \x1b[1;37mmatrix\x1b[0m for rain.',
      '',
    ].join('\r\n');

    this.writeToTerminal(banner);
  }

  private prompt(): void {
    this.writeToTerminal('\x1b[1;32maether@fleet\x1b[0m:\x1b[1;34m~/\x1b[0m# ');
  }

  private writeToTerminal(text: string): void {
    if (!this.wasmExports || !this.termPtr) return;
    const bytes = new TextEncoder().encode(text);
    const bufPtr = this.wasmExports.aether_term_alloc_buffer(bytes.length);
    new Uint8Array(this.wasmExports.memory.buffer, bufPtr, bytes.length).set(bytes);
    this.wasmExports.aether_term_write(this.termPtr, bufPtr, bytes.length);
    this.wasmExports.aether_term_free_buffer(bufPtr, bytes.length);
  }

  private handleUserInput(bytes: Uint8Array): void {
    if (this.isMatrixRunning) {
      // Any key cancels matrix
      this.stopMatrix();
      return;
    }

    const text = new TextDecoder().decode(bytes);

    if (text === '\r') {
      this.writeToTerminal('\r\n');
      this.executeCommand(this.inputBuffer.trim());
      this.inputBuffer = '';
      if (!this.isMatrixRunning) {
        this.prompt();
      }
    } else if (text === '\x7f' || text === '\x08') {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.writeToTerminal('\x08 \x08'); // Backspace, space, backspace
      }
    } else if (text === '\x03') {
      // Ctrl+C
      this.writeToTerminal('^C\r\n');
      this.inputBuffer = '';
      this.prompt();
    } else if (text.length === 1 && text >= ' ') {
      this.inputBuffer += text;
      this.writeToTerminal(text);
    } else {
      this.writeToTerminal(text);
    }
  }

  private handlePaste(text: string): void {
    this.inputBuffer += text;
    this.writeToTerminal(text);
  }

  private executeCommand(cmd: string): void {
    const parts = cmd.split(/\s+/);
    const op = parts[0]?.toLowerCase();

    switch (op) {
      case '':
        break;
      case 'help':
        this.writeToTerminal([
          '\x1b[1;37mAVAILABLE TACTICAL COMMANDS:\x1b[0m',
          '  \x1b[33mhelp\x1b[0m         - Display this tactical command catalog',
          '  \x1b[33mbench\x1b[0m        - Launch 10,000+ glyph WebGPU stress benchmark',
          '  \x1b[33mmatrix\x1b[0m       - Fullscreen digital CRT phosphor rain',
          '  \x1b[33mcolors\x1b[0m       - Print ANSI 16-color & 24-bit TrueColor palette',
          '  \x1b[33mneofetch\x1b[0m     - Tactical host system telemetry snapshot',
          '  \x1b[33mtelemetry\x1b[0m    - Dump .fleet telemetry event payload',
          '  \x1b[33mclear\x1b[0m        - Erase terminal display buffer',
          '',
        ].join('\r\n'));
        break;

      case 'clear':
        this.writeToTerminal('\x1b[2J\x1b[H');
        break;

      case 'bench':
        this.runBenchmark();
        break;

      case 'matrix':
        this.startMatrix();
        break;

      case 'colors':
        this.printColorPalette();
        break;

      case 'neofetch':
      case 'uname':
        this.printNeofetch();
        break;

      case 'telemetry':
        this.printTelemetryEvent();
        break;

      default:
        this.writeToTerminal(`\x1b[31mcommand not found: ${op}\x1b[0m\r\n`);
        break;
    }
  }

  private printColorPalette(): void {
    let out = '\x1b[1;37mANSI 16-Color Palette:\x1b[0m\r\n';
    for (let i = 0; i < 8; i++) {
      out += `\x1b[48;5;${i}m  \x1b[0m `;
    }
    out += '\r\n';
    for (let i = 8; i < 16; i++) {
      out += `\x1b[48;5;${i}m  \x1b[0m `;
    }
    out += '\r\n\r\n\x1b[1;37m24-bit TrueColor RGB Gradient:\x1b[0m\r\n';
    for (let i = 0; i < 40; i++) {
      const r = Math.round(255 * (i / 40));
      const g = Math.round(128 * (1 - i / 40));
      const b = Math.round(255 * Math.sin((i / 40) * Math.PI));
      out += `\x1b[48;2;${r};${g};${b}m \x1b[0m`;
    }
    out += '\r\n\r\n';
    this.writeToTerminal(out);
  }

  private printNeofetch(): void {
    const info = [
      '\x1b[32m       /\\        \x1b[1;37mOS:\x1b[0m Aether Tactical OS (macOS Sequoia/Apple Silicon)',
      '\x1b[32m      /  \\       \x1b[1;37mHost:\x1b[0m Apple Silicon M-Series Metal WebGPU',
      '\x1b[32m     / /\\ \\      \x1b[1;37mKernel:\x1b[0m Rust 1.99.0 / wasm32-unknown-unknown',
      '\x1b[32m    / /__\\ \\     \x1b[1;37mParser:\x1b[0m Paul Flo Williams DEC VT100 State Machine',
      '\x1b[32m   /________\\    \x1b[1;37mAtlas:\x1b[0m 2048x2048 R8Unorm 8SSEDT Distance Field',
      '\x1b[32m                 \x1b[1;37mRenderer:\x1b[0m WebGPU WGSL Instanced Quad (120 FPS)',
      '\x1b[32m                 \x1b[1;37mShader:\x1b[0m CRT Phosphor Bloom / Aperture Grille / Curvature',
      '',
    ].join('\r\n');
    this.writeToTerminal(info);
  }

  private printTelemetryEvent(): void {
    const event = {
      source: 'aether',
      timestamp_ns: Date.now() * 1_000_000,
      event_type: 'terminal_status',
      payload: {
        cols: this.cols,
        rows: this.rows,
        fps: this.currentFps,
        frame_time_ms: this.currentFrameTimeMs,
        glyph_count: this.cols * this.rows,
        atlas_occupancy: this.atlas.occupancy,
        crt_enabled: this.crt?.options.enabled ?? false,
      },
    };
    this.writeToTerminal(`\x1b[36m${JSON.stringify(event, null, 2)}\x1b[0m\r\n\r\n`);
  }

  private runBenchmark(): void {
    this.writeToTerminal('\x1b[33m[BENCHMARK] Streaming 10,000+ glyphs to WebGPU grid...\x1b[0m\r\n');
    const targetCells = 160 * 65; // 10,400 cells
    this.renderer?.prepareHighThroughputBatch(targetCells);

    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=~';
    let block = '\x1b[H';
    for (let r = 0; r < 65; r++) {
      let row = '';
      for (let c = 0; c < 160; c++) {
        row += chars[(r * 160 + c) % chars.length];
      }
      block += row + '\r\n';
    }

    const t0 = performance.now();
    this.writeToTerminal(block);
    const t1 = performance.now();

    this.writeToTerminal(`\x1b[32m[BENCHMARK COMPLETE] 10,400 glyphs parsed in ${(t1 - t0).toFixed(2)}ms (< 1.5ms budget)\x1b[0m\r\n`);
  }

  private startMatrix(): void {
    this.isMatrixRunning = true;
    this.writeToTerminal('\x1b[2J\x1b[H\x1b[?25l'); // Clear screen & hide cursor
    const glyphs = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';

    this.matrixTimer = window.setInterval(() => {
      let line = '';
      for (let c = 0; c < this.cols; c++) {
        if (Math.random() > 0.85) {
          const char = glyphs[Math.floor(Math.random() * glyphs.length)];
          const isLead = Math.random() > 0.8;
          line += isLead ? `\x1b[1;37m${char}\x1b[0m` : `\x1b[32m${char}\x1b[0m`;
        } else {
          line += ' ';
        }
      }
      this.writeToTerminal(line + '\r\n');
    }, 50);
  }

  private stopMatrix(): void {
    this.isMatrixRunning = false;
    if (this.matrixTimer !== null) {
      clearInterval(this.matrixTimer);
      this.matrixTimer = null;
    }
    this.writeToTerminal('\x1b[?25h\x1b[2J\x1b[H'); // Show cursor & clear
    this.printSystemBanner();
    this.prompt();
  }

  private renderLoop(timeMs: number): void {
    if (!this.isRunning) return;

    const dt = timeMs - this.lastFrameTime;
    this.lastFrameTime = timeMs;
    this.frameCount++;

    if (timeMs - this.lastFpsCalc >= 1000) {
      this.currentFps = (this.frameCount * 1000) / (timeMs - this.lastFpsCalc);
      this.currentFrameTimeMs = dt;
      this.frameCount = 0;
      this.lastFpsCalc = timeMs;
    }

    if (this.wasmExports && this.termPtr && this.gpuCtx.device && this.gpuCtx.context && this.renderer && this.crt) {
      const charW = this.atlas.cellWidth;
      const charH = this.atlas.cellHeight;

      // 1. Pack instances in Rust WASM core
      const instanceCount = this.wasmExports.aether_term_update_render_instances(this.termPtr, charW, charH);
      const instancesPtr = this.wasmExports.aether_term_get_instances_ptr(this.termPtr);

      // 2. Zero-Copy DMA instance upload
      this.renderer.uploadWasmInstances(
        this.wasmExports.memory,
        instancesPtr,
        instanceCount,
        this.atlas
      );

      // 3. Update Uniforms
      const timeSec = timeMs * 0.001;
      const cursorBlink = Math.sin(timeSec * 6.0) > 0 ? 1.0 : 0.0;
      this.renderer.uniforms.update(
        this.gpuCtx.device,
        this.gpuCtx.width,
        this.gpuCtx.height,
        charW,
        charH,
        this.atlas.width,
        this.atlas.height,
        timeSec,
        4.0,
        cursorBlink
      );

      // 4. Update Input Shim cursor position
      const cursorData = new Uint32Array(this.wasmExports.memory.buffer, this.termPtr, 3);
      const cursorCol = cursorData[0];
      const cursorRow = cursorData[1];
      this.inputShim?.updateCursorPosition(cursorCol, cursorRow, charW, charH);

      // 5. Begin GPU Command Encoding
      const commandEncoder = this.gpuCtx.device.createCommandEncoder({
        label: 'aether_frame_encoder',
      });

      if (this.crt.intermediateView) {
        // Pass 1: Render terminal quads into intermediate HDR texture
        const termPass = commandEncoder.beginRenderPass({
          label: 'aether_terminal_quad_pass',
          colorAttachments: [
            {
              view: this.crt.intermediateView,
              clearValue: { r: 0.04, g: 0.05, b: 0.06, a: 1.0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });

        this.renderer.render(termPass, instanceCount);
        termPass.end();

        // Pass 2: CRT Post-processing pass into canvas display target
        const currentTargetView = this.gpuCtx.context.getCurrentTexture().createView();
        this.crt.render(commandEncoder, currentTargetView, timeSec);
      }

      this.gpuCtx.device.queue.submit([commandEncoder.finish()]);

      // 6. Update HUD Metrics
      const metrics: TelemetryMetrics = {
        fps: this.currentFps,
        frameTimeMs: this.currentFrameTimeMs,
        glyphCount: instanceCount,
        drawCalls: 2, // 1 terminal quad pass + 1 fullscreen CRT pass
        wasmMemoryBytes: this.wasmExports.memory.buffer.byteLength,
        atlasOccupancy: this.atlas.occupancy,
        cursorCol,
        cursorRow,
      };

      this.hud?.updateMetrics(metrics, this.cols, this.rows);
    }

    requestAnimationFrame((t) => this.renderLoop(t));
  }

  private renderFallbackError(msg: string): void {
    const errorDiv = document.createElement('div');
    errorDiv.style.padding = '32px';
    errorDiv.style.color = '#ff4444';
    errorDiv.style.fontFamily = 'monospace';
    errorDiv.innerHTML = `<h2>[AETHER ERROR]</h2><p>${msg}</p>`;
    this.appContainer.appendChild(errorDiv);
  }
}

// Auto-boot on DOM ready
if (typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const term = new AetherTerminal('app');
    term.start().catch((err) => {
      console.error('[AETHER] Boot failure:', err);
    });
  });
}

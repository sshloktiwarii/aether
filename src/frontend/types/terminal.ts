/**
 * Aether Terminal Type Declarations & Interface Contracts
 */

export interface TerminalOptions {
  cols: number;
  rows: number;
  fontSize: number;
  fontFamily: string;
  maxScrollback: number;
  theme: TerminalTheme;
  crt: CrtOptions;
}

export interface TerminalTheme {
  foreground: string;
  background: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface CrtOptions {
  enabled: boolean;
  curvature: number;
  scanlineIntensity: number;
  bloomStrength: number;
  chromaticAberration: number;
  phosphorMask: number;
}

export interface TelemetryMetrics {
  fps: number;
  frameTimeMs: number;
  glyphCount: number;
  drawCalls: number;
  wasmMemoryBytes: number;
  atlasOccupancy: number;
  cursorCol: number;
  cursorRow: number;
}

export interface WasmAetherExports {
  memory: WebAssembly.Memory;
  aether_term_new(cols: number, rows: number, maxScrollback: number): number;
  aether_term_free(termPtr: number): void;
  aether_term_resize(termPtr: number, cols: number, rows: number): void;
  aether_term_write(termPtr: number, bytesPtr: number, len: number): void;
  aether_term_scroll(termPtr: number, delta: number): void;
  aether_term_get_cursor(termPtr: number, outXyPtr: number): void;
  aether_term_update_render_instances(termPtr: number, charWidth: number, charHeight: number): number;
  aether_term_get_instances_ptr(termPtr: number): number;
  aether_term_get_instance_count(termPtr: number): number;
  aether_term_is_dirty(termPtr: number): number;
  aether_term_clear_dirty(termPtr: number): void;
  aether_term_alloc_buffer(size: number): number;
  aether_term_free_buffer(ptr: number, size: number): void;
}

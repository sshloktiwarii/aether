/**
 * High-precision Monochrome Glyph Bitmap & SDF Rasterizer.
 * Renders crisp typographic glyphs to alpha bitmaps and converts them to SDFs.
 */

import { SdfRasterizer } from './sdf_rasterizer.ts';

export interface RasterizedGlyph {
  char: string;
  width: number;
  height: number;
  sdfData: Uint8Array;
}

export class GlyphRasterizer {
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private sdfRasterizer: SdfRasterizer;
  public readonly fontSize: number;
  public readonly fontFamily: string;

  constructor(
    fontSize = 18,
    fontFamily = '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
    sdfRadius = 4
  ) {
    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    this.sdfRasterizer = new SdfRasterizer(sdfRadius);

    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(64, 64);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 64;
      this.canvas.height = 64;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    }
  }

  /**
   * Computes standard monospace bounding cell width and height.
   */
  public computeCellMetrics(): { width: number; height: number; baseline: number } {
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    const metrics = this.ctx.measureText('M');
    const width = Math.ceil(metrics.width);
    const height = Math.ceil(this.fontSize * 1.4);
    const baseline = Math.ceil(this.fontSize * 1.1);
    return { width, height, baseline };
  }

  /**
   * Rasterizes a single unicode character and produces an 8-bit SDF buffer.
   */
  public rasterize(char: string, cellW: number, cellH: number): RasterizedGlyph {
    const pad = this.sdfRasterizer.radius * 2;
    const bmpW = cellW + pad * 2;
    const bmpH = cellH + pad * 2;

    if (this.canvas.width < bmpW || this.canvas.height < bmpH) {
      this.canvas.width = Math.max(this.canvas.width, bmpW);
      this.canvas.height = Math.max(this.canvas.height, bmpH);
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, bmpW, bmpH);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, bmpW, bmpH);

    ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(char, pad, pad);

    const imgData = ctx.getImageData(0, 0, bmpW, bmpH);
    const alphaMask = new Uint8Array(bmpW * bmpH);

    // Extract alpha / luminance channel
    for (let i = 0; i < alphaMask.length; i++) {
      alphaMask[i] = imgData.data[i * 4]; // R channel contains white text
    }

    const sdfData = this.sdfRasterizer.generateSdf(alphaMask, bmpW, bmpH);

    return {
      char,
      width: bmpW,
      height: bmpH,
      sdfData,
    };
  }
}

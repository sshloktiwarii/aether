/**
 * Dynamic WebGPU Glyph Texture Atlas Manager.
 * Orchestrates Shelf Bin-Packing, SDF Rasterization, and Partial Texture Uploads.
 */

import { ShelfPacker, type AtlasRect } from './shelf_packer.ts';
import { GlyphRasterizer } from './glyph_rasterizer.ts';

export interface AtlasGlyph {
  codepoint: number;
  char: string;
  rect: AtlasRect;
}

interface PendingUpload {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export class GlyphAtlas {
  public readonly width = 2048;
  public readonly height = 2048;
  public readonly cellWidth: number;
  public readonly cellHeight: number;

  private packer: ShelfPacker;
  private rasterizer: GlyphRasterizer;
  private glyphCache = new Map<number, AtlasGlyph>();
  private pendingUploads: PendingUpload[] = [];

  public texture: GPUTexture | null = null;
  public textureView: GPUTextureView | null = null;
  public sampler: GPUSampler | null = null;

  constructor(fontSize = 18, fontFamily?: string) {
    this.packer = new ShelfPacker(this.width, this.height, 2);
    this.rasterizer = new GlyphRasterizer(fontSize, fontFamily, 4);
    const metrics = this.rasterizer.computeCellMetrics();
    this.cellWidth = metrics.width;
    this.cellHeight = metrics.height;
  }

  /**
   * Initializes WebGPU texture and bilinear sampler.
   */
  public initWebGpu(device: GPUDevice): void {
    this.texture = device.createTexture({
      label: 'aether_glyph_atlas_2048',
      size: [this.width, this.height, 1],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.textureView = this.texture.createView({
      label: 'aether_glyph_atlas_view',
    });

    this.sampler = device.createSampler({
      label: 'aether_glyph_atlas_sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Retrieves or dynamically allocates and rasterizes a glyph.
   */
  public getOrCreateGlyph(codepoint: number): AtlasGlyph | null {
    const cached = this.glyphCache.get(codepoint);
    if (cached) {
      return cached;
    }

    const char = String.fromCodePoint(codepoint);
    const raster = this.rasterizer.rasterize(char, this.cellWidth, this.cellHeight);
    const rect = this.packer.allocate(raster.width, raster.height);

    if (!rect) {
      // Atlas is full; fallback to space or existing glyph
      return this.glyphCache.get(0x20) ?? null;
    }

    this.pendingUploads.push({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      data: raster.sdfData,
    });

    const glyph: AtlasGlyph = {
      codepoint,
      char,
      rect,
    };

    this.glyphCache.set(codepoint, glyph);
    return glyph;
  }

  /**
   * Flushes all pending rasterized glyph sub-rectangles to the GPU texture.
   */
  public flush(device: GPUDevice): void {
    if (!this.texture || this.pendingUploads.length === 0) {
      return;
    }

    for (const upload of this.pendingUploads) {
      device.queue.writeTexture(
        {
          texture: this.texture,
          origin: { x: upload.x, y: upload.y, z: 0 },
        },
        upload.data as unknown as BufferSource,
        {
          bytesPerRow: upload.width,
          rowsPerImage: upload.height,
        },
        {
          width: upload.width,
          height: upload.height,
          depthOrArrayLayers: 1,
        }
      );
    }

    this.pendingUploads = [];
  }

  /**
   * Pre-warms the glyph atlas with standard ASCII and box-drawing ranges.
   * Eliminates runtime rasterization pauses during terminal streaming.
   */
  public prewarm(device?: GPUDevice): void {
    // 1. ASCII printable characters (0x20..=0x7E)
    for (let cp = 0x20; cp <= 0x7E; cp++) {
      this.getOrCreateGlyph(cp);
    }

    // 2. Unicode Box Drawing (U+2500..=U+257F)
    for (let cp = 0x2500; cp <= 0x257F; cp++) {
      this.getOrCreateGlyph(cp);
    }

    // 3. Block Elements (U+2580..=U+259F)
    for (let cp = 0x2580; cp <= 0x259F; cp++) {
      this.getOrCreateGlyph(cp);
    }

    // 4. Powerline Symbols (U+E0A0..=U+E0B3)
    for (let cp = 0xE0A0; cp <= 0xE0B3; cp++) {
      this.getOrCreateGlyph(cp);
    }

    if (device) {
      this.flush(device);
    }
  }

  public get occupancy(): number {
    return this.packer.occupancy;
  }

  public get cachedCount(): number {
    return this.glyphCache.size;
  }
}

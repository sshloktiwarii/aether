/**
 * CRT Post-Processing Pipeline & Offscreen Intermediate HDR Render Target.
 * Implements retro-futuristic phosphor bloom, barrel distortion, scanlines, and RGB triad mask.
 */

import type { CrtOptions } from '../types/terminal.ts';

export class CrtPostProcessor {
  public static readonly INTERMEDIATE_FORMAT: GPUTextureFormat = 'rgba16float';

  public device: GPUDevice;
  public width = 0;
  public height = 0;

  public intermediateTexture: GPUTexture | null = null;
  public intermediateView: GPUTextureView | null = null;
  public intermediateSampler: GPUSampler | null = null;

  public uniformBuffer: GPUBuffer | null = null;
  public pipeline: GPURenderPipeline | null = null;
  public bindGroup: GPUBindGroup | null = null;
  public bindGroupLayout: GPUBindGroupLayout | null = null;

  public options: CrtOptions = {
    enabled: true,
    curvature: 0.08,
    scanlineIntensity: 0.28,
    bloomStrength: 0.35,
    chromaticAberration: 0.003,
    phosphorMask: 0.15,
  };

  constructor(device: GPUDevice) {
    this.device = device;
    this.intermediateSampler = device.createSampler({
      label: 'aether_crt_screen_sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Resizes intermediate HDR texture to match viewport dimensions.
   */
  public resize(width: number, height: number): void {
    if (this.intermediateTexture && this.width === width && this.height === height) {
      return;
    }

    if (this.intermediateTexture) {
      this.intermediateTexture.destroy();
    }

    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.intermediateTexture = this.device.createTexture({
      label: 'aether_crt_intermediate_hdr_texture',
      size: [this.width, this.height, 1],
      format: CrtPostProcessor.INTERMEDIATE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.intermediateView = this.intermediateTexture.createView({
      label: 'aether_crt_intermediate_hdr_view',
    });
  }
}

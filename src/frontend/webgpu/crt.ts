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

    this.updateBindGroup();
  }

  /**
   * Initializes CRT post-processing WGSL pipeline.
   */
  public async initPipeline(targetFormat: GPUTextureFormat): Promise<void> {
    const crtShaderCode = (await import('./shaders/crt.wgsl?raw')).default;

    this.uniformBuffer = this.device.createBuffer({
      label: 'aether_crt_uniforms_buffer',
      size: 32, // 8 x 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'aether_crt_bind_group_layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: 'aether_crt_pipeline_layout',
      bindGroupLayouts: [this.bindGroupLayout],
    });

    const shaderModule = this.device.createShaderModule({
      label: 'aether_crt_shader_module',
      code: crtShaderCode,
    });

    this.pipeline = this.device.createRenderPipeline({
      label: 'aether_crt_render_pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_fullscreen',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_crt',
        targets: [{ format: targetFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    this.updateBindGroup();
  }

  private updateBindGroup(): void {
    if (!this.bindGroupLayout || !this.uniformBuffer || !this.intermediateView || !this.intermediateSampler) {
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      label: 'aether_crt_bind_group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.intermediateView },
        { binding: 2, resource: this.intermediateSampler },
      ],
    });
  }

  /**
   * Executes full-screen CRT post-process render pass directly into target display view.
   */
  public render(
    commandEncoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    timeSec: number
  ): void {
    if (!this.pipeline || !this.bindGroup || !this.uniformBuffer || this.width === 0 || this.height === 0) {
      return;
    }

    // Pack uniform buffer (32 bytes)
    const uniforms = new Float32Array([
      this.width,
      this.height,
      timeSec,
      this.options.enabled ? this.options.curvature : 0.0,
      this.options.enabled ? this.options.scanlineIntensity : 0.0,
      this.options.enabled ? this.options.bloomStrength : 0.0,
      this.options.enabled ? this.options.chromaticAberration : 0.0,
      this.options.enabled ? this.options.phosphorMask : 0.0,
    ]);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms.buffer as ArrayBuffer);

    const pass = commandEncoder.beginRenderPass({
      label: 'aether_crt_post_process_pass',
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, 1, 0, 0); // 1 single full-screen triangle
    pass.end();
  }
}

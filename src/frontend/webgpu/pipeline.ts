/**
 * WebGPU Instanced Quad Pipeline Creation & Layout Bindings.
 * High-performance single-pass instanced glyph rendering pipeline.
 */

import terminalShaderCode from './shaders/terminal.wgsl?raw';
import { QuadMesh } from './mesh.ts';
import { TerminalUniforms } from './uniforms.ts';
import type { GlyphAtlas } from '../atlas/glyph_atlas.ts';

export class TerminalPipeline {
  public pipeline: GPURenderPipeline | null = null;
  public bindGroup: GPUBindGroup | null = null;
  public bindGroupLayout: GPUBindGroupLayout | null = null;

  public init(
    device: GPUDevice,
    format: GPUTextureFormat,
    uniforms: TerminalUniforms,
    atlas: GlyphAtlas
  ): void {
    const shaderModule = device.createShaderModule({
      label: 'aether_terminal_shader_module',
      code: terminalShaderCode,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'aether_terminal_bind_group_layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
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

    const pipelineLayout = device.createPipelineLayout({
      label: 'aether_terminal_pipeline_layout',
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = device.createRenderPipeline({
      label: 'aether_terminal_render_pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          QuadMesh.vertexBufferLayout,
          QuadMesh.instanceBufferLayout,
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
    });

    this.updateBindGroup(device, uniforms, atlas);
  }

  public updateBindGroup(
    device: GPUDevice,
    uniforms: TerminalUniforms,
    atlas: GlyphAtlas
  ): void {
    if (!this.bindGroupLayout || !uniforms.buffer || !atlas.textureView || !atlas.sampler) {
      return;
    }

    this.bindGroup = device.createBindGroup({
      label: 'aether_terminal_bind_group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniforms.buffer } },
        { binding: 1, resource: atlas.textureView },
        { binding: 2, resource: atlas.sampler },
      ],
    });
  }
}

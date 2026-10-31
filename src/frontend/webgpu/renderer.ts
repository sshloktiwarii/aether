/**
 * WebGPU Terminal Renderer & Zero-Copy DMA Instance Buffer Manager.
 * Direct shared-memory streaming from WebAssembly linear memory to GPU buffers.
 */

import { QuadMesh } from './mesh.ts';
import { TerminalUniforms } from './uniforms.ts';
import { TerminalPipeline } from './pipeline.ts';
import type { GlyphAtlas } from '../atlas/glyph_atlas.ts';

export class TerminalRenderer {
  public device: GPUDevice;
  public quadMesh: QuadMesh;
  public uniforms: TerminalUniforms;
  public pipeline: TerminalPipeline;

  public instanceBuffer: GPUBuffer | null = null;
  public instanceCapacity = 16384; // 16K instances (can hold up to ~200 cols x 80 rows)

  constructor(
    device: GPUDevice,
    targetFormat: GPUTextureFormat,
    atlas: GlyphAtlas
  ) {
    this.device = device;
    this.quadMesh = new QuadMesh();
    this.quadMesh.init(device);

    this.uniforms = new TerminalUniforms();
    this.uniforms.init(device);

    this.pipeline = new TerminalPipeline();
    this.pipeline.init(device, targetFormat, this.uniforms, atlas);

    this.ensureInstanceBuffer(this.instanceCapacity);
  }

  /**
   * Allocates or resizes the GPU instance buffer.
   */
  public ensureInstanceBuffer(requiredCount: number): void {
    if (this.instanceBuffer && this.instanceCapacity >= requiredCount) {
      return;
    }

    this.instanceCapacity = Math.max(requiredCount, this.instanceCapacity * 2);
    const byteSize = this.instanceCapacity * 48;

    this.instanceBuffer = this.device.createBuffer({
      label: `aether_instances_vbo_${this.instanceCapacity}`,
      size: byteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Direct Zero-Copy DMA transfer from WebAssembly linear memory to WebGPU.
   */
  public uploadWasmInstances(
    wasmMemory: WebAssembly.Memory,
    instancesPtr: number,
    instanceCount: number,
    atlas: GlyphAtlas
  ): void {
    if (instanceCount === 0 || !this.instanceBuffer) {
      return;
    }

    this.ensureInstanceBuffer(instanceCount);

    // Fast in-place UV patch directly in WebAssembly linear memory
    const f32View = new Float32Array(wasmMemory.buffer);
    const u32View = new Uint32Array(wasmMemory.buffer);
    const baseOffsetF32 = instancesPtr >> 2;

    for (let i = 0; i < instanceCount; i++) {
      const idx = baseOffsetF32 + i * 12;
      const codepoint = u32View[idx + 11];

      // If codepoint is space (0x20) or zero, leave UVs at 0.0
      if (codepoint > 0x20) {
        const glyph = atlas.getOrCreateGlyph(codepoint);
        if (glyph) {
          f32View[idx + 4] = glyph.rect.uvMin[0];
          f32View[idx + 5] = glyph.rect.uvMin[1];
          f32View[idx + 6] = glyph.rect.uvMax[0];
          f32View[idx + 7] = glyph.rect.uvMax[1];
        }
      }
    }

    // Flush newly rasterized glyphs to GPU texture atlas if any
    atlas.flush(this.device);

    // DMA Upload: write directly from wasmMemory.buffer into WebGPU buffer
    const byteLength = instanceCount * 48;
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      wasmMemory.buffer as ArrayBuffer,
      instancesPtr,
      byteLength
    );
  }

  /**
   * Encodes terminal instanced quad render pass.
   */
  public render(
    passEncoder: GPURenderPassEncoder,
    instanceCount: number
  ): void {
    if (instanceCount === 0 || !this.pipeline.pipeline || !this.pipeline.bindGroup || !this.quadMesh.buffer || !this.instanceBuffer) {
      return;
    }

    passEncoder.setPipeline(this.pipeline.pipeline);
    passEncoder.setBindGroup(0, this.pipeline.bindGroup);
    passEncoder.setVertexBuffer(0, this.quadMesh.buffer);
    passEncoder.setVertexBuffer(1, this.instanceBuffer);
    passEncoder.draw(4, instanceCount, 0, 0); // 1 single draw call!
  }
}

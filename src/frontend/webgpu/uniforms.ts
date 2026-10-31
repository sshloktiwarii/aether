/**
 * WebGPU Uniform Buffer Management & Orthographic Camera Projection.
 * Synchronizes viewport resolution, cell dimensions, and animation timers to WGSL shaders.
 */

export class TerminalUniforms {
  public static readonly BYTE_LENGTH = 48; // 12 x 4 bytes (aligned to 16 bytes)

  public buffer: GPUBuffer | null = null;
  private data = new Float32Array(12);

  public init(device: GPUDevice): void {
    this.buffer = device.createBuffer({
      label: 'aether_terminal_uniforms_buffer',
      size: TerminalUniforms.BYTE_LENGTH,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Updates uniform buffer parameters and commits to GPU memory.
   */
  public update(
    device: GPUDevice,
    viewportW: number,
    viewportH: number,
    cellW: number,
    cellH: number,
    atlasW: number,
    atlasH: number,
    timeSec: number,
    sdfRange = 4.0,
    cursorBlink = 1.0
  ): void {
    if (!this.buffer) return;

    // Layout:
    // [0, 1] = viewport_size (w, h)
    // [2, 3] = cell_size (w, h)
    // [4, 5] = atlas_size (w, h)
    // [6]    = time
    // [7]    = sdf_range
    // [8]    = cursor_blink
    // [9..11] = padding
    this.data[0] = viewportW;
    this.data[1] = viewportH;
    this.data[2] = cellW;
    this.data[3] = cellH;
    this.data[4] = atlasW;
    this.data[5] = atlasH;
    this.data[6] = timeSec;
    this.data[7] = sdfRange;
    this.data[8] = cursorBlink;
    this.data[9] = 0.0;
    this.data[10] = 0.0;
    this.data[11] = 0.0;

    device.queue.writeBuffer(this.buffer, 0, this.data.buffer as ArrayBuffer);
  }
}

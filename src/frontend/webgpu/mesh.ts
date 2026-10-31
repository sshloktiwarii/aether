/**
 * Static Unit Quad Mesh & Vertex Buffer Descriptors for Instanced WebGPU Rendering.
 * Provides a 4-vertex triangle strip quad covering [0,0] to [1,1].
 */

export class QuadMesh {
  public static readonly VERTICES = new Float32Array([
    0.0, 0.0, // Top-Left
    1.0, 0.0, // Top-Right
    0.0, 1.0, // Bottom-Left
    1.0, 1.0, // Bottom-Right
  ]);

  public buffer: GPUBuffer | null = null;

  /**
   * Allocates and uploads the static unit quad vertex buffer to GPU memory.
   */
  public init(device: GPUDevice): void {
    this.buffer = device.createBuffer({
      label: 'aether_unit_quad_vbo',
      size: QuadMesh.VERTICES.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(this.buffer, 0, QuadMesh.VERTICES.buffer as ArrayBuffer);
  }

  /**
   * Vertex buffer layout descriptor for the unit quad.
   */
  public static get vertexBufferLayout(): GPUVertexBufferLayout {
    return {
      arrayStride: 8, // 2 x float32 (8 bytes)
      stepMode: 'vertex',
      attributes: [
        {
          shaderLocation: 0,
          offset: 0,
          format: 'float32x2',
        },
      ],
    };
  }

  /**
   * Instance buffer layout descriptor (48 bytes per cell instance).
   */
  public static get instanceBufferLayout(): GPUVertexBufferLayout {
    return {
      arrayStride: 48, // 48 bytes aligned instance struct
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 1, offset: 0, format: 'float32x2' },  // cell_pos (x, y)
        { shaderLocation: 2, offset: 8, format: 'float32x2' },  // cell_size (w, h)
        { shaderLocation: 3, offset: 16, format: 'float32x2' }, // uv_min (u0, v0)
        { shaderLocation: 4, offset: 24, format: 'float32x2' }, // uv_max (u1, v1)
        { shaderLocation: 5, offset: 32, format: 'uint32' },    // fg_color
        { shaderLocation: 6, offset: 36, format: 'uint32' },    // bg_color
        { shaderLocation: 7, offset: 40, format: 'uint32' },    // flags
        { shaderLocation: 8, offset: 44, format: 'uint32' },    // glyph_index
      ],
    };
  }
}

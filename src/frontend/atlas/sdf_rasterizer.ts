/**
 * 8-Bit Signed Sequential Euclidean Distance Transform (8SSEDT).
 * Computes exact 2D signed distance fields in linear O(W*H) time
 * via separable squared parabolic envelope reduction.
 */

const INF = 1e9;

export class SdfRasterizer {
  public readonly radius: number;

  constructor(radius = 4) {
    this.radius = radius;
  }

  /**
   * Generates an 8-bit SDF bitmap from an input alpha buffer (0..255).
   * 128 = glyph contour edge, > 128 = inside glyph, < 128 = outside glyph.
   */
  public generateSdf(
    alphaMask: Uint8Array,
    width: number,
    height: number
  ): Uint8Array {
    const size = width * height;
    const gridOuter = new Float32Array(size);
    const gridInner = new Float32Array(size);

    for (let i = 0; i < size; i++) {
      const a = alphaMask[i] / 255.0;
      if (a >= 0.5) {
        gridOuter[i] = INF;
        gridInner[i] = 0.0;
      } else {
        gridOuter[i] = 0.0;
        gridInner[i] = INF;
      }
    }

    // 2D distance transforms for outer and inner boundaries
    this.distanceTransform2D(gridOuter, width, height);
    this.distanceTransform2D(gridInner, width, height);

    const outSdf = new Uint8Array(size);
    const rad = this.radius;

    for (let i = 0; i < size; i++) {
      const dOut = Math.sqrt(gridOuter[i]);
      const dIn = Math.sqrt(gridInner[i]);
      const signedDist = dIn - dOut;
      const normalized = 128.0 + 128.0 * (signedDist / rad);
      outSdf[i] = Math.max(0, Math.min(255, Math.round(normalized)));
    }

    return outSdf;
  }

  /**
   * Separable 2D Distance Transform via 1D parabolic envelopes (Felzenszwalb & Huttenlocher).
   */
  private distanceTransform2D(grid: Float32Array, width: number, height: number): void {
    const maxDim = Math.max(width, height);
    const f = new Float32Array(maxDim);
    const d = new Float32Array(maxDim);
    const v = new Int32Array(maxDim);
    const z = new Float32Array(maxDim + 1);

    // Transform columns
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        f[y] = grid[y * width + x];
      }
      this.distanceTransform1D(f, height, d, v, z);
      for (let y = 0; y < height; y++) {
        grid[y * width + x] = d[y];
      }
    }

    // Transform rows
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        f[x] = grid[y * width + x];
      }
      this.distanceTransform1D(f, width, d, v, z);
      for (let x = 0; x < width; x++) {
        grid[y * width + x] = d[x];
      }
    }
  }

  /**
   * 1D Parabolic lower envelope squared distance transform.
   */
  private distanceTransform1D(
    f: Float32Array,
    n: number,
    d: Float32Array,
    v: Int32Array,
    z: Float32Array
  ): void {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;

    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }

    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) {
        k++;
      }
      const dx = q - v[k];
      d[q] = dx * dx + f[v[k]];
    }
  }
}

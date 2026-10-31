/**
 * WebGPU Device, Adapter, and Canvas Surface Context Initialization.
 * Supports High-Performance GPU adapters, DPR calibration, and device loss recovery.
 */

export class WebGpuContext {
  public adapter: GPUAdapter | null = null;
  public device: GPUDevice | null = null;
  public context: GPUCanvasContext | null = null;
  public format: GPUTextureFormat = 'bgra8unorm';
  public width = 0;
  public height = 0;
  public dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {}

  /**
   * Initializes WebGPU adapter, device, and configures the canvas.
   */
  public async init(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn('[AETHER] WebGPU not supported on this browser or platform.');
      return false;
    }

    try {
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!this.adapter) {
        console.warn('[AETHER] Failed to acquire high-performance GPUAdapter.');
        return false;
      }

      this.device = await this.adapter.requestDevice({
        label: 'aether_webgpu_device',
        requiredFeatures: [],
      });

      this.device.lost.then((info) => {
        console.error(`[AETHER] WebGPU device was lost: ${info.message}`, info);
      });

      this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
      if (!this.context) {
        console.error('[AETHER] Failed to acquire webgpu context from canvas.');
        return false;
      }

      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.resize();

      return true;
    } catch (err) {
      console.error('[AETHER] WebGPU initialization exception:', err);
      return false;
    }
  }

  /**
   * Resizes canvas buffer to match physical device display pixels.
   */
  public resize(): { width: number; height: number } {
    this.dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.floor(this.canvas.clientWidth * this.dpr) || 1280;
    const displayHeight = Math.floor(this.canvas.clientHeight * this.dpr) || 720;

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }

    this.width = displayWidth;
    this.height = displayHeight;

    if (this.context && this.device) {
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });
    }

    return { width: this.width, height: this.height };
  }
}

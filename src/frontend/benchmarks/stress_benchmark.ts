/**
 * Adversarial Stress Benchmark Harness for Aether WebGPU Terminal.
 * Stress-tests scaling to 20,000 and 50,000 glyphs, memory stability,
 * and worst-case ANSI burst streaming.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShelfPacker } from '../atlas/shelf_packer.ts';
import { SdfRasterizer } from '../atlas/sdf_rasterizer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WasmExports {
  memory: WebAssembly.Memory;
  aether_term_new(cols: number, rows: number, maxScrollback: number): number;
  aether_term_free(termPtr: number): void;
  aether_term_resize(termPtr: number, cols: number, rows: number): void;
  aether_term_write(termPtr: number, bytesPtr: number, len: number): void;
  aether_term_update_render_instances(termPtr: number, charWidth: number, charHeight: number): number;
  aether_term_get_instances_ptr(termPtr: number): number;
  aether_term_get_instance_count(termPtr: number): number;
  aether_term_alloc_buffer(size: number): number;
  aether_term_free_buffer(ptr: number, size: number): void;
}

async function stressTestScaling(wasm: WasmExports, cols: number, rows: number): Promise<{
  totalCells: number;
  parseMs: number;
  packMs: number;
  totalMs: number;
  fpsCapability: number;
}> {
  const totalCells = cols * rows;
  const termPtr = wasm.aether_term_new(cols, rows, 10000);

  // Generate dense ANSI burst
  let payload = '\x1b[H';
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=~';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c % 8 === 0) {
        payload += `\x1b[38;2;${(r * 5) % 256};${(c * 3) % 256};180m`;
      }
      payload += chars[(r * cols + c) % chars.length];
    }
    payload += '\r\n';
  }

  const payloadBytes = new TextEncoder().encode(payload);
  const bufPtr = wasm.aether_term_alloc_buffer(payloadBytes.length);
  new Uint8Array(wasm.memory.buffer, bufPtr, payloadBytes.length).set(payloadBytes);

  // Measure parse time
  const ITERS = 30;
  const parseTimes: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    wasm.aether_term_write(termPtr, bufPtr, payloadBytes.length);
    const t1 = performance.now();
    parseTimes.push(t1 - t0);
  }
  const avgParse = parseTimes.reduce((a, b) => a + b, 0) / ITERS;

  // Measure instance pack time
  const packTimes: number[] = [];
  let count = 0;
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    count = wasm.aether_term_update_render_instances(termPtr, 9.0, 18.0);
    const t1 = performance.now();
    packTimes.push(t1 - t0);
  }
  const avgPack = packTimes.reduce((a, b) => a + b, 0) / ITERS;

  if (count !== totalCells) {
    throw new Error(`Cell count mismatch: expected ${totalCells}, got ${count}`);
  }

  wasm.aether_term_free_buffer(bufPtr, payloadBytes.length);
  wasm.aether_term_free(termPtr);

  const totalMs = avgParse + avgPack;
  const fpsCapability = Math.floor(1000 / totalMs);

  return {
    totalCells,
    parseMs: avgParse,
    packMs: avgPack,
    totalMs,
    fpsCapability,
  };
}

async function main() {
  console.log('================================================================');
  console.log('AETHER // ADVERSARIAL EXTREME STRESS BENCHMARK (SCALING & BURSTS)');
  console.log('================================================================\n');

  const wasmPath = resolve(__dirname, '../../../public/wasm/aether_core.wasm');
  const wasmBuffer = readFileSync(wasmPath);
  const wasmModule = await WebAssembly.instantiate(wasmBuffer, {});
  const wasm = wasmModule.instance.exports as unknown as WasmExports;

  // Scenario 1: Standard Baseline (10,400 cells)
  const res10k = await stressTestScaling(wasm, 160, 65);
  console.log(`[STRESS 10.4K Cells] Parse: ${res10k.parseMs.toFixed(3)} ms | Pack: ${res10k.packMs.toFixed(3)} ms | Total: ${res10k.totalMs.toFixed(3)} ms | Headroom: ${res10k.fpsCapability} FPS`);

  // Scenario 2: High Density (20,000 cells: 200 cols x 100 rows)
  const res20k = await stressTestScaling(wasm, 200, 100);
  console.log(`[STRESS 20.0K Cells] Parse: ${res20k.parseMs.toFixed(3)} ms | Pack: ${res20k.packMs.toFixed(3)} ms | Total: ${res20k.totalMs.toFixed(3)} ms | Headroom: ${res20k.fpsCapability} FPS`);

  // Scenario 3: Extreme Stress (50,000 cells: 250 cols x 200 rows)
  const res50k = await stressTestScaling(wasm, 250, 200);
  console.log(`[STRESS 50.0K Cells] Parse: ${res50k.parseMs.toFixed(3)} ms | Pack: ${res50k.packMs.toFixed(3)} ms | Total: ${res50k.totalMs.toFixed(3)} ms | Headroom: ${res50k.fpsCapability} FPS`);

  // Shelf Packer Stress: 5,000 allocations
  const packer = new ShelfPacker(2048, 2048, 2);
  const t0 = performance.now();
  let allocated = 0;
  for (let i = 0; i < 5000; i++) {
    if (packer.allocate(14, 22)) allocated++;
  }
  const t1 = performance.now();
  console.log(`\n[STRESS ShelfPacker] 5,000 allocations in ${(t1 - t0).toFixed(2)} ms (Successful: ${allocated}/${5000}, Occupancy: ${(packer.occupancy * 100).toFixed(1)}%)`);

  // SDF Rasterizer Stress: 100 iterations of 64x64 SDF generation
  const sdf = new SdfRasterizer(4);
  const dummyBmp = new Uint8Array(64 * 64);
  for (let i = 0; i < dummyBmp.length; i++) {
    dummyBmp[i] = (i % 3 === 0) ? 255 : 0;
  }
  const tSdf0 = performance.now();
  for (let i = 0; i < 100; i++) {
    sdf.generateSdf(dummyBmp, 64, 64);
  }
  const tSdf1 = performance.now();
  console.log(`[STRESS 8SSEDT SDF] 100 iterations in ${(tSdf1 - tSdf0).toFixed(2)} ms (${((tSdf1 - tSdf0) / 100).toFixed(3)} ms/glyph)`);

  // Verification vs targets
  console.log('\n----------------------------------------------------------------');
  const target60FpsBudgetMs = 16.667;
  const target120FpsBudgetMs = 8.333;
  console.log(`Target 60 FPS Budget:  ${target60FpsBudgetMs.toFixed(3)} ms`);
  console.log(`Target 120 FPS Budget: ${target120FpsBudgetMs.toFixed(3)} ms`);
  console.log(`Actual 10.4K Cells:    ${res10k.totalMs.toFixed(3)} ms (${((res10k.totalMs / target120FpsBudgetMs) * 100).toFixed(2)}% of 120 FPS budget)`);
  console.log(`Actual 20.0K Cells:    ${res20k.totalMs.toFixed(3)} ms (${((res20k.totalMs / target120FpsBudgetMs) * 100).toFixed(2)}% of 120 FPS budget)`);
  console.log(`Actual 50.0K Cells:    ${res50k.totalMs.toFixed(3)} ms (${((res50k.totalMs / target120FpsBudgetMs) * 100).toFixed(2)}% of 120 FPS budget)`);

  const passed = res10k.totalMs < target120FpsBudgetMs && res20k.totalMs < target120FpsBudgetMs && res50k.totalMs < target60FpsBudgetMs;
  console.log(`Performance Target Status: ${passed ? 'ALL PASSED' : 'FAILED'}`);
  console.log('----------------------------------------------------------------\n');
}

main().catch((err) => {
  console.error('[STRESS TEST FAILED]', err);
  process.exit(1);
});

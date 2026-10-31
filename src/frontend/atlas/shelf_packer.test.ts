/**
 * Shelf Bin-Packer Unit Tests.
 * Verifies shelf allocation efficiency, UV bounds, and capacity limits.
 */

import { ShelfPacker } from './shelf_packer.ts';

export function runShelfPackerTests(): boolean {
  console.log('[TEST] Running ShelfPacker test suite...');
  const packer = new ShelfPacker(256, 256, 2);

  // Test 1: Single allocation fits
  const r1 = packer.allocate(16, 24);
  if (!r1) throw new Error('Failed to allocate single glyph');
  if (r1.uvMin[0] < 0 || r1.uvMax[0] > 1 || r1.uvMin[1] < 0 || r1.uvMax[1] > 1) {
    throw new Error('UV coordinates out of [0, 1] bounds');
  }

  // Test 2: Best-Height-Fit reuse on same shelf
  const r2 = packer.allocate(16, 24);
  if (!r2) throw new Error('Failed to allocate second glyph');
  if (r2.y !== r1.y) {
    throw new Error('Expected same shelf allocation for identical height');
  }
  if (r2.x <= r1.x) {
    throw new Error('Expected monotonic X advance on shelf');
  }

  // Test 3: Multiple allocations filling width
  for (let i = 0; i < 10; i++) {
    packer.allocate(16, 24);
  }

  // Test 4: Occupancy metric
  if (packer.occupancy <= 0 || packer.occupancy > 1) {
    throw new Error(`Invalid occupancy ratio: ${packer.occupancy}`);
  }

  // Test 5: Exhaustion boundary
  const oversized = packer.allocate(512, 512);
  if (oversized !== null) {
    throw new Error('Oversized allocation should return null');
  }

  console.log('[TEST] ShelfPacker test suite PASSED.');
  return true;
}

// Self-run if in Node environment
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('shelf_packer.test.ts')) {
  runShelfPackerTests();
}

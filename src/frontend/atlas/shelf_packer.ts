/**
 * Dynamic Shelf Bin-Packing Algorithm for Glyph Texture Atlas.
 * Implements Best-Height-Fit (BHF) shelf allocation on a 2048x2048 texel map.
 */

export interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
  uvMin: [number, number];
  uvMax: [number, number];
}

interface Shelf {
  y: number;
  height: number;
  currentX: number;
}

export class ShelfPacker {
  public readonly width: number;
  public readonly height: number;
  public readonly padding: number;

  private shelves: Shelf[] = [];
  private allocatedArea = 0;

  constructor(width = 2048, height = 2048, padding = 2) {
    this.width = width;
    this.height = height;
    this.padding = padding;
  }

  /**
   * Allocates space for a glyph with padding using Best-Height-Fit.
   */
  public allocate(glyphWidth: number, glyphHeight: number): AtlasRect | null {
    const totalW = glyphWidth + this.padding * 2;
    const totalH = glyphHeight + this.padding * 2;

    if (totalW > this.width || totalH > this.height) {
      return null;
    }

    let bestShelfIndex = -1;
    let bestHeightWaste = Infinity;

    // Search existing shelves using Best-Height-Fit
    for (let i = 0; i < this.shelves.length; i++) {
      const shelf = this.shelves[i];
      if (shelf.currentX + totalW <= this.width && shelf.height >= totalH) {
        const heightWaste = shelf.height - totalH;
        if (heightWaste < bestHeightWaste) {
          bestHeightWaste = heightWaste;
          bestShelfIndex = i;
        }
      }
    }

    let rectX = 0;
    let rectY = 0;

    if (bestShelfIndex !== -1) {
      const shelf = this.shelves[bestShelfIndex];
      rectX = shelf.currentX;
      rectY = shelf.y;
      shelf.currentX += totalW;
    } else {
      // Allocate a new shelf
      const nextY = this.shelves.length === 0
        ? 0
        : this.shelves[this.shelves.length - 1].y + this.shelves[this.shelves.length - 1].height;

      if (nextY + totalH > this.height) {
        // Texture full
        return null;
      }

      rectX = 0;
      rectY = nextY;
      this.shelves.push({
        y: nextY,
        height: totalH,
        currentX: totalW,
      });
    }

    this.allocatedArea += totalW * totalH;

    // Inner glyph rect excluding padding
    const innerX = rectX + this.padding;
    const innerY = rectY + this.padding;

    const uvMin: [number, number] = [
      innerX / this.width,
      innerY / this.height,
    ];
    const uvMax: [number, number] = [
      (innerX + glyphWidth) / this.width,
      (innerY + glyphHeight) / this.height,
    ];

    return {
      x: innerX,
      y: innerY,
      width: glyphWidth,
      height: glyphHeight,
      uvMin,
      uvMax,
    };
  }

  /**
   * Ratio of allocated pixels to total atlas capacity.
   */
  public get occupancy(): number {
    return this.allocatedArea / (this.width * this.height);
  }

  /**
   * Resets all shelves.
   */
  public reset(): void {
    this.shelves = [];
    this.allocatedArea = 0;
  }
}

//! Terminal cell and row memory structures.
//! Designed for zero-copy binary serialization and memory-mapped cache locality.

use alloc::vec::Vec;

pub const FLAG_BOLD: u16 = 1 << 0;
pub const FLAG_ITALIC: u16 = 1 << 1;
pub const FLAG_UNDERLINE: u16 = 1 << 2;
pub const FLAG_INVERSE: u16 = 1 << 3;
pub const FLAG_STRIKETHROUGH: u16 = 1 << 4;
pub const FLAG_BLINK: u16 = 1 << 5;
pub const FLAG_WIDE_LEAD: u16 = 1 << 6;
pub const FLAG_WIDE_TAIL: u16 = 1 << 7;

/// 16-byte aligned terminal cell representation.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cell {
    pub c: u32,       // Unicode codepoint (ASCII or multi-byte UTF-8)
    pub fg: u32,      // Packed RGBA (0xRRGGBBAA)
    pub bg: u32,      // Packed RGBA (0xRRGGBBAA)
    pub flags: u16,   // Attribute bitfield flags
    pub width: u8,    // Column width (1=normal, 2=wide glyph, 0=continuation)
    pub _pad: u8,     // Explicit padding byte for 16-byte alignment
}

impl Cell {
    pub const DEFAULT_FG: u32 = 0xCCCCCCFF;
    pub const DEFAULT_BG: u32 = 0x00000000;

    #[inline(always)]
    pub const fn empty() -> Self {
        Self {
            c: ' ' as u32,
            fg: Self::DEFAULT_FG,
            bg: Self::DEFAULT_BG,
            flags: 0,
            width: 1,
            _pad: 0,
        }
    }

    #[inline(always)]
    pub const fn pack_rgba(r: u8, g: u8, b: u8, a: u8) -> u32 {
        ((r as u32) << 24) | ((g as u32) << 16) | ((b as u32) << 8) | (a as u32)
    }

    #[inline(always)]
    pub const fn unpack_rgba(packed: u32) -> (u8, u8, u8, u8) {
        (
            ((packed >> 24) & 0xFF) as u8,
            ((packed >> 16) & 0xFF) as u8,
            ((packed >> 8) & 0xFF) as u8,
            (packed & 0xFF) as u8,
        )
    }

    #[inline(always)]
    pub fn reset(&mut self, default_fg: u32, default_bg: u32) {
        self.c = ' ' as u32;
        self.fg = default_fg;
        self.bg = default_bg;
        self.flags = 0;
        self.width = 1;
        self._pad = 0;
    }

    #[inline(always)]
    pub fn has_flag(&self, flag: u16) -> bool {
        (self.flags & flag) != 0
    }

    #[inline(always)]
    pub fn set_flag(&mut self, flag: u16) {
        self.flags |= flag;
    }

    #[inline(always)]
    pub fn clear_flag(&mut self, flag: u16) {
        self.flags &= !flag;
    }
}

impl Default for Cell {
    fn default() -> Self {
        Self::empty()
    }
}

/// A single terminal line with wrap metadata.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub cells: Vec<Cell>,
    pub is_wrapped: bool,
}

impl Row {
    pub fn new(cols: usize, default_cell: Cell) -> Self {
        let mut cells = Vec::with_capacity(cols);
        cells.resize(cols, default_cell);
        Self {
            cells,
            is_wrapped: false,
        }
    }

    pub fn resize(&mut self, new_cols: usize, default_cell: Cell) {
        self.cells.resize(new_cols, default_cell);
    }

    pub fn clear(&mut self, default_cell: Cell) {
        for cell in self.cells.iter_mut() {
            *cell = default_cell;
        }
        self.is_wrapped = false;
    }

    pub fn erase_range(&mut self, start_col: usize, end_col: usize, default_cell: Cell) {
        let limit = end_col.min(self.cells.len());
        for col in start_col..limit {
            self.cells[col] = default_cell;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{align_of, size_of};

    #[test]
    fn test_cell_memory_layout() {
        assert_eq!(size_of::<Cell>(), 16, "Cell must be exactly 16 bytes");
        assert!(align_of::<Cell>() >= 4, "Cell alignment must be at least 4 bytes");
    }

    #[test]
    fn test_rgba_pack_unpack() {
        let packed = Cell::pack_rgba(0xDE, 0xAD, 0xBE, 0xEF);
        assert_eq!(packed, 0xDEADBEEF);
        let (r, g, b, a) = Cell::unpack_rgba(packed);
        assert_eq!(r, 0xDE);
        assert_eq!(g, 0xAD);
        assert_eq!(b, 0xBE);
        assert_eq!(a, 0xEF);
    }

    #[test]
    fn test_cell_flags() {
        let mut cell = Cell::empty();
        assert_eq!(cell.flags, 0);

        cell.set_flag(FLAG_BOLD);
        cell.set_flag(FLAG_ITALIC);
        assert!(cell.has_flag(FLAG_BOLD));
        assert!(cell.has_flag(FLAG_ITALIC));
        assert!(!cell.has_flag(FLAG_UNDERLINE));

        cell.clear_flag(FLAG_BOLD);
        assert!(!cell.has_flag(FLAG_BOLD));
        assert!(cell.has_flag(FLAG_ITALIC));
    }

    #[test]
    fn test_row_operations() {
        let default_cell = Cell::empty();
        let mut row = Row::new(80, default_cell);
        assert_eq!(row.cells.len(), 80);
        assert!(!row.is_wrapped);

        let mut custom = default_cell;
        custom.c = 'X' as u32;
        row.cells[5] = custom;
        assert_eq!(row.cells[5].c, 'X' as u32);

        row.erase_range(5, 6, default_cell);
        assert_eq!(row.cells[5].c, ' ' as u32);

        row.resize(120, default_cell);
        assert_eq!(row.cells.len(), 120);
    }
}

//! Circular scrollback buffer ring for terminal history management.
//! Provides O(1) row eviction and stable circular indexing without reallocation.

use alloc::vec::Vec;
use crate::grid::{Cell, Row};

/// Ring buffer storing scrolled-off terminal lines up to `max_history`.
#[derive(Clone, Debug)]
pub struct ScrollbackBuffer {
    rows: Vec<Row>,
    max_history: usize,
    head: usize, // Next write position
    len: usize,  // Current active history count
}

impl ScrollbackBuffer {
    pub fn new(max_history: usize) -> Self {
        let max_history = max_history.max(1);
        Self {
            rows: Vec::with_capacity(max_history),
            max_history,
            head: 0,
            len: 0,
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.max_history
    }

    /// Pushes a completed row into the circular ring buffer.
    pub fn push(&mut self, row: Row) {
        if self.len < self.max_history {
            self.rows.push(row);
            self.len += 1;
            self.head = (self.head + 1) % self.max_history;
        } else {
            // Overwrite oldest row at current head
            self.rows[self.head] = row;
            self.head = (self.head + 1) % self.max_history;
        }
    }

    /// Retrieves a row indexed from oldest (0) to newest (len - 1).
    pub fn get_from_top(&self, index: usize) -> Option<&Row> {
        if index >= self.len {
            return None;
        }
        let physical_idx = if self.len < self.max_history {
            index
        } else {
            (self.head + index) % self.max_history
        };
        self.rows.get(physical_idx)
    }

    /// Retrieves a row indexed from newest (0) to oldest (len - 1).
    pub fn get_from_bottom(&self, offset: usize) -> Option<&Row> {
        if offset >= self.len {
            return None;
        }
        let index = self.len - 1 - offset;
        self.get_from_top(index)
    }

    /// Clears all history lines.
    pub fn clear(&mut self) {
        self.rows.clear();
        self.head = 0;
        self.len = 0;
    }

    /// Resizes column count across all stored rows.
    pub fn resize_cols(&mut self, new_cols: usize, default_cell: Cell) {
        for row in self.rows.iter_mut() {
            row.resize(new_cols, default_cell);
        }
    }
}

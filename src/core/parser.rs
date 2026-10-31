//! DEC ANSI / VT100 byte parser implementing the Paul Flo Williams state machine.
//! Zero-allocation stream parsing over raw byte buffers.

use alloc::string::String;
use alloc::vec::Vec;
use crate::buffer::ScrollbackBuffer;
use crate::grid::{Cell, Row};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParserState {
    Ground,
    Escape,
    EscapeIntermediate,
    CsiEntry,
    CsiParam,
    CsiIntermediate,
    CsiIgnore,
    OscString,
}

/// ANSI parser state machine and parameter accumulator.
#[derive(Clone, Debug)]
pub struct Parser {
    pub state: ParserState,
    pub params: [u16; 16],
    pub param_count: usize,
    pub current_param: u16,
    pub has_param: bool,
    pub is_private: bool,
    pub intermediates: [u8; 4],
    pub intermediates_len: usize,
    pub osc_buffer: Vec<u8>,
}

impl Parser {
    pub fn new() -> Self {
        Self {
            state: ParserState::Ground,
            params: [0; 16],
            param_count: 0,
            current_param: 0,
            has_param: false,
            is_private: false,
            intermediates: [0; 4],
            intermediates_len: 0,
            osc_buffer: Vec::with_capacity(256),
        }
    }

    pub fn reset_params(&mut self) {
        self.params = [0; 16];
        self.param_count = 0;
        self.current_param = 0;
        self.has_param = false;
        self.is_private = false;
        self.intermediates = [0; 4];
        self.intermediates_len = 0;
    }

    pub fn push_param_digit(&mut self, digit: u8) {
        self.has_param = true;
        self.current_param = self.current_param.saturating_mul(10).saturating_add((digit - b'0') as u16);
    }

    pub fn finish_param(&mut self) {
        if self.param_count < 16 {
            let val = if self.has_param { self.current_param } else { 0 };
            self.params[self.param_count] = val;
            self.param_count += 1;
        }
        self.current_param = 0;
        self.has_param = false;
    }

    pub fn get_param(&self, index: usize, default_val: u16) -> u16 {
        if index < self.param_count {
            let val = self.params[index];
            if val == 0 { default_val } else { val }
        } else {
            default_val
        }
    }
}

/// Terminal state machine maintaining screen grids, scrollback, and ANSI state.
pub struct Terminal {
    pub cols: usize,
    pub rows: usize,
    pub cursor_x: usize,
    pub cursor_y: usize,
    pub saved_x: usize,
    pub saved_y: usize,
    pub current_fg: u32,
    pub current_bg: u32,
    pub current_flags: u16,

    pub primary_screen: Vec<Row>,
    pub scrollback: ScrollbackBuffer,
    pub alt_screen: Vec<Row>,
    pub is_alt_screen: bool,

    pub scroll_top: usize,
    pub scroll_bottom: usize,
    pub auto_wrap: bool,
    pub cursor_visible: bool,
    pub bracketed_paste: bool,
    pub app_cursor_keys: bool,

    pub title: String,
    pub dirty: bool,
    pub parser: Parser,
    pub scroll_offset: usize, // User scroll offset (0 = at bottom)
}

impl Terminal {
    pub fn new(cols: usize, rows: usize, max_scrollback: usize) -> Self {
        let cols = cols.max(1);
        let rows = rows.max(1);
        let default_cell = Cell::empty();

        let mut primary_screen = Vec::with_capacity(rows);
        for _ in 0..rows {
            primary_screen.push(Row::new(cols, default_cell));
        }

        let mut alt_screen = Vec::with_capacity(rows);
        for _ in 0..rows {
            alt_screen.push(Row::new(cols, default_cell));
        }

        Self {
            cols,
            rows,
            cursor_x: 0,
            cursor_y: 0,
            saved_x: 0,
            saved_y: 0,
            current_fg: Cell::DEFAULT_FG,
            current_bg: Cell::DEFAULT_BG,
            current_flags: 0,
            primary_screen,
            scrollback: ScrollbackBuffer::new(max_scrollback),
            alt_screen,
            is_alt_screen: false,
            scroll_top: 0,
            scroll_bottom: rows.saturating_sub(1),
            auto_wrap: true,
            cursor_visible: true,
            bracketed_paste: false,
            app_cursor_keys: false,
            title: String::new(),
            dirty: true,
            parser: Parser::new(),
            scroll_offset: 0,
        }
    }

    #[inline]
    pub fn active_rows_mut(&mut self) -> &mut Vec<Row> {
        if self.is_alt_screen {
            &mut self.alt_screen
        } else {
            &mut self.primary_screen
        }
    }

    #[inline]
    pub fn active_rows(&self) -> &Vec<Row> {
        if self.is_alt_screen {
            &self.alt_screen
        } else {
            &self.primary_screen
        }
    }

    /// Process a stream of raw bytes through the state machine.
    pub fn write_bytes(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.process_byte(b);
        }
    }

    /// Single byte transition function for the Paul Flo Williams state machine.
    pub fn process_byte(&mut self, b: u8) {
        // Universal ESC sequence interrupt
        if b == 0x1B {
            self.parser.state = ParserState::Escape;
            self.parser.reset_params();
            return;
        }

        match self.parser.state {
            ParserState::Ground => {
                if b >= 0x20 && b <= 0x7E {
                    self.print_char(b as u32);
                } else if b < 0x20 {
                    self.handle_c0(b);
                } else {
                    // High-byte / UTF-8 basic print
                    self.print_char(b as u32);
                }
            }
            ParserState::Escape => {
                match b {
                    b'[' => self.parser.state = ParserState::CsiEntry,
                    b']' => {
                        self.parser.state = ParserState::OscString;
                        self.parser.osc_buffer.clear();
                    }
                    b'(' | b')' => self.parser.state = ParserState::EscapeIntermediate,
                    b'7' => {
                        self.saved_x = self.cursor_x;
                        self.saved_y = self.cursor_y;
                        self.parser.state = ParserState::Ground;
                    }
                    b'8' => {
                        self.cursor_x = self.saved_x.min(self.cols.saturating_sub(1));
                        self.cursor_y = self.saved_y.min(self.rows.saturating_sub(1));
                        self.parser.state = ParserState::Ground;
                    }
                    b'M' => {
                        // Reverse index
                        if self.cursor_y > self.scroll_top {
                            self.cursor_y -= 1;
                        } else {
                            self.scroll_down_region(1);
                        }
                        self.parser.state = ParserState::Ground;
                    }
                    b'c' => {
                        // Full terminal reset (RIS)
                        self.reset();
                        self.parser.state = ParserState::Ground;
                    }
                    _ => self.parser.state = ParserState::Ground,
                }
            }
            ParserState::EscapeIntermediate => {
                // Character set designation (ignored for UTF-8 monospace)
                self.parser.state = ParserState::Ground;
            }
            ParserState::CsiEntry => {
                if b == b'?' {
                    self.parser.is_private = true;
                } else if b >= b'0' && b <= b'9' {
                    self.parser.state = ParserState::CsiParam;
                    self.parser.push_param_digit(b);
                } else if b == b';' {
                    self.parser.state = ParserState::CsiParam;
                    self.parser.finish_param();
                } else if b >= 0x20 && b <= 0x2F {
                    self.parser.state = ParserState::CsiIntermediate;
                    if self.parser.intermediates_len < 4 {
                        self.parser.intermediates[self.parser.intermediates_len] = b;
                        self.parser.intermediates_len += 1;
                    }
                } else if b >= 0x40 && b <= 0x7E {
                    self.execute_csi(b);
                    self.parser.state = ParserState::Ground;
                } else {
                    self.parser.state = ParserState::CsiIgnore;
                }
            }
            ParserState::CsiParam => {
                if b >= b'0' && b <= b'9' {
                    self.parser.push_param_digit(b);
                } else if b == b';' {
                    self.parser.finish_param();
                } else if b >= 0x20 && b <= 0x2F {
                    self.parser.finish_param();
                    self.parser.state = ParserState::CsiIntermediate;
                    if self.parser.intermediates_len < 4 {
                        self.parser.intermediates[self.parser.intermediates_len] = b;
                        self.parser.intermediates_len += 1;
                    }
                } else if b >= 0x40 && b <= 0x7E {
                    self.parser.finish_param();
                    self.execute_csi(b);
                    self.parser.state = ParserState::Ground;
                } else {
                    self.parser.state = ParserState::CsiIgnore;
                }
            }
            ParserState::CsiIntermediate => {
                if b >= 0x20 && b <= 0x2F {
                    if self.parser.intermediates_len < 4 {
                        self.parser.intermediates[self.parser.intermediates_len] = b;
                        self.parser.intermediates_len += 1;
                    }
                } else if b >= 0x40 && b <= 0x7E {
                    self.execute_csi(b);
                    self.parser.state = ParserState::Ground;
                } else {
                    self.parser.state = ParserState::CsiIgnore;
                }
            }
            ParserState::CsiIgnore => {
                if b >= 0x40 && b <= 0x7E {
                    self.parser.state = ParserState::Ground;
                }
            }
            ParserState::OscString => {
                if b == 0x07 || b == 0x1B {
                    self.execute_osc();
                    self.parser.state = ParserState::Ground;
                } else if self.parser.osc_buffer.len() < 1024 {
                    self.parser.osc_buffer.push(b);
                }
            }
        }
    }

    pub fn print_char(&mut self, c: u32) {
        if self.cursor_x >= self.cols {
            if self.auto_wrap {
                self.cursor_x = 0;
                self.line_feed();
            } else {
                self.cursor_x = self.cols.saturating_sub(1);
            }
        }

        let flags = self.current_flags;
        let fg = self.current_fg;
        let bg = self.current_bg;
        let cx = self.cursor_x;
        let cy = self.cursor_y;

        let rows = self.active_rows_mut();
        if cy < rows.len() && cx < rows[cy].cells.len() {
            rows[cy].cells[cx] = Cell {
                c,
                fg,
                bg,
                flags,
                width: 1,
                _pad: 0,
            };
        }

        self.cursor_x += 1;
        self.dirty = true;
    }

    pub fn reset(&mut self) {
        let cols = self.cols;
        let rows = self.rows;
        let default_cell = Cell::empty();
        self.primary_screen.clear();
        for _ in 0..rows {
            self.primary_screen.push(Row::new(cols, default_cell));
        }
        self.alt_screen.clear();
        for _ in 0..rows {
            self.alt_screen.push(Row::new(cols, default_cell));
        }
        self.scrollback.clear();
        self.cursor_x = 0;
        self.cursor_y = 0;
        self.saved_x = 0;
        self.saved_y = 0;
        self.current_fg = Cell::DEFAULT_FG;
        self.current_bg = Cell::DEFAULT_BG;
        self.current_flags = 0;
        self.is_alt_screen = false;
        self.scroll_top = 0;
        self.scroll_bottom = rows.saturating_sub(1);
        self.auto_wrap = true;
        self.cursor_visible = true;
        self.bracketed_paste = false;
        self.app_cursor_keys = false;
        self.dirty = true;
        self.parser.reset_params();
        self.parser.state = ParserState::Ground;
    }

    // C0 control code handling
    pub fn handle_c0(&mut self, b: u8) {
        match b {
            0x00 => {} // NUL - ignore
            0x07 => {
                // BEL - Terminal bell
                self.dirty = true;
            }
            0x08 => {
                // BS - Backspace
                self.cursor_x = self.cursor_x.saturating_sub(1);
                self.dirty = true;
            }
            0x09 => {
                // HT - Horizontal Tab (8-column tabstops)
                let next_tab = (self.cursor_x + 8) & !7;
                self.cursor_x = next_tab.min(self.cols.saturating_sub(1));
                self.dirty = true;
            }
            0x0A | 0x0B | 0x0C => {
                // LF / VT / FF - Line Feed
                self.line_feed();
            }
            0x0D => {
                // CR - Carriage Return
                self.cursor_x = 0;
                self.dirty = true;
            }
            _ => {}
        }
    }

    pub fn line_feed(&mut self) {
        if self.cursor_y == self.scroll_bottom {
            self.scroll_up_region(1);
        } else if self.cursor_y < self.rows.saturating_sub(1) {
            self.cursor_y += 1;
        }
        self.dirty = true;
    }

    pub fn scroll_up_region(&mut self, count: usize) {
        let scroll_top = self.scroll_top;
        let scroll_bottom = self.scroll_bottom;
        let count = count.min(scroll_bottom.saturating_sub(scroll_top) + 1);
        if count == 0 {
            return;
        }

        let is_full_screen = scroll_top == 0 && scroll_bottom == self.rows.saturating_sub(1);
        let default_cell = Cell::empty();
        let cols = self.cols;

        for _ in 0..count {
            if is_full_screen && !self.is_alt_screen {
                // Evict top row into scrollback
                let evicted = self.primary_screen.remove(0);
                self.scrollback.push(evicted);
                self.primary_screen.push(Row::new(cols, default_cell));
            } else {
                let rows = self.active_rows_mut();
                if scroll_top < rows.len() {
                    rows.remove(scroll_top);
                    let insert_pos = scroll_bottom.min(rows.len());
                    rows.insert(insert_pos, Row::new(cols, default_cell));
                }
            }
        }
        self.dirty = true;
    }

    pub fn scroll_down_region(&mut self, count: usize) {
        let scroll_top = self.scroll_top;
        let scroll_bottom = self.scroll_bottom;
        let count = count.min(scroll_bottom.saturating_sub(scroll_top) + 1);
        if count == 0 {
            return;
        }

        let default_cell = Cell::empty();
        let cols = self.cols;
        let rows = self.active_rows_mut();

        for _ in 0..count {
            if scroll_bottom < rows.len() {
                rows.remove(scroll_bottom);
            }
            let insert_pos = scroll_top.min(rows.len());
            rows.insert(insert_pos, Row::new(cols, default_cell));
        }
        self.dirty = true;
    }

    // Execute CSI action
    pub fn execute_csi(&mut self, action: u8) {
        if self.parser.is_private {
            self.execute_dec_private_mode(action);
            return;
        }

        match action {
            b'A' => {
                // CUU - Cursor Up
                let n = self.parser.get_param(0, 1) as usize;
                self.cursor_y = self.cursor_y.saturating_sub(n);
                self.dirty = true;
            }
            b'B' => {
                // CUD - Cursor Down
                let n = self.parser.get_param(0, 1) as usize;
                self.cursor_y = (self.cursor_y + n).min(self.rows.saturating_sub(1));
                self.dirty = true;
            }
            b'C' => {
                // CUF - Cursor Forward
                let n = self.parser.get_param(0, 1) as usize;
                self.cursor_x = (self.cursor_x + n).min(self.cols.saturating_sub(1));
                self.dirty = true;
            }
            b'D' => {
                // CUB - Cursor Back
                let n = self.parser.get_param(0, 1) as usize;
                self.cursor_x = self.cursor_x.saturating_sub(n);
                self.dirty = true;
            }
            b'E' => {
                // CNL - Cursor Next Line
                let n = self.parser.get_param(0, 1) as usize;
                self.cursor_x = 0;
                self.cursor_y = (self.cursor_y + n).min(self.rows.saturating_sub(1));
                self.dirty = true;
            }
            b'F' => {
                // CPL - Cursor Previous Line
                let n = self.parser.get_param(0, 1) as usize;
                self.cursor_x = 0;
                self.cursor_y = self.cursor_y.saturating_sub(n);
                self.dirty = true;
            }
            b'G' | b'`' => {
                // CHA - Cursor Horizontal Absolute (1-based)
                let col = self.parser.get_param(0, 1) as usize;
                self.cursor_x = col.saturating_sub(1).min(self.cols.saturating_sub(1));
                self.dirty = true;
            }
            b'H' | b'f' => {
                // CUP / HVP - Cursor Position (1-based row, col)
                let row = self.parser.get_param(0, 1) as usize;
                let col = self.parser.get_param(1, 1) as usize;
                self.cursor_y = row.saturating_sub(1).min(self.rows.saturating_sub(1));
                self.cursor_x = col.saturating_sub(1).min(self.cols.saturating_sub(1));
                self.dirty = true;
            }
            b'd' => {
                // VPA - Vertical Position Absolute (1-based)
                let row = self.parser.get_param(0, 1) as usize;
                self.cursor_y = row.saturating_sub(1).min(self.rows.saturating_sub(1));
                self.dirty = true;
            }
            _ => self.execute_csi_extended(action),
        }
    }

    pub fn execute_csi_extended(&mut self, action: u8) {
        let default_cell = Cell::empty();
        let cols = self.cols;
        let rows_len = self.rows;

        match action {
            b'J' => {
                // ED - Erase in Display
                let mode = self.parser.get_param(0, 0);
                let cx = self.cursor_x;
                let cy = self.cursor_y;
                let rows = self.active_rows_mut();

                match mode {
                    0 => {
                        // Cursor to end of display
                        if cy < rows.len() {
                            rows[cy].erase_range(cx, cols, default_cell);
                            for y in (cy + 1)..rows.len() {
                                rows[y].clear(default_cell);
                            }
                        }
                    }
                    1 => {
                        // Start of display to cursor
                        for y in 0..cy.min(rows.len()) {
                            rows[y].clear(default_cell);
                        }
                        if cy < rows.len() {
                            rows[cy].erase_range(0, cx + 1, default_cell);
                        }
                    }
                    2 => {
                        // Entire screen
                        for row in rows.iter_mut() {
                            row.clear(default_cell);
                        }
                    }
                    3 => {
                        // Entire screen + clear scrollback
                        for row in rows.iter_mut() {
                            row.clear(default_cell);
                        }
                        self.scrollback.clear();
                    }
                    _ => {}
                }
                self.dirty = true;
            }
            b'K' => {
                // EL - Erase in Line
                let mode = self.parser.get_param(0, 0);
                let cx = self.cursor_x;
                let cy = self.cursor_y;
                let rows = self.active_rows_mut();
                if cy < rows.len() {
                    match mode {
                        0 => rows[cy].erase_range(cx, cols, default_cell),
                        1 => rows[cy].erase_range(0, cx + 1, default_cell),
                        2 => rows[cy].clear(default_cell),
                        _ => {}
                    }
                }
                self.dirty = true;
            }
            b'L' => {
                // IL - Insert Lines at cursor row
                let n = self.parser.get_param(0, 1) as usize;
                let scroll_bottom = self.scroll_bottom;
                let cy = self.cursor_y;
                if cy >= self.scroll_top && cy <= scroll_bottom {
                    let rows = self.active_rows_mut();
                    for _ in 0..n {
                        if scroll_bottom < rows.len() {
                            rows.remove(scroll_bottom);
                        }
                        let insert_pos = cy.min(rows.len());
                        rows.insert(insert_pos, Row::new(cols, default_cell));
                    }
                }
                self.dirty = true;
            }
            b'M' => {
                // DL - Delete Lines at cursor row
                let n = self.parser.get_param(0, 1) as usize;
                let scroll_bottom = self.scroll_bottom;
                let cy = self.cursor_y;
                if cy >= self.scroll_top && cy <= scroll_bottom {
                    let rows = self.active_rows_mut();
                    for _ in 0..n {
                        if cy < rows.len() {
                            rows.remove(cy);
                        }
                        let insert_pos = scroll_bottom.min(rows.len());
                        rows.insert(insert_pos, Row::new(cols, default_cell));
                    }
                }
                self.dirty = true;
            }
            b'P' => {
                // DCH - Delete Characters
                let n = (self.parser.get_param(0, 1) as usize).min(cols);
                let cx = self.cursor_x;
                let cy = self.cursor_y;
                let rows = self.active_rows_mut();
                if cy < rows.len() && cx < cols {
                    let row = &mut rows[cy];
                    for x in cx..(cols.saturating_sub(n)) {
                        row.cells[x] = row.cells[x + n];
                    }
                    for x in (cols.saturating_sub(n))..cols {
                        row.cells[x] = default_cell;
                    }
                }
                self.dirty = true;
            }
            b'X' => {
                // ECH - Erase Characters
                let n = self.parser.get_param(0, 1) as usize;
                let cx = self.cursor_x;
                let cy = self.cursor_y;
                let rows = self.active_rows_mut();
                if cy < rows.len() {
                    rows[cy].erase_range(cx, cx + n, default_cell);
                }
                self.dirty = true;
            }
            b'@' => {
                // ICH - Insert Characters
                let n = (self.parser.get_param(0, 1) as usize).min(cols);
                let cx = self.cursor_x;
                let cy = self.cursor_y;
                let rows = self.active_rows_mut();
                if cy < rows.len() && cx < cols {
                    let row = &mut rows[cy];
                    for x in (cx + n..cols).rev() {
                        row.cells[x] = row.cells[x - n];
                    }
                    for x in cx..(cx + n).min(cols) {
                        row.cells[x] = default_cell;
                    }
                }
                self.dirty = true;
            }
            b'S' => {
                // SU - Scroll Up
                let n = self.parser.get_param(0, 1) as usize;
                self.scroll_up_region(n);
            }
            b'T' => {
                // SD - Scroll Down
                let n = self.parser.get_param(0, 1) as usize;
                self.scroll_down_region(n);
            }
            b'r' => {
                // DECSTBM - Set Scrolling Region Top/Bottom (1-based)
                let top = (self.parser.get_param(0, 1) as usize).saturating_sub(1);
                let bottom = if self.parser.param_count > 1 && self.parser.params[1] > 0 {
                    (self.parser.params[1] as usize).saturating_sub(1).min(rows_len.saturating_sub(1))
                } else {
                    rows_len.saturating_sub(1)
                };

                if top < bottom {
                    self.scroll_top = top;
                    self.scroll_bottom = bottom;
                } else {
                    self.scroll_top = 0;
                    self.scroll_bottom = rows_len.saturating_sub(1);
                }
                self.cursor_x = 0;
                self.cursor_y = 0;
                self.dirty = true;
            }
            _ => self.execute_sgr(action),
        }
    }

    pub fn execute_sgr(&mut self, _action: u8) {}
    pub fn execute_dec_private_mode(&mut self, _action: u8) {}
    pub fn execute_osc(&mut self) {}
}

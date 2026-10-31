//! DEC ANSI / VT100 byte parser implementing the Paul Flo Williams state machine.
//! Zero-allocation stream parsing over raw byte buffers.

use alloc::string::String;
use alloc::vec::Vec;
use crate::buffer::ScrollbackBuffer;
use crate::grid::{Cell, Row, FLAG_BOLD, FLAG_ITALIC, FLAG_UNDERLINE, FLAG_INVERSE, FLAG_STRIKETHROUGH, FLAG_BLINK};

pub const ANSI_PALETTE: [u32; 16] = [
    0x000000FF, // 0: Black
    0xCC0000FF, // 1: Red
    0x00CC00FF, // 2: Green
    0xCCCC00FF, // 3: Yellow
    0x0000CCFF, // 4: Blue
    0xCC00CCFF, // 5: Magenta
    0x00CCCCFF, // 6: Cyan
    0xCCCCCCFF, // 7: White
    0x7F7F7FFF, // 8: Bright Black (Gray)
    0xFF0000FF, // 9: Bright Red
    0x00FF00FF, // 10: Bright Green
    0xFFFF00FF, // 11: Bright Yellow
    0x5C5CFFFF, // 12: Bright Blue
    0xFF00FFFF, // 13: Bright Magenta
    0x00FFFFFF, // 14: Bright Cyan
    0xFFFFFFFF, // 15: Bright White
];

pub fn color_256_to_rgba(idx: u8) -> u32 {
    if idx < 16 {
        return ANSI_PALETTE[idx as usize];
    }
    if idx >= 232 {
        // Grayscale ramp from 232 to 255 (24 steps: 8 to 238)
        let gray = 8 + (idx - 232) * 10;
        return Cell::pack_rgba(gray, gray, gray, 255);
    }
    // 6x6x6 color cube (16..231)
    let cube_idx = idx - 16;
    let b_step = cube_idx % 6;
    let g_step = (cube_idx / 6) % 6;
    let r_step = cube_idx / 36;
    let steps: [u8; 6] = [0, 95, 135, 175, 215, 255];
    Cell::pack_rgba(steps[r_step as usize], steps[g_step as usize], steps[b_step as usize], 255)
}

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

    pub fn execute_sgr(&mut self, action: u8) {
        if action != b'm' {
            return;
        }

        if self.parser.param_count == 0 {
            // Empty SGR defaults to reset (0)
            self.current_fg = Cell::DEFAULT_FG;
            self.current_bg = Cell::DEFAULT_BG;
            self.current_flags = 0;
            self.dirty = true;
            return;
        }

        let mut i = 0;
        while i < self.parser.param_count {
            let p = self.parser.params[i];
            match p {
                0 => {
                    self.current_fg = Cell::DEFAULT_FG;
                    self.current_bg = Cell::DEFAULT_BG;
                    self.current_flags = 0;
                }
                1 => self.current_flags |= FLAG_BOLD,
                2 => {} // Dim (handled via shader or flags)
                3 => self.current_flags |= FLAG_ITALIC,
                4 => self.current_flags |= FLAG_UNDERLINE,
                5 => self.current_flags |= FLAG_BLINK,
                7 => self.current_flags |= FLAG_INVERSE,
                9 => self.current_flags |= FLAG_STRIKETHROUGH,
                22 => self.current_flags &= !FLAG_BOLD,
                23 => self.current_flags &= !FLAG_ITALIC,
                24 => self.current_flags &= !FLAG_UNDERLINE,
                25 => self.current_flags &= !FLAG_BLINK,
                27 => self.current_flags &= !FLAG_INVERSE,
                29 => self.current_flags &= !FLAG_STRIKETHROUGH,

                // Standard FG colors
                30..=37 => {
                    let idx = (p - 30) as usize;
                    self.current_fg = ANSI_PALETTE[idx];
                }
                39 => self.current_fg = Cell::DEFAULT_FG,

                // Standard BG colors
                40..=47 => {
                    let idx = (p - 40) as usize;
                    self.current_bg = ANSI_PALETTE[idx];
                }
                49 => self.current_bg = Cell::DEFAULT_BG,

                // Bright FG colors
                90..=97 => {
                    let idx = (p - 90 + 8) as usize;
                    self.current_fg = ANSI_PALETTE[idx];
                }

                // Bright BG colors
                100..=107 => {
                    let idx = (p - 100 + 8) as usize;
                    self.current_bg = ANSI_PALETTE[idx];
                }

                // Extended FG (256-color or TrueColor)
                38 => {
                    if i + 1 < self.parser.param_count {
                        let mode = self.parser.params[i + 1];
                        if mode == 5 && i + 2 < self.parser.param_count {
                            // 256-color lookup
                            let color_idx = (self.parser.params[i + 2] & 0xFF) as u8;
                            self.current_fg = color_256_to_rgba(color_idx);
                            i += 2;
                        } else if mode == 2 && i + 4 < self.parser.param_count {
                            // 24-bit TrueColor RGB
                            let r = (self.parser.params[i + 2] & 0xFF) as u8;
                            let g = (self.parser.params[i + 3] & 0xFF) as u8;
                            let b = (self.parser.params[i + 4] & 0xFF) as u8;
                            self.current_fg = Cell::pack_rgba(r, g, b, 255);
                            i += 4;
                        }
                    }
                }

                // Extended BG (256-color or TrueColor)
                48 => {
                    if i + 1 < self.parser.param_count {
                        let mode = self.parser.params[i + 1];
                        if mode == 5 && i + 2 < self.parser.param_count {
                            // 256-color lookup
                            let color_idx = (self.parser.params[i + 2] & 0xFF) as u8;
                            self.current_bg = color_256_to_rgba(color_idx);
                            i += 2;
                        } else if mode == 2 && i + 4 < self.parser.param_count {
                            // 24-bit TrueColor RGB
                            let r = (self.parser.params[i + 2] & 0xFF) as u8;
                            let g = (self.parser.params[i + 3] & 0xFF) as u8;
                            let b = (self.parser.params[i + 4] & 0xFF) as u8;
                            self.current_bg = Cell::pack_rgba(r, g, b, 255);
                            i += 4;
                        }
                    }
                }
                _ => {}
            }
            i += 1;
        }
        self.dirty = true;
    }

    pub fn execute_dec_private_mode(&mut self, action: u8) {
        let set = match action {
            b'h' => true,
            b'l' => false,
            _ => return,
        };

        for i in 0..self.parser.param_count {
            let mode = self.parser.params[i];
            match mode {
                1 => self.app_cursor_keys = set,
                7 => self.auto_wrap = set,
                25 => self.cursor_visible = set,
                1049 => {
                    if set {
                        if !self.is_alt_screen {
                            self.saved_x = self.cursor_x;
                            self.saved_y = self.cursor_y;
                            let default_cell = Cell::empty();
                            for row in self.alt_screen.iter_mut() {
                                row.clear(default_cell);
                            }
                            self.is_alt_screen = true;
                            self.cursor_x = 0;
                            self.cursor_y = 0;
                        }
                    } else {
                        if self.is_alt_screen {
                            self.is_alt_screen = false;
                            self.cursor_x = self.saved_x.min(self.cols.saturating_sub(1));
                            self.cursor_y = self.saved_y.min(self.rows.saturating_sub(1));
                        }
                    }
                }
                2004 => self.bracketed_paste = set,
                _ => {}
            }
        }
        self.dirty = true;
    }

    pub fn execute_osc(&mut self) {
        if self.parser.osc_buffer.is_empty() {
            return;
        }

        // Find delimiter ';'
        if let Some(pos) = self.parser.osc_buffer.iter().position(|&b| b == b';') {
            let cmd_slice = &self.parser.osc_buffer[..pos];
            let payload_slice = &self.parser.osc_buffer[(pos + 1)..];

            let mut cmd = 0u16;
            for &b in cmd_slice {
                if b >= b'0' && b <= b'9' {
                    cmd = cmd.saturating_mul(10).saturating_add((b - b'0') as u16);
                }
            }

            match cmd {
                0 | 2 => {
                    // Set window title
                    if let Ok(title_str) = core::str::from_utf8(payload_slice) {
                        self.title.clear();
                        self.title.push_str(title_str);
                        self.dirty = true;
                    }
                }
                _ => {}
            }
        }
        self.parser.osc_buffer.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ascii_and_wrapping() {
        let mut term = Terminal::new(10, 5, 100);
        term.write_bytes(b"HELLO");
        assert_eq!(term.cursor_x, 5);
        assert_eq!(term.cursor_y, 0);
        assert_eq!(term.primary_screen[0].cells[0].c, 'H' as u32);
        assert_eq!(term.primary_screen[0].cells[4].c, 'O' as u32);

        // Wrap to next line
        term.write_bytes(b"WORLD!");
        assert_eq!(term.cursor_y, 1);
        assert_eq!(term.cursor_x, 1);
    }

    #[test]
    fn test_c0_controls() {
        let mut term = Terminal::new(80, 24, 100);
        term.write_bytes(b"FOO\rBAR");
        // BAR overwrote FOO at col 0..3
        assert_eq!(term.primary_screen[0].cells[0].c, 'B' as u32);
        assert_eq!(term.primary_screen[0].cells[1].c, 'A' as u32);
        assert_eq!(term.primary_screen[0].cells[2].c, 'R' as u32);

        // Backspace
        term.write_bytes(b"\x08X");
        assert_eq!(term.primary_screen[0].cells[2].c, 'X' as u32);

        // Tab
        term.write_bytes(b"\r\t");
        assert_eq!(term.cursor_x, 8);
    }

    #[test]
    fn test_csi_cursor_movement() {
        let mut term = Terminal::new(80, 24, 100);
        term.write_bytes(b"\x1b[10;20H"); // CUP (row 10, col 20) -> 0-indexed 9, 19
        assert_eq!(term.cursor_y, 9);
        assert_eq!(term.cursor_x, 19);

        term.write_bytes(b"\x1b[3A"); // CUU 3
        assert_eq!(term.cursor_y, 6);

        term.write_bytes(b"\x1b[5B"); // CUD 5
        assert_eq!(term.cursor_y, 11);

        term.write_bytes(b"\x1b[4C"); // CUF 4
        assert_eq!(term.cursor_x, 23);

        term.write_bytes(b"\x1b[8D"); // CUB 8
        assert_eq!(term.cursor_x, 15);
    }

    #[test]
    fn test_csi_erase_line_and_display() {
        let mut term = Terminal::new(80, 24, 100);
        term.write_bytes(b"0123456789\r\x1b[5C\x1b[K"); // Move to col 5, erase to end of line
        assert_eq!(term.primary_screen[0].cells[4].c, '4' as u32);
        assert_eq!(term.primary_screen[0].cells[5].c, ' ' as u32);

        // ED 2 (entire screen)
        term.write_bytes(b"\x1b[2J");
        assert_eq!(term.primary_screen[0].cells[0].c, ' ' as u32);
    }

    #[test]
    fn test_sgr_styling_and_truecolor() {
        let mut term = Terminal::new(80, 24, 100);
        // Bold + Italic + Underline
        term.write_bytes(b"\x1b[1;3;4mTEST\x1b[0m");
        let cell = term.primary_screen[0].cells[0];
        assert_eq!(cell.c, 'T' as u32);
        assert!(cell.has_flag(FLAG_BOLD));
        assert!(cell.has_flag(FLAG_ITALIC));
        assert!(cell.has_flag(FLAG_UNDERLINE));

        // 24-bit TrueColor FG: 255, 128, 64 (0xFF8040FF)
        term.write_bytes(b"\x1b[38;2;255;128;64mZ");
        let z_cell = term.primary_screen[0].cells[4];
        assert_eq!(z_cell.c, 'Z' as u32);
        assert_eq!(z_cell.fg, Cell::pack_rgba(255, 128, 64, 255));
    }

    #[test]
    fn test_dec_private_mode_alternate_screen() {
        let mut term = Terminal::new(80, 24, 100);
        term.write_bytes(b"PRIMARY_CONTENT");
        assert_eq!(term.primary_screen[0].cells[0].c, 'P' as u32);
        assert!(!term.is_alt_screen);

        // Switch to alternate screen (?1049h)
        term.write_bytes(b"\x1b[?1049hALT_CONTENT");
        assert!(term.is_alt_screen);
        assert_eq!(term.alt_screen[0].cells[0].c, 'A' as u32);
        assert_eq!(term.primary_screen[0].cells[0].c, 'P' as u32);

        // Restore primary screen (?1049l)
        term.write_bytes(b"\x1b[?1049l");
        assert!(!term.is_alt_screen);
        assert_eq!(term.primary_screen[0].cells[0].c, 'P' as u32);
    }

    #[test]
    fn test_osc_window_title() {
        let mut term = Terminal::new(80, 24, 100);
        term.write_bytes(b"\x1b]0;AETHER_SYSTEMS_TERMINAL\x07");
        assert_eq!(term.title, "AETHER_SYSTEMS_TERMINAL");
    }

    #[test]
    fn test_malformed_escape_recovery() {
        let mut term = Terminal::new(80, 24, 100);
        // Feed random escape sequence that is invalid, followed by normal text
        term.write_bytes(b"\x1b[??999;;;INVALID_mNORMAL");
        assert_eq!(term.parser.state, ParserState::Ground);
        assert!(term.cursor_x > 0);
    }
}

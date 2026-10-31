//! WebAssembly C ABI zero-copy Foreign Function Interface (FFI).
//! Exports direct memory pointers for high-throughput DMA transfers to WebGPU buffers.

use alloc::boxed::Box;
use alloc::vec::Vec;
use crate::parser::Terminal;

#[no_mangle]
pub extern "C" fn aether_term_new(cols: u32, rows: u32, max_scrollback: u32) -> *mut Terminal {
    let term = Box::new(Terminal::new(cols as usize, rows as usize, max_scrollback as usize));
    Box::into_raw(term)
}

#[no_mangle]
pub extern "C" fn aether_term_free(term: *mut Terminal) {
    if !term.is_null() {
        unsafe {
            drop(Box::from_raw(term));
        }
    }
}

#[no_mangle]
pub extern "C" fn aether_term_resize(term: *mut Terminal, cols: u32, rows: u32) {
    if let Some(term) = unsafe { term.as_mut() } {
        term.resize(cols as usize, rows as usize);
    }
}

#[no_mangle]
pub extern "C" fn aether_term_alloc_buffer(size: u32) -> *mut u8 {
    let mut vec = Vec::<u8>::with_capacity(size as usize);
    let ptr = vec.as_mut_ptr();
    core::mem::forget(vec);
    ptr
}

#[no_mangle]
pub extern "C" fn aether_term_free_buffer(ptr: *mut u8, size: u32) {
    if !ptr.is_null() && size > 0 {
        unsafe {
            drop(Vec::from_raw_parts(ptr, 0, size as usize));
        }
    }
}

#[no_mangle]
pub extern "C" fn aether_term_write(term: *mut Terminal, bytes_ptr: *const u8, len: u32) {
    if let Some(term) = unsafe { term.as_mut() } {
        if !bytes_ptr.is_null() && len > 0 {
            let slice = unsafe { core::slice::from_raw_parts(bytes_ptr, len as usize) };
            term.write_bytes(slice);
        }
    }
}

#[no_mangle]
pub extern "C" fn aether_term_scroll(term: *mut Terminal, delta: i32) {
    if let Some(term) = unsafe { term.as_mut() } {
        let max_scroll = term.scrollback.len();
        if delta < 0 {
            term.scroll_offset = term.scroll_offset.saturating_sub((-delta) as usize);
        } else {
            term.scroll_offset = (term.scroll_offset + delta as usize).min(max_scroll);
        }
        term.dirty = true;
    }
}

#[no_mangle]
pub extern "C" fn aether_term_get_cursor(term: *const Terminal, out_xy: *mut u32) {
    if let Some(term) = unsafe { term.as_ref() } {
        if !out_xy.is_null() {
            unsafe {
                *out_xy = term.cursor_x as u32;
                *out_xy.add(1) = term.cursor_y as u32;
                *out_xy.add(2) = if term.cursor_visible { 1 } else { 0 };
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn aether_term_is_dirty(term: *const Terminal) -> u32 {
    if let Some(term) = unsafe { term.as_ref() } {
        if term.dirty { 1 } else { 0 }
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn aether_term_clear_dirty(term: *mut Terminal) {
    if let Some(term) = unsafe { term.as_mut() } {
        term.dirty = false;
    }
}

#[no_mangle]
pub extern "C" fn aether_term_update_render_instances(
    term: *mut Terminal,
    char_w: f32,
    char_h: f32,
) -> u32 {
    if let Some(term) = unsafe { term.as_mut() } {
        term.update_render_instances(char_w, char_h)
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn aether_term_get_instances_ptr(term: *const Terminal) -> *const crate::parser::GpuCellInstance {
    if let Some(term) = unsafe { term.as_ref() } {
        term.gpu_instances.as_ptr()
    } else {
        core::ptr::null()
    }
}

#[no_mangle]
pub extern "C" fn aether_term_get_instance_count(term: *const Terminal) -> u32 {
    if let Some(term) = unsafe { term.as_ref() } {
        term.gpu_instances.len() as u32
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::GpuCellInstance;
    use core::mem::{align_of, size_of};

    #[test]
    fn test_gpu_instance_layout_48_bytes() {
        assert_eq!(size_of::<GpuCellInstance>(), 48, "GpuCellInstance must be exactly 48 bytes for WebGPU");
        assert_eq!(align_of::<GpuCellInstance>(), 4, "Alignment must be 4 bytes");
    }

    #[test]
    fn test_ffi_lifecycle_and_pointers() {
        let term = aether_term_new(80, 24, 100);
        assert!(!term.is_null());

        let text = b"AETHER WEBGPU\r\n\x1b[32mGREEN\x1b[0m";
        aether_term_write(term, text.as_ptr(), text.len() as u32);

        let mut cursor_data = [0u32; 3];
        aether_term_get_cursor(term, cursor_data.as_mut_ptr());
        assert_eq!(cursor_data[1], 1); // Row 1 after newline
        assert_eq!(cursor_data[2], 1); // Cursor visible

        let count = aether_term_update_render_instances(term, 10.0, 20.0);
        assert_eq!(count, 80 * 24);

        let ptr = aether_term_get_instances_ptr(term);
        assert!(!ptr.is_null());

        let instances = unsafe { core::slice::from_raw_parts(ptr, count as usize) };
        assert_eq!(instances[0].glyph_index, 'A' as u32);
        assert_eq!(instances[0].pos_x, 0.0);
        assert_eq!(instances[0].pos_y, 0.0);
        assert_eq!(instances[0].size_x, 10.0);
        assert_eq!(instances[0].size_y, 20.0);

        aether_term_resize(term, 120, 40);
        let resized_count = aether_term_update_render_instances(term, 10.0, 20.0);
        assert_eq!(resized_count, 120 * 40);

        aether_term_free(term);
    }
}

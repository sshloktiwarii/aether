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

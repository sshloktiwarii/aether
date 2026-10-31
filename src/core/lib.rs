//! Aether Core - High-performance VT100/ANSI terminal state machine.
//! Compiled to wasm32-unknown-unknown for zero-copy linear memory integration with WebGPU.

extern crate alloc;

pub mod buffer;
pub mod grid;

pub const AETHER_VERSION: &str = "0.1.0";

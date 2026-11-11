#![allow(dead_code)]

// Product quantization code vendored from vector_quantizer 0.0.3
// (https://github.com/oramasearch/vector_quantizer, commit cfdec78a061bd13bc60130dd4c2ced3f64338dcf),
// GPL-3.0-only. The published crate depends on numpy/pyo3, rayon and getrandom, which do not build for
// wasm32-unknown-unknown, so the three modules below are vendored with minimal patches (see each file's header).

pub mod errors;
pub mod pq;
pub mod utils;

// WebAssembly bindings for the product quantizer of vector_quantizer (vendored in ./vendor).
// Licensed under the GNU General Public License v3.0 only, like the code it links.
//
// The module exposes a tiny C ABI instead of wasm-bindgen glue so that the JavaScript side can instantiate it in any
// engine (browsers, Node, Deno, Gecko/Zotero) with nothing but `WebAssembly.instantiate`, and so that rebuilding it
// only needs `cargo` and the wasm32-unknown-unknown target.
//
// Memory protocol: JavaScript allocates buffers with `vq_alloc`, writes inputs into linear memory, calls a function,
// reads the outputs and releases the buffers with `vq_free`. Functions return a negative number on failure; the
// error message can then be read from `vq_error_ptr` / `vq_error_len`.

mod vendor;

use ndarray::{Array2, Array3, ArrayView2};
use std::cell::RefCell;
use vendor::pq::PQ;
use vendor::utils::SplitMix64;

thread_local! {
    static MODELS: RefCell<Vec<Option<PQ>>> = RefCell::new(Vec::new());
    static LAST_ERROR: RefCell<String> = RefCell::new(String::new());
}

fn set_error(message: String) -> i32 {
    LAST_ERROR.with(|e| *e.borrow_mut() = message);
    -1
}

fn store(model: PQ) -> i32 {
    MODELS.with(|models| {
        let mut models = models.borrow_mut();
        if let Some(index) = models.iter().position(|m| m.is_none()) {
            models[index] = Some(model);
            index as i32
        } else {
            models.push(Some(model));
            (models.len() - 1) as i32
        }
    })
}

fn with_model<R>(handle: i32, f: impl FnOnce(&PQ) -> R) -> Option<R> {
    MODELS.with(|models| {
        let models = models.borrow();
        models
            .get(handle as usize)
            .and_then(|m| m.as_ref())
            .map(f)
    })
}

/// Allocates `bytes` bytes (8-byte aligned) in linear memory.
#[no_mangle]
pub extern "C" fn vq_alloc(bytes: usize) -> *mut u8 {
    let words = (bytes + 7) / 8;
    let mut buffer: Vec<u64> = Vec::with_capacity(words.max(1));
    let ptr = buffer.as_mut_ptr() as *mut u8;
    std::mem::forget(buffer);
    ptr
}

/// Releases a buffer returned by `vq_alloc` with the same `bytes`.
#[no_mangle]
pub unsafe extern "C" fn vq_free(ptr: *mut u8, bytes: usize) {
    let words = (bytes + 7) / 8;
    drop(Vec::<u64>::from_raw_parts(ptr as *mut u64, 0, words.max(1)));
}

#[no_mangle]
pub extern "C" fn vq_error_ptr() -> *const u8 {
    LAST_ERROR.with(|e| e.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn vq_error_len() -> usize {
    LAST_ERROR.with(|e| e.borrow().len())
}

/// Trains a product quantizer on `n` vectors of `dim` float32 values and returns a model handle (or -1).
#[no_mangle]
pub unsafe extern "C" fn vq_pq_fit(
    data: *const f32,
    n: usize,
    dim: usize,
    m: usize,
    ks: u32,
    iterations: usize,
    seed: u32,
) -> i32 {
    let slice = std::slice::from_raw_parts(data, n * dim);
    let vecs = match ArrayView2::from_shape((n, dim), slice) {
        Ok(view) => view.to_owned(),
        Err(e) => return set_error(e.to_string()),
    };

    let mut pq = match PQ::try_new(m, ks) {
        Ok(pq) => pq,
        Err(e) => return set_error(e.to_string()),
    };

    let mut rng = SplitMix64::new(seed as u64);
    if let Err(e) = pq.fit(&vecs, iterations, &mut rng) {
        return set_error(e.to_string());
    }

    store(pq)
}

/// Rebuilds a model from a codebook of `m * ks * width` float32 values. Returns a handle (or -1).
#[no_mangle]
pub unsafe extern "C" fn vq_pq_from_codewords(
    codewords: *const f32,
    m: usize,
    ks: u32,
    width: usize,
    dim: usize,
) -> i32 {
    let slice = std::slice::from_raw_parts(codewords, m * ks as usize * width);
    let array = match Array3::from_shape_vec((m, ks as usize, width), slice.to_vec()) {
        Ok(array) => array,
        Err(e) => return set_error(e.to_string()),
    };

    match PQ::from_codewords(m, ks, dim, array) {
        Ok(pq) => store(pq),
        Err(e) => set_error(e.to_string()),
    }
}

/// Number of float32 values in the model's codebook (m * ks * width), or -1.
#[no_mangle]
pub extern "C" fn vq_pq_codewords_len(handle: i32) -> i32 {
    with_model(handle, |pq| pq.codewords.as_ref().map_or(0, |c| c.len() as i32))
        .unwrap_or_else(|| set_error(format!("Unknown model handle {}", handle)))
}

/// Width of the widest subspace (the codebook's last axis), or -1.
#[no_mangle]
pub extern "C" fn vq_pq_width(handle: i32) -> i32 {
    with_model(handle, |pq| pq.codewords.as_ref().map_or(0, |c| c.dim().2 as i32))
        .unwrap_or_else(|| set_error(format!("Unknown model handle {}", handle)))
}

/// Copies the codebook into `out` (vq_pq_codewords_len float32 values). Returns 0 or -1.
#[no_mangle]
pub unsafe extern "C" fn vq_pq_codewords(handle: i32, out: *mut f32) -> i32 {
    with_model(handle, |pq| match pq.codewords.as_ref() {
        Some(codewords) => {
            let out = std::slice::from_raw_parts_mut(out, codewords.len());
            for (target, value) in out.iter_mut().zip(codewords.iter()) {
                *target = *value;
            }
            0
        }
        None => set_error("Model not trained".to_string()),
    })
    .unwrap_or_else(|| set_error(format!("Unknown model handle {}", handle)))
}

/// Encodes `n` vectors into `n * m` codes. Codes are written as bytes, so ks must be at most 256. Returns 0 or -1.
#[no_mangle]
pub unsafe extern "C" fn vq_pq_encode(handle: i32, data: *const f32, n: usize, out: *mut u8) -> i32 {
    with_model(handle, |pq| {
        if pq.ks > 256 {
            return set_error("Byte codes require ks <= 256".to_string());
        }
        let dim = match pq.dim {
            Some(dim) => dim,
            None => return set_error("Model not trained".to_string()),
        };
        let slice = std::slice::from_raw_parts(data, n * dim);
        let vecs: Array2<f32> = match ArrayView2::from_shape((n, dim), slice) {
            Ok(view) => view.to_owned(),
            Err(e) => return set_error(e.to_string()),
        };
        match pq.encode(&vecs) {
            Ok(codes) => {
                let out = std::slice::from_raw_parts_mut(out, n * pq.m);
                for (target, value) in out.iter_mut().zip(codes.iter()) {
                    *target = *value as u8;
                }
                0
            }
            Err(e) => set_error(e.to_string()),
        }
    })
    .unwrap_or_else(|| set_error(format!("Unknown model handle {}", handle)))
}

/// Decodes `n * m` byte codes into `n * dim` float32 values. Returns 0 or -1.
#[no_mangle]
pub unsafe extern "C" fn vq_pq_decode(handle: i32, codes: *const u8, n: usize, out: *mut f32) -> i32 {
    with_model(handle, |pq| {
        let dim = match pq.dim {
            Some(dim) => dim,
            None => return set_error("Model not trained".to_string()),
        };
        let slice = std::slice::from_raw_parts(codes, n * pq.m);
        let codes = Array2::from_shape_fn((n, pq.m), |(i, j)| slice[i * pq.m + j] as u32);
        match pq.decode(&codes) {
            Ok(vecs) => {
                let out = std::slice::from_raw_parts_mut(out, n * dim);
                for (target, value) in out.iter_mut().zip(vecs.iter()) {
                    *target = *value;
                }
                0
            }
            Err(e) => set_error(e.to_string()),
        }
    })
    .unwrap_or_else(|| set_error(format!("Unknown model handle {}", handle)))
}

/// Frees a model handle.
#[no_mangle]
pub extern "C" fn vq_pq_drop(handle: i32) {
    MODELS.with(|models| {
        if let Some(slot) = models.borrow_mut().get_mut(handle as usize) {
            *slot = None;
        }
    });
}

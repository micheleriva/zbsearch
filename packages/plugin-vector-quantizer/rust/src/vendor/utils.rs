// Vendored from vector_quantizer 0.0.3 (https://github.com/oramasearch/vector_quantizer),
// commit cfdec78a061bd13bc60130dd4c2ced3f64338dcf, src/utils.rs.
// Copyright (C) Michele Riva <michele@orama.com>. Licensed under the GNU General Public License v3.0 only.
//
// Modifications (zbsearch, 2026), needed to build for wasm32-unknown-unknown without a JavaScript shim:
// - rayon parallel iterators replaced by sequential iterators;
// - rand's thread_rng() replaced by the seeded `SplitMix64` generator below, passed in by the caller, so fits are
//   reproducible and need no OS entropy source;
// - ndarray-stats' QuantileExt::max replaced by an equivalent fold;
// - create_random_vectors and the unit tests dropped (they depend on rand).
// The k-means algorithm itself (initialisation from random points, Lloyd iterations, empty-cluster reseeding,
// 1e-4 convergence threshold) is unchanged.

use crate::vendor::errors::PQError;
use crate::vendor::pq::CodeType;
use ndarray::{Array1, Array2, ArrayView1};
use std::f32;
use std::ops::AddAssign;

/// Small deterministic PRNG (SplitMix64) standing in for rand::thread_rng().
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform integer in 0..upper.
    pub fn gen_range(&mut self, upper: usize) -> usize {
        (self.next_u64() % upper as u64) as usize
    }

    /// Fisher-Yates shuffle, equivalent to SliceRandom::shuffle.
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.gen_range(i + 1);
            items.swap(i, j);
        }
    }
}

pub fn kmeans2(
    data: &Array2<f32>,
    k: u32,
    iter: usize,
    minit: &str,
    rng: &mut SplitMix64,
) -> Result<(Array2<f32>, Array1<usize>), PQError> {
    let (n_samples, n_features) = data.dim();
    let k = k as usize;

    if n_samples == 0 || n_features == 0 {
        return Err(PQError::DataOrFeatureMissing);
    }

    if k == 0 || k > n_samples {
        return Err(PQError::WrongNumberOfClusters { x: n_samples });
    }

    if data.iter().any(|x| !x.is_finite()) {
        return Err(PQError::NonFiniteValue);
    }

    let mut centroids = match minit {
        "points" => {
            let mut indices: Vec<usize> = (0..n_samples).collect();
            rng.shuffle(&mut indices);
            indices.truncate(k);

            let mut initial_centroids = Array2::zeros((k, n_features));
            for (i, &idx) in indices.iter().enumerate() {
                initial_centroids.row_mut(i).assign(&data.row(idx));
            }
            initial_centroids
        }
        _ => return Err(PQError::InvalidInitMethod),
    };

    let mut labels = Array1::<usize>::zeros(n_samples);
    let mut old_centroids;
    let mut has_converged = false;

    for _ in 0..iter {
        if has_converged {
            break;
        }

        old_centroids = centroids.clone();

        let labels_vec: Vec<usize> = data
            .outer_iter()
            .map(|sample| {
                let mut min_dist = f32::INFINITY;
                let mut min_label = 0;

                for (j, centroid) in centroids.outer_iter().enumerate() {
                    let dist = euclidean_distance(&sample, &centroid);
                    if dist < min_dist {
                        min_dist = dist;
                        min_label = j;
                    }
                }
                min_label
            })
            .collect();

        labels = Array1::from(labels_vec);

        let mut counts = vec![0usize; k];
        let mut sums = vec![Array1::<f32>::zeros(n_features); k];

        data.outer_iter()
            .zip(labels.iter())
            .for_each(|(sample, &label)| {
                counts[label] += 1;
                sums[label].add_assign(&sample);
            });

        centroids
            .outer_iter_mut()
            .enumerate()
            .for_each(|(i, mut centroid_row)| {
                if counts[i] > 0 {
                    centroid_row.assign(&(sums[i].clone() / counts[i] as f32));
                } else {
                    let random_idx = rng.gen_range(n_samples);
                    centroid_row.assign(&data.row(random_idx));
                }
            });

        has_converged = check_convergence(&centroids, &old_centroids);
    }

    Ok((centroids, labels))
}

fn check_convergence(new_centroids: &Array2<f32>, old_centroids: &Array2<f32>) -> bool {
    let diff = new_centroids - old_centroids;
    let max_change = diff.iter().fold(0.0f32, |acc, x| acc.max(x.abs()));
    max_change <= 1e-4
}

pub fn euclidean_distance(a: &ArrayView1<f32>, b: &ArrayView1<f32>) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

pub fn determine_code_type(ks: u32) -> CodeType {
    if ks <= (1 << 8) {
        CodeType::U8
    } else if ks <= (1 << 16) {
        CodeType::U16
    } else {
        CodeType::U32
    }
}

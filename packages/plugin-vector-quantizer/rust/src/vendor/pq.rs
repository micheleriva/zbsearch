// Vendored from vector_quantizer 0.0.3 (https://github.com/oramasearch/vector_quantizer),
// commit cfdec78a061bd13bc60130dd4c2ced3f64338dcf, src/pq.rs.
// Copyright (C) Michele Riva <michele@orama.com>. Licensed under the GNU General Public License v3.0 only.
//
// Modifications (zbsearch, 2026), needed to build for wasm32-unknown-unknown:
// - rayon parallel iterators replaced by sequential iterators;
// - `fit` takes the seeded random generator used by k-means (see utils.rs);
// - serde derives and the file based `dump`/`load` (bincode, std::fs) removed: the codebook is serialized by the
//   JavaScript side of the plugin;
// - logging removed;
// - `from_codewords` added to rebuild a trained quantizer from a stored codebook;
// - unit tests adapted to the seeded generator, the dump/load tests dropped.
// The product-quantization algorithm (subspace split, per-subspace k-means, nearest-codeword encoding, decoding)
// is unchanged.

use crate::vendor::errors::PQError;
use crate::vendor::utils::{determine_code_type, euclidean_distance, kmeans2, SplitMix64};
use ndarray::{s, Array2, Array3, Axis};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CodeType {
    U8,
    U16,
    U32,
}

pub struct PQ {
    pub m: usize,
    pub code_dtype: CodeType,
    pub ks: u32,
    pub codewords: Option<Array3<f32>>,
    pub ds: Option<Vec<usize>>,
    pub dim: Option<usize>,
}

fn subspace_offsets(m: usize, n_dims: usize) -> Vec<usize> {
    let reminder = n_dims % m;
    let quotient = n_dims / m;

    let dims_width: Vec<usize> = (0..m)
        .map(|i| if i < reminder { quotient + 1 } else { quotient })
        .collect();

    let mut ds: Vec<usize> = dims_width
        .iter()
        .scan(0, |acc, &x| {
            *acc += x;
            Some(*acc)
        })
        .collect();
    ds.insert(0, 0);
    ds
}

impl PQ {
    pub fn try_new(m: usize, ks: u32) -> Result<Self, PQError> {
        if ks == 0 {
            return Err(PQError::InvalidKs(ks));
        }

        if m == 0 {
            return Err(PQError::InvalidSubspaces(m));
        }

        Ok(Self {
            m,
            ks,
            code_dtype: determine_code_type(ks),
            codewords: None,
            ds: None,
            dim: None,
        })
    }

    /// Rebuilds a trained quantizer from a codebook of shape (m, ks, max subspace width).
    pub fn from_codewords(m: usize, ks: u32, dim: usize, codewords: Array3<f32>) -> Result<Self, PQError> {
        let mut pq = Self::try_new(m, ks)?;
        if m > dim {
            return Err(PQError::SubspacesExceedDimensions { m, n_dims: dim });
        }
        pq.ds = Some(subspace_offsets(m, dim));
        pq.dim = Some(dim);
        pq.codewords = Some(codewords);
        Ok(pq)
    }

    pub fn fit(
        &mut self,
        vecs: &Array2<f32>,
        iterations: usize,
        rng: &mut SplitMix64,
    ) -> Result<&mut Self, PQError> {
        let (n_vectors, n_dims) = vecs.dim();

        if self.ks > n_vectors as u32 {
            return Err(PQError::InsufficientTrainingVectors {
                n_vectors,
                ks: self.ks,
            });
        }

        if n_dims == 0 {
            return Err(PQError::EmptyInputVectors);
        }

        if self.m > n_dims {
            return Err(PQError::SubspacesExceedDimensions { m: self.m, n_dims });
        }

        self.dim = Some(n_dims);

        let ds = subspace_offsets(self.m, n_dims);
        let max_width = (0..self.m).map(|i| ds[i + 1] - ds[i]).max().unwrap();
        self.ds = Some(ds);

        let mut codewords = Array3::<f32>::zeros((self.m, self.ks as usize, max_width));

        let trained_codewords: Vec<(usize, Array2<f32>)> = (0..self.m)
            .map(|m| {
                let ds_ref = self.ds.as_ref().ok_or(PQError::ModelNotTrained)?;
                let vecs_sub = vecs.slice(s![.., ds_ref[m]..ds_ref[m + 1]]);
                let (centroids, _) = kmeans2(&vecs_sub.to_owned(), self.ks, iterations, "points", rng)?;
                Ok((m, centroids))
            })
            .collect::<Result<Vec<(usize, Array2<f32>)>, PQError>>()?;

        for (m, centroids) in trained_codewords {
            let ds_ref = self.ds.as_ref().unwrap();
            let subspace_width = ds_ref[m + 1] - ds_ref[m];
            codewords
                .slice_mut(s![m, .., ..subspace_width])
                .assign(&centroids);
        }

        self.codewords = Some(codewords);

        Ok(self)
    }

    pub fn encode(&self, vecs: &Array2<f32>) -> Result<Array2<u32>, PQError> {
        let dim = self.dim.ok_or(PQError::ModelNotTrained)?;
        if vecs.dim().1 != dim {
            return Err(PQError::TrainingDimensionsDoesntMatchInputDimensions);
        }

        let ds = self.ds.as_ref().ok_or(PQError::ModelNotTrained)?;
        let codewords = self.codewords.as_ref().ok_or(PQError::ModelNotTrained)?;

        let (n_vectors, _) = vecs.dim();
        let mut codes = Array2::<u32>::zeros((n_vectors, self.m));

        codes
            .outer_iter_mut()
            .zip(vecs.outer_iter())
            .for_each(|(mut code_row, vec)| {
                for m in 0..self.m {
                    let subspace = vec.slice(s![ds[m]..ds[m + 1]]);
                    let subspace_width = ds[m + 1] - ds[m];
                    let codewords_sub = codewords.slice(s![m, .., ..subspace_width]);

                    let mut min_dist = f32::INFINITY;
                    let mut min_idx = 0;

                    for (j, codeword) in codewords_sub.axis_iter(Axis(0)).enumerate() {
                        let dist = euclidean_distance(&subspace, &codeword);
                        if dist < min_dist {
                            min_dist = dist;
                            min_idx = j;
                        }
                    }

                    code_row[m] = min_idx as u32;
                }
            });

        match self.code_dtype {
            CodeType::U8 => {
                if codes.iter().any(|&x| x > u8::MAX as u32) {
                    return Err(PQError::EncodedValuesExceedU8Range);
                }
            }
            CodeType::U16 => {
                if codes.iter().any(|&x| x > u16::MAX as u32) {
                    return Err(PQError::EncodedValuesExceedU16Range);
                }
            }
            CodeType::U32 => {}
        };

        Ok(codes)
    }

    pub fn decode(&self, codes: &Array2<u32>) -> Result<Array2<f32>, PQError> {
        let (n_vectors, m) = codes.dim();

        if m != self.m {
            return Err(PQError::TrainingDimensionsDoesntMatchInputDimensions);
        }

        let dim = self.dim.ok_or(PQError::ModelNotTrained)?;
        let ds = self.ds.as_ref().ok_or(PQError::ModelNotTrained)?;
        let codewords = self.codewords.as_ref().ok_or(PQError::ModelNotTrained)?;

        let mut vecs = Array2::<f32>::zeros((n_vectors, dim));

        vecs.outer_iter_mut()
            .zip(codes.outer_iter())
            .try_for_each(|(mut vec_row, code_row)| -> Result<(), PQError> {
                for m in 0..self.m {
                    let code_idx = code_row[m] as usize;
                    if code_idx >= self.ks as usize {
                        return Err(PQError::NClusterExceeded {
                            x: code_idx,
                            y: self.ks,
                        });
                    }
                    let subspace_width = ds[m + 1] - ds[m];
                    let codeword = codewords.slice(s![m, code_idx, ..subspace_width]);

                    vec_row.slice_mut(s![ds[m]..ds[m + 1]]).assign(&codeword);
                }
                Ok(())
            })?;

        Ok(vecs)
    }

    pub fn compress(&self, vecs: &Array2<f32>) -> Result<Array2<f32>, PQError> {
        let codes = self.encode(vecs)?;
        self.decode(&codes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::Array2;

    fn random_vectors(rng: &mut SplitMix64, num_vectors: usize, dimension: usize) -> Array2<f32> {
        Array2::from_shape_fn((num_vectors, dimension), |_| {
            (rng.next_u64() >> 40) as f32 / (1u64 << 24) as f32
        })
    }

    fn create_dummy_vectors(num_vectors: usize, dimension: usize) -> Array2<f32> {
        Array2::<f32>::zeros((num_vectors, dimension))
    }

    #[test]
    fn test_try_new_invalid_ks_zero() {
        assert!(PQ::try_new(4, 0).is_err());
    }

    #[test]
    fn test_try_new_invalid_m_zero() {
        assert!(PQ::try_new(0, 256).is_err());
    }

    #[test]
    fn test_fit_vectors_less_than_ks() {
        let mut rng = SplitMix64::new(1);
        let mut pq = PQ::try_new(4, 256).unwrap();
        let vecs = create_dummy_vectors(100, 128);
        assert!(pq.fit(&vecs, 10, &mut rng).is_err());
    }

    #[test]
    fn test_fit_m_greater_than_dimensions() {
        let mut rng = SplitMix64::new(1);
        let mut pq = PQ::try_new(200, 256).unwrap();
        let vecs = create_dummy_vectors(1000, 128);
        assert!(pq.fit(&vecs, 10, &mut rng).is_err());
    }

    #[test]
    fn test_encode_without_fit() {
        let pq = PQ::try_new(4, 256).unwrap();
        assert!(pq.encode(&create_dummy_vectors(1000, 128)).is_err());
    }

    #[test]
    fn test_encode_mismatched_dimensions() {
        let mut rng = SplitMix64::new(1);
        let mut pq = PQ::try_new(4, 256).unwrap();
        pq.fit(&create_dummy_vectors(1000, 128), 10, &mut rng).unwrap();
        assert!(pq.encode(&create_dummy_vectors(1000, 64)).is_err());
    }

    #[test]
    fn test_compress_reduces_error_and_is_deterministic() {
        let mut rng = SplitMix64::new(7);
        let vecs = random_vectors(&mut rng, 1000, 32);

        let mut a = PQ::try_new(8, 16).unwrap();
        a.fit(&vecs, 10, &mut SplitMix64::new(42)).unwrap();
        let mut b = PQ::try_new(8, 16).unwrap();
        b.fit(&vecs, 10, &mut SplitMix64::new(42)).unwrap();
        assert_eq!(a.codewords, b.codewords);

        let compressed = a.compress(&vecs).unwrap();
        assert_eq!(compressed.dim(), vecs.dim());
        let mse = (&compressed - &vecs).mapv(|x| x * x).mean().unwrap();
        // Uniform [0, 1) data has variance 1/12 per dimension; 16 centroids on 4-d subspaces must do much better.
        assert!(mse < 0.05, "mse {}", mse);
    }

    #[test]
    fn test_from_codewords_matches_fit() {
        let mut rng = SplitMix64::new(3);
        let vecs = random_vectors(&mut rng, 500, 30);
        let mut pq = PQ::try_new(4, 8).unwrap();
        pq.fit(&vecs, 5, &mut rng).unwrap();

        let rebuilt = PQ::from_codewords(4, 8, 30, pq.codewords.clone().unwrap()).unwrap();
        assert_eq!(rebuilt.ds, pq.ds);
        assert_eq!(rebuilt.encode(&vecs).unwrap(), pq.encode(&vecs).unwrap());
    }

    #[test]
    fn test_decode_code_value_exceeds_ks() {
        let mut rng = SplitMix64::new(1);
        let mut pq = PQ::try_new(4, 16).unwrap();
        pq.fit(&random_vectors(&mut rng, 100, 16), 5, &mut rng).unwrap();
        let mut codes = Array2::<u32>::zeros((10, 4));
        codes[[0, 0]] = 300;
        assert!(pq.decode(&codes).is_err());
    }
}

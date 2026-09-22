//! Mel filterbank feature extraction for Qwen3-ASR.
//!
//! Converts raw PCM audio (16 kHz, mono, f32) into 128-bin log-mel
//! filterbank features suitable for the Qwen3-ASR encoder.

#[cfg(feature = "diarization")]
use ndarray::Array3;
#[cfg(feature = "diarization")]
use rustfft::{num_complex::Complex, FftPlanner};
#[cfg(feature = "diarization")]
use std::f32::consts::PI;

#[cfg(feature = "diarization")]
const SAMPLE_RATE: f32 = 16000.0;
#[cfg(feature = "diarization")]
const N_FFT: usize = 400;
#[cfg(feature = "diarization")]
const HOP_LENGTH: usize = 160;

#[cfg(feature = "diarization")]
fn reflect_index(idx: isize, len: usize) -> usize {
    let l = len as isize;
    let mut i = idx;
    while i < 0 || i >= l {
        if i < 0 {
            i = -i;
        }
        if i >= l {
            i = 2 * l - 2 - i;
        }
    }
    i as usize
}

#[cfg(feature = "diarization")]
fn reflect_pad(pcm: &[f32], pad: usize) -> Vec<f32> {
    let n = pcm.len();
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        return vec![pcm[0]; n + 2 * pad];
    }
    let mut padded = Vec::with_capacity(n + 2 * pad);
    for i in (1..=pad).rev() {
        let idx = reflect_index(-(i as isize), n);
        padded.push(pcm[idx]);
    }
    padded.extend_from_slice(pcm);
    for i in 0..pad {
        let idx = reflect_index(n as isize + i as isize, n);
        padded.push(pcm[idx]);
    }
    padded
}

#[cfg(feature = "diarization")]
pub struct MelFilterbank {
    n_mels: usize,
    mel_basis: Vec<Vec<f32>>,  // [n_mels][n_fft/2 + 1]
    window: Vec<f32>,          // Hann window
}

#[cfg(feature = "diarization")]
impl MelFilterbank {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::with_n_mels(128)
    }

    pub fn with_n_mels(n_mels: usize) -> Self {
        let fmin = 0.0;
        let fmax = SAMPLE_RATE / 2.0;
        let mel_basis = Self::compute_mel_basis(n_mels, N_FFT, fmin, fmax, SAMPLE_RATE);
        
        // Periodic Hann window (matching scipy.signal.windows.hann(N_FFT, sym=False) used by librosa)
        let window: Vec<f32> = (0..N_FFT)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * (i as f32) / (N_FFT as f32)).cos()))
            .collect();

        Self { n_mels, mel_basis, window }
    }

    /// Extract mel spectrogram for Qwen3-ASR (Whisper-compatible): [1, n_mels, n_frames]
    /// Uses librosa-compatible STFT (center=True, pad_mode="reflect"),
    /// log10 scale, dynamic range clamping (max - 8.0), and [-1.0, 1.0] normalization.
    #[allow(dead_code)]
    pub fn extract(&self, pcm: &[f32]) -> Array3<f32> {
        if pcm.is_empty() {
            return Array3::zeros((1, self.n_mels, 0));
        }

        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(N_FFT);

        let pad = N_FFT / 2; // 200 samples
        let padded = reflect_pad(pcm, pad);

        let n_frames = if padded.len() < N_FFT {
            0
        } else {
            1 + (padded.len() - N_FFT) / HOP_LENGTH
        };

        if n_frames == 0 {
            return Array3::zeros((1, self.n_mels, 0));
        }

        let mut mel_spec = ndarray::Array2::<f32>::zeros((self.n_mels, n_frames));

        for t in 0..n_frames {
            let start = t * HOP_LENGTH;
            let end = start + N_FFT;

            let mut input: Vec<Complex<f32>> = padded[start..end]
                .iter()
                .zip(self.window.iter())
                .map(|(&s, &w)| Complex::new(s * w, 0.0))
                .collect();

            fft.process(&mut input);

            let n_freqs = N_FFT / 2 + 1;
            let mut power_spec = vec![0.0; n_freqs];
            for i in 0..n_freqs {
                power_spec[i] = input[i].norm_sqr();
            }

            for m in 0..self.n_mels {
                let sum: f32 = self.mel_basis[m].iter()
                    .zip(power_spec.iter())
                    .map(|(w, p)| w * p)
                    .sum();
                mel_spec[[m, t]] = sum;
            }
        }

        // Log scale (Whisper/Qwen-style: log10, clamped to max - 8.0, normalized to [-1, 1])
        let mut log_spec = ndarray::Array2::<f32>::zeros((self.n_mels, n_frames));
        let mut max_val = f32::NEG_INFINITY;

        for m in 0..self.n_mels {
            for t in 0..n_frames {
                let val = mel_spec[[m, t]].max(1e-10).log10();
                log_spec[[m, t]] = val;
                if val > max_val {
                    max_val = val;
                }
            }
        }

        let min_allowed = max_val - 8.0;
        let mut mel_features = Array3::<f32>::zeros((1, self.n_mels, n_frames));
        for m in 0..self.n_mels {
            for t in 0..n_frames {
                let clamped = log_spec[[m, t]].max(min_allowed);
                mel_features[[0, m, t]] = (clamped + 4.0) / 4.0;
            }
        }

        mel_features
    }

    /// Extract fbank features with CMVN across time for CAM++ speaker embedding: [1, n_frames, n_mels]
    pub fn extract_fbank_cmvn(&self, pcm: &[f32]) -> Array3<f32> {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(N_FFT);

        let n_frames = if pcm.len() < N_FFT {
            0
        } else {
            1 + (pcm.len() - N_FFT) / HOP_LENGTH
        };

        if n_frames == 0 {
            return Array3::zeros((1, 0, self.n_mels));
        }

        let mut fbank = Array3::<f32>::zeros((1, n_frames, self.n_mels));

        for t in 0..n_frames {
            let start = t * HOP_LENGTH;
            let end = start + N_FFT;

            let mut input: Vec<Complex<f32>> = pcm[start..end]
                .iter()
                .zip(self.window.iter())
                .map(|(&s, &w)| Complex::new(s * 32768.0 * w, 0.0))
                .collect();

            fft.process(&mut input);

            let n_freqs = N_FFT / 2 + 1;
            let mut power_spec = vec![0.0; n_freqs];
            for i in 0..n_freqs {
                power_spec[i] = input[i].norm_sqr();
            }

            for m in 0..self.n_mels {
                let sum: f32 = self.mel_basis[m].iter()
                    .zip(power_spec.iter())
                    .map(|(w, p)| w * p)
                    .sum();

                let log_mel = sum.max(1e-10).ln();
                fbank[[0, t, m]] = log_mel;
            }
        }

        // CMVN: Cepstral Mean Normalization across time per mel bin
        for m in 0..self.n_mels {
            let mut mean = 0.0;
            for t in 0..n_frames {
                mean += fbank[[0, t, m]];
            }
            mean /= n_frames as f32;
            for t in 0..n_frames {
                fbank[[0, t, m]] -= mean;
            }
        }

        fbank
    }

    fn hz_to_mel(hz: f32) -> f32 {
        let f_min = 0.0;
        let f_sp = 200.0 / 3.0;
        let min_log_hz = 1000.0;
        let min_log_mel = (min_log_hz - f_min) / f_sp;
        let logstep = (6.4f32).ln() / 27.0;

        if hz >= min_log_hz {
            min_log_mel + (hz / min_log_hz).ln() / logstep
        } else {
            (hz - f_min) / f_sp
        }
    }

    fn mel_to_hz(mel: f32) -> f32 {
        let f_min = 0.0;
        let f_sp = 200.0 / 3.0;
        let min_log_hz = 1000.0;
        let min_log_mel = (min_log_hz - f_min) / f_sp;
        let logstep = (6.4f32).ln() / 27.0;

        if mel >= min_log_mel {
            min_log_hz * (logstep * (mel - min_log_mel)).exp()
        } else {
            f_min + f_sp * mel
        }
    }

    fn mel_frequencies(n_mels: usize, fmin: f32, fmax: f32) -> Vec<f32> {
        let min_mel = Self::hz_to_mel(fmin);
        let max_mel = Self::hz_to_mel(fmax);
        let step = (max_mel - min_mel) / ((n_mels + 1) as f32);

        (0..(n_mels + 2))
            .map(|i| Self::mel_to_hz(min_mel + (i as f32) * step))
            .collect()
    }

    fn compute_mel_basis(n_mels: usize, n_fft: usize, fmin: f32, fmax: f32, sr: f32) -> Vec<Vec<f32>> {
        let n_freqs = n_fft / 2 + 1;
        let fft_freqs: Vec<f32> = (0..n_freqs)
            .map(|i| (i as f32) * sr / (n_fft as f32))
            .collect();
        let mel_f = Self::mel_frequencies(n_mels, fmin, fmax);

        let mut fdiff = vec![0.0; n_mels + 1];
        for i in 0..n_mels + 1 {
            fdiff[i] = mel_f[i + 1] - mel_f[i];
        }

        let mut basis = vec![vec![0.0; n_freqs]; n_mels];

        for i in 0..n_mels {
            let enorm = 2.0 / (mel_f[i + 2] - mel_f[i]);
            
            for j in 0..n_freqs {
                let lower = (fft_freqs[j] - mel_f[i]) / fdiff[i];
                let upper = (mel_f[i + 2] - fft_freqs[j]) / fdiff[i + 1];
                let mut weight = lower.min(upper);
                if weight < 0.0 {
                    weight = 0.0;
                }
                basis[i][j] = weight * enorm;
            }
        }

        basis
    }
}

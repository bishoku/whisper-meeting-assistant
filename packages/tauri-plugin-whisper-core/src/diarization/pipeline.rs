#[cfg(feature = "diarization")]
use std::collections::HashMap;
#[cfg(feature = "diarization")]
use std::path::Path;
#[cfg(feature = "diarization")]
use ndarray::Array3;
#[cfg(feature = "diarization")]
use ort::session::Session;
#[cfg(feature = "diarization")]
use crate::error::Result;
#[cfg(feature = "diarization")]
use crate::error::WhisperError;
#[cfg(feature = "diarization")]
use crate::mel::MelFilterbank;

/// A speaker segment from the diarization pipeline.
#[cfg(feature = "diarization")]
#[derive(Debug, Clone)]
pub struct SpeakerSegment {
    pub speaker_id: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: f32,
}

/// A registered speaker profile for global clustering across chunks.
#[cfg(feature = "diarization")]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpeakerProfile {
    pub speaker_id: usize,
    #[serde(default)]
    pub name: Option<String>,
    pub centroid: Vec<f32>,
    pub exemplars: Vec<Vec<f32>>,
    pub sample_count: usize,
    #[serde(default)]
    pub is_verified: bool,
}

/// Offline speaker diarization pipeline using Pyannote segmentation and CAM++ embedding.
#[cfg(feature = "diarization")]
pub struct DiarizationPipeline {
    segmentation_session: Session,
    embedding_session: Session,
    fbank_extractor: MelFilterbank,
    max_speakers: usize,
    similarity_threshold: f32,
    known_speakers: Vec<SpeakerProfile>,
    // Temporal continuity and candidate accumulator state
    last_speaker_id: Option<usize>,
    last_speech_time_ms: i64,
    pending_candidate_pcm: Vec<f32>,
    pending_candidate_time_ms: i64,
}

#[cfg(feature = "diarization")]
impl DiarizationPipeline {
    pub fn new(model_dir: &Path, max_speakers: usize) -> Result<Self> {
        // Default threshold calibrated to 0.65 for natural conversational CAM++ similarity.
        Self::with_threshold(model_dir, max_speakers, 0.65)
    }

    pub fn with_threshold(model_dir: &Path, max_speakers: usize, threshold: f32) -> Result<Self> {
        let seg_path = model_dir.join("segmentation.onnx");
        let emb_path = model_dir.join("embedding.onnx");

        let mut seg_builder = Session::builder()
            .map_err(|e| WhisperError::ModelLoadFailed(e.to_string()))?;
        #[cfg(all(target_os = "macos", any(feature = "coreml", feature = "metal")))]
        {
            let ep = ort::ep::CoreML::default().build();
            seg_builder = seg_builder.clone().with_execution_providers([ep]).unwrap_or(seg_builder);
        }
        let segmentation_session = seg_builder
            .commit_from_file(seg_path)
            .map_err(|e| WhisperError::ModelLoadFailed(e.to_string()))?;

        let mut emb_builder = Session::builder()
            .map_err(|e| WhisperError::ModelLoadFailed(e.to_string()))?;
        #[cfg(all(target_os = "macos", any(feature = "coreml", feature = "metal")))]
        {
            let ep = ort::ep::CoreML::default().build();
            emb_builder = emb_builder.clone().with_execution_providers([ep]).unwrap_or(emb_builder);
        }
        let embedding_session = emb_builder
            .commit_from_file(emb_path)
            .map_err(|e| WhisperError::ModelLoadFailed(e.to_string()))?;

        let fbank_extractor = MelFilterbank::with_n_mels(80);

        Ok(Self {
            segmentation_session,
            embedding_session,
            fbank_extractor,
            max_speakers,
            similarity_threshold: threshold.clamp(0.45, 0.85),
            known_speakers: Vec::new(),
            last_speaker_id: None,
            last_speech_time_ms: -1,
            pending_candidate_pcm: Vec::new(),
            pending_candidate_time_ms: -1,
        })
    }

    /// Update matching similarity threshold (0.45 to 0.85).
    pub fn set_threshold(&mut self, threshold: f32) {
        self.similarity_threshold = threshold.clamp(0.45, 0.85);
    }

    /// Reset known speakers for a new meeting session.
    pub fn reset(&mut self) {
        self.known_speakers.clear();
        self.last_speaker_id = None;
        self.last_speech_time_ms = -1;
        self.pending_candidate_pcm.clear();
        self.pending_candidate_time_ms = -1;
    }

    /// Merge source speaker into target speaker
    pub fn merge_speakers(&mut self, source_id: usize, target_id: usize) {
        if source_id == target_id {
            return;
        }
        let source_prof = self.known_speakers.iter().find(|p| p.speaker_id == source_id).cloned();
        if let Some(sp) = source_prof {
            if let Some(tp) = self.known_speakers.iter_mut().find(|p| p.speaker_id == target_id) {
                // 1. Re-average centroid
                let total_samples = tp.sample_count + sp.sample_count;
                if total_samples > 0 {
                    for i in 0..tp.centroid.len() {
                        tp.centroid[i] = (tp.centroid[i] * tp.sample_count as f32 + sp.centroid[i] * sp.sample_count as f32) / total_samples as f32;
                    }
                    
                    // L2 Normalize the new centroid
                    let norm: f32 = tp.centroid.iter().map(|v| v * v).sum::<f32>().sqrt();
                    if norm > 0.0 {
                        for v in tp.centroid.iter_mut() {
                            *v /= norm;
                        }
                    }
                }

                // 2. Combine and select diverse exemplars
                tp.exemplars.extend(sp.exemplars);
                
                // Sort exemplars by their similarity to the new centroid (closest first)
                let centroid_clone = tp.centroid.clone();
                tp.exemplars.sort_by(|a, b| {
                    let sim_a: f32 = a.iter().zip(centroid_clone.iter()).map(|(x, y)| x * y).sum();
                    let sim_b: f32 = b.iter().zip(centroid_clone.iter()).map(|(x, y)| x * y).sum();
                    sim_b.partial_cmp(&sim_a).unwrap_or(std::cmp::Ordering::Equal) // Descending
                });
                tp.exemplars.truncate(5);

                tp.sample_count = total_samples;
                tp.is_verified = true; // Mark as human-verified
                log::info!("stt: merged speaker_{} into speaker_{}. Deleted speaker_{} completely.", source_id, target_id, source_id);
            }
        }
        self.known_speakers.retain(|p| p.speaker_id != source_id);
    }

    pub fn get_known_speakers(&self) -> Vec<SpeakerProfile> {
        self.known_speakers.clone()
    }

    pub fn set_known_speakers(&mut self, profiles: Vec<SpeakerProfile>) {
        self.known_speakers = profiles;
        self.last_speaker_id = None;
        self.last_speech_time_ms = -1;
        self.pending_candidate_pcm.clear();
        self.pending_candidate_time_ms = -1;
    }

    /// Assign a custom human-readable name to a known speaker profile.
    pub fn rename_speaker(&mut self, speaker_id: usize, name: String) -> bool {
        if let Some(profile) = self.known_speakers.iter_mut().find(|p| p.speaker_id == speaker_id) {
            profile.name = Some(name);
            true
        } else {
            false
        }
    }

    /// Diarize the given 16kHz mono PCM audio chunk.
    pub fn diarize(&mut self, pcm_16khz_mono: &[f32]) -> Result<Vec<SpeakerSegment>> {
        self.diarize_with_offset(pcm_16khz_mono, 0)
    }

    /// Diarize the given 16kHz mono PCM audio chunk with a stream offset in milliseconds.
    pub fn diarize_with_offset(&mut self, pcm_16khz_mono: &[f32], offset_ms: i64) -> Result<Vec<SpeakerSegment>> {
        let total_samples = pcm_16khz_mono.len();
        if total_samples == 0 {
            return Ok(vec![]);
        }

        let total_ms = (total_samples as f64 / 16000.0 * 1000.0) as i64;
        if total_samples < 8000 {
            // Buffer shorter than 0.5s: return single segment
            return Ok(vec![SpeakerSegment {
                speaker_id: 0,
                start_ms: 0,
                end_ms: total_ms,
                confidence: 0.9,
            }]);
        }

        // 1. Pyannote Segmentation Inference: input shape [1, 1, samples]
        let input_arr = Array3::from_shape_vec(
            (1, 1, total_samples),
            pcm_16khz_mono.to_vec(),
        ).map_err(|e| WhisperError::InferenceFailed(format!("Diarization shape error: {e}")))?;

        let input_tensor = ort::value::Tensor::from_array(input_arr)
            .map_err(|e| WhisperError::InferenceFailed(format!("Diarization tensor error: {e}")))?;

        let outputs = self.segmentation_session.run(ort::inputs!["x" => input_tensor])
            .map_err(|e| WhisperError::InferenceFailed(format!("Segmentation run error: {e}")))?;

        let y = outputs["y"].try_extract_array::<f32>()
            .map_err(|e| WhisperError::InferenceFailed(format!("Segmentation output extraction error: {e}")))?;

        let n_frames = y.shape()[1];
        if n_frames == 0 {
            return Ok(vec![SpeakerSegment {
                speaker_id: 0,
                start_ms: 0,
                end_ms: total_ms,
                confidence: 0.9,
            }]);
        }

        // 2. Identify active speaker per frame via sigmoid of logits
        let num_classes = y.shape()[2].min(7);
        let mut frame_speakers: Vec<Option<(usize, f32)>> = Vec::with_capacity(n_frames);
        let mut frame_is_overlap: Vec<bool> = Vec::with_capacity(n_frames);

        for t in 0..n_frames {
            let mut best_k = None;
            let mut best_prob = 0.0f32;
            let mut active_count = 0;
            for k in 0..num_classes {
                let logit = y[[0, t, k]];
                let prob = 1.0 / (1.0 + (-logit).exp());
                if prob > 0.40 {
                    active_count += 1;
                }
                if prob > 0.45 && prob > best_prob {
                    best_prob = prob;
                    best_k = Some((k, prob));
                }
            }
            frame_speakers.push(best_k);
            frame_is_overlap.push(active_count > 1);
        }

        // 3. Group consecutive frames into speech segments with silence bridging
        struct LocalSeg {
            local_speaker: usize,
            start_frame: usize,
            end_frame: usize,
            confidence: f32,
            is_overlap: bool,
        }

        let check_overlap = |start: usize, end: usize| -> bool {
            if start >= end || end > frame_is_overlap.len() {
                return false;
            }
            let count = frame_is_overlap[start..end].iter().filter(|&&v| v).count();
            count * 4 >= (end - start) // >= 25% overlap frames
        };

        let mut local_segs: Vec<LocalSeg> = Vec::new();
        let mut cur_spk: Option<usize> = None;
        let mut cur_start = 0;
        let mut cur_conf = 0.0f32;
        let mut silence_count = 0;
        // Bridge pause up to 250ms (~15 frames)
        let max_bridge = ((0.250 * n_frames as f64) / (total_ms as f64 / 1000.0).max(0.001)).round() as usize;

        for (t, &spk_opt) in frame_speakers.iter().enumerate() {
            match spk_opt {
                Some((spk, prob)) => {
                    if let Some(curr) = cur_spk {
                        if curr == spk {
                            silence_count = 0;
                            cur_conf = cur_conf.max(prob);
                        } else {
                            let end_f = t.saturating_sub(silence_count);
                            local_segs.push(LocalSeg {
                                local_speaker: curr,
                                start_frame: cur_start,
                                end_frame: end_f,
                                confidence: cur_conf,
                                is_overlap: check_overlap(cur_start, end_f),
                            });
                            cur_spk = Some(spk);
                            cur_start = t;
                            cur_conf = prob;
                            silence_count = 0;
                        }
                    } else {
                        cur_spk = Some(spk);
                        cur_start = t;
                        cur_conf = prob;
                        silence_count = 0;
                    }
                }
                None => {
                    if cur_spk.is_some() {
                        silence_count += 1;
                        if silence_count > max_bridge {
                            let curr = cur_spk.unwrap();
                            let end_f = (t + 1).saturating_sub(silence_count);
                            local_segs.push(LocalSeg {
                                local_speaker: curr,
                                start_frame: cur_start,
                                end_frame: end_f,
                                confidence: cur_conf,
                                is_overlap: check_overlap(cur_start, end_f),
                            });
                            cur_spk = None;
                            silence_count = 0;
                        }
                    }
                }
            }
        }

        if let Some(curr) = cur_spk {
            let end_f = n_frames.saturating_sub(silence_count);
            local_segs.push(LocalSeg {
                local_speaker: curr,
                start_frame: cur_start,
                end_frame: end_f,
                confidence: cur_conf,
                is_overlap: check_overlap(cur_start, end_f),
            });
        }

        // 4. Convert frame boundaries to ms and filter out micro-noise (< 150ms)
        let min_seg_ms = 150;
        let mut valid_segs: Vec<(usize, i64, i64, f32, bool)> = Vec::new();

        for seg in local_segs {
            let start_ms = (seg.start_frame as f64 * total_ms as f64 / n_frames as f64) as i64;
            let end_ms = (seg.end_frame as f64 * total_ms as f64 / n_frames as f64) as i64;
            if end_ms - start_ms >= min_seg_ms {
                valid_segs.push((seg.local_speaker, start_ms, end_ms, seg.confidence, seg.is_overlap));
            }
        }

        if valid_segs.is_empty() {
            // Fallback: pick channel with highest cumulative activation
            let mut sum_prob = vec![0.0f32; num_classes];
            for t in 0..n_frames {
                for k in 0..num_classes {
                    let logit = y[[0, t, k]];
                    sum_prob[k] += 1.0 / (1.0 + (-logit).exp());
                }
            }
            let mut best_ch = 0;
            let mut max_sum = -1.0;
            for (k, &s) in sum_prob.iter().enumerate() {
                if s > max_sum {
                    max_sum = s;
                    best_ch = k;
                }
            }
            valid_segs.push((best_ch, 0, total_ms, 0.85, false));
        }

        // 5. Speaker Identification & Clustering using CAM++ embeddings
        let mut speaker_segments: Vec<SpeakerSegment> = Vec::new();
        let mut local_to_global: HashMap<usize, usize> = HashMap::new();

        for (local_spk, start_ms, end_ms, conf, is_overlap) in valid_segs {
            let abs_start_ms = offset_ms + start_ms;
            let abs_end_ms = offset_ms + end_ms;
            let start_sample = (start_ms * 16) as usize;
            let end_sample = ((end_ms * 16) as usize).min(total_samples);
            let duration_samples = end_sample.saturating_sub(start_sample);
            let duration_ms = end_ms - start_ms;

            let global_id = if let Some(&gid) = local_to_global.get(&local_spk) {
                gid
            } else if duration_samples >= 4800 {
                // >= 300ms audio: extract CAM++ speaker embedding
                let seg_pcm = &pcm_16khz_mono[start_sample..end_sample];
                let rms = (seg_pcm.iter().map(|&x| x * x).sum::<f32>() / seg_pcm.len().max(1) as f32).sqrt();

                let fbank = self.fbank_extractor.extract_fbank_cmvn(seg_pcm);
                let n_fbank_frames = fbank.shape()[1];

                let maybe_emb_vec = if n_fbank_frames >= 20 {
                    if let Ok(emb_tensor) = ort::value::Tensor::from_array(fbank) {
                        if let Ok(emb_out) = self.embedding_session.run(ort::inputs!["x" => emb_tensor]) {
                            if let Ok(emb_arr) = emb_out["embedding"].try_extract_array::<f32>() {
                                let mut emb_vec = emb_arr.iter().cloned().collect::<Vec<f32>>();
                                let norm = emb_vec.iter().map(|x| x * x).sum::<f32>().sqrt();
                                if norm > 1e-6 {
                                    for x in &mut emb_vec {
                                        *x /= norm;
                                    }
                                }
                                Some(emb_vec)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                if let Some(emb_vec) = maybe_emb_vec {
                    // Match against known speaker profiles using multi-exemplar + centroid
                    let mut best_sim = -1.0f32;
                    let mut best_raw_sim = -1.0f32;
                    let mut best_idx = None;

                    for (idx, profile) in self.known_speakers.iter().enumerate() {
                        let sim_centroid = cosine_similarity(&emb_vec, &profile.centroid);
                        let mut sim_max_ex = sim_centroid;
                        for ex in &profile.exemplars {
                            let s = cosine_similarity(&emb_vec, ex);
                            if s > sim_max_ex {
                                sim_max_ex = s;
                            }
                        }
                        let raw_sim = 0.60 * sim_max_ex + 0.40 * sim_centroid;

                        // Temporal continuity prior bonus:
                        // If this profile was the last speaker within the last 1500ms, apply recency bonus
                        let mut effective_sim = raw_sim;
                        if Some(profile.speaker_id) == self.last_speaker_id
                            && self.last_speech_time_ms >= 0
                            && abs_start_ms >= self.last_speech_time_ms
                        {
                            let delta_ms = abs_start_ms - self.last_speech_time_ms;
                            if delta_ms <= 1500 {
                                let bonus = 0.07 * (1.0 - (delta_ms as f32 / 1500.0));
                                effective_sim += bonus;
                            }
                        }

                        if effective_sim > best_sim {
                            best_sim = effective_sim;
                            best_raw_sim = raw_sim;
                            best_idx = Some(idx);
                        }
                    }

                    let effective_threshold = best_idx
                        .map(|idx| {
                            if self.known_speakers[idx].is_verified {
                                self.similarity_threshold - 0.05
                            } else {
                                self.similarity_threshold
                            }
                        })
                        .unwrap_or(self.similarity_threshold);

                    let gid = if self.known_speakers.is_empty() {
                        // 1. Initial speaker enrollment
                        let new_id = 0;
                        log::info!("diarization: enrolled initial speaker_0");
                        self.known_speakers.push(SpeakerProfile {
                            speaker_id: new_id,
                            name: None,
                            centroid: emb_vec.clone(),
                            exemplars: vec![emb_vec.clone()],
                            sample_count: 1,
                            is_verified: false,
                        });
                        new_id
                    } else if let (true, Some(idx)) = (best_sim >= effective_threshold, best_idx) {
                        // 2. High-confidence match with existing speaker!
                        let profile = &mut self.known_speakers[idx];

                        // CENTROID DRIFT GUARD:
                        // Only update centroid if:
                        // - duration >= 1.5s (24,000 samples)
                        // - AND best_raw_sim >= 0.72 (clean acoustic match)
                        // - AND !is_overlap (not double-talk)
                        // - AND rms >= 0.005 (not faint background noise)
                        if duration_samples >= 24_000 && best_raw_sim >= 0.72 && !is_overlap && rms >= 0.005 {
                            let weight = (profile.sample_count as f32).min(20.0);
                            for (p_val, &e_val) in profile.centroid.iter_mut().zip(emb_vec.iter()) {
                                *p_val = (*p_val * weight + e_val) / (weight + 1.0);
                            }
                            let new_norm = profile.centroid.iter().map(|x| x * x).sum::<f32>().sqrt();
                            if new_norm > 1e-6 {
                                for x in &mut profile.centroid {
                                    *x /= new_norm;
                                }
                            }
                            profile.sample_count += 1;

                            // Exemplar diversity addition
                            if profile.exemplars.len() < 6 && best_raw_sim < 0.82 && best_raw_sim >= 0.65 {
                                profile.exemplars.push(emb_vec.clone());
                            }
                        }

                        profile.speaker_id
                    } else {
                        // 3. Unmatched audio (best_sim < effective_threshold)
                        if duration_samples >= 24_000 && self.known_speakers.len() < self.max_speakers && !is_overlap && rms >= 0.005 {
                            // Confident new speaker utterance (>= 1.5s)!
                            let new_id = self.known_speakers.iter().map(|p| p.speaker_id).max().map(|m| m + 1).unwrap_or(0);
                            log::info!("diarization: enrolled new speaker_{new_id} from long turn (duration_ms={duration_ms}, best_sim={best_sim:.3})");
                            self.known_speakers.push(SpeakerProfile {
                                speaker_id: new_id,
                                name: None,
                                centroid: emb_vec.clone(),
                                exemplars: vec![emb_vec.clone()],
                                sample_count: 1,
                                is_verified: false,
                            });
                            self.pending_candidate_pcm.clear();
                            self.pending_candidate_time_ms = -1;
                            new_id
                        } else {
                            // Unmatched short segment (< 1.5s).
                            // Check multi-turn candidate accumulator!
                            let mut enrolled_id = None;
                            if self.known_speakers.len() < self.max_speakers && !is_overlap && rms >= 0.004 {
                                let gap = if self.pending_candidate_time_ms >= 0 && abs_start_ms >= self.pending_candidate_time_ms {
                                    abs_start_ms - self.pending_candidate_time_ms
                                } else {
                                    i64::MAX
                                };

                                if gap <= 2500 {
                                    self.pending_candidate_pcm.extend_from_slice(seg_pcm);
                                    self.pending_candidate_time_ms = abs_end_ms;
                                } else {
                                    self.pending_candidate_pcm = seg_pcm.to_vec();
                                    self.pending_candidate_time_ms = abs_end_ms;
                                }

                                // If pooled candidate reaches >= 1.5s (24_000 samples), evaluate pooled embedding!
                                if self.pending_candidate_pcm.len() >= 24_000 {
                                    let pool_fbank = self.fbank_extractor.extract_fbank_cmvn(&self.pending_candidate_pcm);
                                    if pool_fbank.shape()[1] >= 20 {
                                        if let Ok(pool_t) = ort::value::Tensor::from_array(pool_fbank) {
                                            if let Ok(pool_out) = self.embedding_session.run(ort::inputs!["x" => pool_t]) {
                                                if let Ok(pool_arr) = pool_out["embedding"].try_extract_array::<f32>() {
                                                    let mut pool_vec = pool_arr.iter().cloned().collect::<Vec<f32>>();
                                                    let p_norm = pool_vec.iter().map(|x| x * x).sum::<f32>().sqrt();
                                                    if p_norm > 1e-6 {
                                                        for x in &mut pool_vec {
                                                            *x /= p_norm;
                                                        }
                                                    }

                                                    // Check similarity of pooled audio against existing speakers
                                                    let mut pool_best_sim = -1.0f32;
                                                    let mut pool_best_idx = None;
                                                    for (idx, profile) in self.known_speakers.iter().enumerate() {
                                                        let s = cosine_similarity(&pool_vec, &profile.centroid);
                                                        if s > pool_best_sim {
                                                            pool_best_sim = s;
                                                            pool_best_idx = Some(idx);
                                                        }
                                                    }

                                                    if pool_best_sim < effective_threshold {
                                                        let new_id = self.known_speakers.iter().map(|p| p.speaker_id).max().map(|m| m + 1).unwrap_or(0);
                                                        log::info!("diarization: enrolled new speaker_{new_id} from pooled multi-turn audio (samples={}, pool_sim={pool_best_sim:.3})", self.pending_candidate_pcm.len());
                                                        self.known_speakers.push(SpeakerProfile {
                                                            speaker_id: new_id,
                                                            name: None,
                                                            centroid: pool_vec.clone(),
                                                            exemplars: vec![pool_vec],
                                                            sample_count: 1,
                                                            is_verified: false,
                                                        });
                                                        enrolled_id = Some(new_id);
                                                    } else if let Some(idx) = pool_best_idx {
                                                        enrolled_id = Some(self.known_speakers[idx].speaker_id);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    self.pending_candidate_pcm.clear();
                                    self.pending_candidate_time_ms = -1;
                                }
                            }

                            if let Some(nid) = enrolled_id {
                                nid
                            } else if let Some(idx) = best_idx {
                                self.known_speakers[idx].speaker_id
                            } else {
                                0
                            }
                        }
                    };

                    local_to_global.insert(local_spk, gid);
                    self.last_speaker_id = Some(gid);
                    self.last_speech_time_ms = abs_end_ms;
                    gid
                } else {
                    self.known_speakers.first().map(|p| p.speaker_id).unwrap_or(0)
                }
            } else {
                // Utterance < 300ms: assign to last speaker or fallback
                self.last_speaker_id.unwrap_or(0)
            };

            speaker_segments.push(SpeakerSegment {
                speaker_id: global_id,
                start_ms,
                end_ms,
                confidence: conf,
            });
        }

        Ok(speaker_segments)
    }
}

#[cfg(feature = "diarization")]
#[allow(dead_code)]
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

#[cfg(feature = "diarization")]
#[allow(dead_code)]
fn cluster_embeddings(
    embeddings: &[Vec<f32>],
    threshold: f32,
    max_speakers: usize,
) -> Vec<usize> {
    let n = embeddings.len();
    if n == 0 {
        return vec![];
    }
    
    // Each embedding starts in its own cluster
    let mut clusters: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();
    
    loop {
        if clusters.len() <= max_speakers {
            // we could stop here, but we also want to stop if similarity < threshold
            // actually agglomerative stops when max sim < threshold or len <= max_speakers
        }
        
        let mut best_sim = -1.0;
        let mut best_pair = (0, 0);
        
        for i in 0..clusters.len() {
            for j in (i + 1)..clusters.len() {
                // Compute average linkage between cluster i and cluster j
                let mut sim_sum = 0.0;
                let mut count = 0;
                for &idx1 in &clusters[i] {
                    for &idx2 in &clusters[j] {
                        sim_sum += cosine_similarity(&embeddings[idx1], &embeddings[idx2]);
                        count += 1;
                    }
                }
                let avg_sim = sim_sum / (count as f32);
                if avg_sim > best_sim {
                    best_sim = avg_sim;
                    best_pair = (i, j);
                }
            }
        }
        
        if best_sim < threshold || clusters.len() <= 1 {
            break; // No more similar clusters or only 1 left
        }
        
        // Merge best_pair (i, j) where i < j
        let j_cluster = clusters.remove(best_pair.1);
        clusters[best_pair.0].extend(j_cluster);
    }
    
    let mut assignments = vec![0; n];
    for (cluster_id, cluster) in clusters.iter().enumerate() {
        for &idx in cluster {
            assignments[idx] = cluster_id;
        }
    }
    
    assignments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diarization_models_metadata() {
        let home = std::env::var("HOME").unwrap();
        let model_dir = std::path::Path::new(&home)
            .join("Library/Application Support/com.whisper.demo/whisper-models");
        if !model_dir.join("segmentation.onnx").exists() {
            println!("segmentation.onnx not found, skipping");
            return;
        }

        let mut pipeline = DiarizationPipeline::new(&model_dir, 4).expect("failed to load diarization models");
        println!("segmentation inputs: {:?}", pipeline.segmentation_session.inputs());
        println!("segmentation outputs: {:?}", pipeline.segmentation_session.outputs());
        println!("embedding inputs: {:?}", pipeline.embedding_session.inputs());
        println!("embedding outputs: {:?}", pipeline.embedding_session.outputs());

        // Test with 3 seconds of dummy speech / sine wave
        let pcm: Vec<f32> = (0..48_000)
            .map(|i| ((i as f32 * 200.0 * 2.0 * std::f32::consts::PI) / 16000.0).sin() * 0.4)
            .collect();

        let input_arr = ndarray::Array3::from_shape_vec((1, 1, pcm.len()), pcm.clone()).unwrap();
        let input_tensor = ort::value::Tensor::from_array(input_arr).unwrap();

        {
            let outputs = pipeline.segmentation_session.run(ort::inputs!["x" => input_tensor]).unwrap();
            let y = outputs["y"].try_extract_array::<f32>().unwrap();
            println!("segmentation output y shape: {:?}", y.shape());
            println!("sample y values at frame 10: {:?}", &y.slice(ndarray::s![0, 10, ..]));
        }

        // Test embedding session with dummy [1, 100, 80]
        {
            let dummy_fbank = ndarray::Array3::<f32>::zeros((1, 100, 80));
            let emb_tensor = ort::value::Tensor::from_array(dummy_fbank).unwrap();
            let emb_outputs = pipeline.embedding_session.run(ort::inputs!["x" => emb_tensor]).unwrap();
            let emb = emb_outputs["embedding"].try_extract_array::<f32>().unwrap();
            println!("embedding output shape: {:?}", emb.shape());
            println!("sample embedding first 5 values: {:?}", &emb.slice(ndarray::s![0, ..5]));
        }

        // Test complete diarize pipeline
        let segments = pipeline.diarize(&pcm).unwrap();
        println!("diarize segments result: {:?}", segments);
        assert!(!segments.is_empty());
    }

    #[test]
    fn test_diarization_two_speakers() {
        let home = std::env::var("HOME").unwrap();
        let model_dir = std::path::Path::new(&home)
            .join("Library/Application Support/com.whisper.demo/whisper-models");
        if !model_dir.join("segmentation.onnx").exists() {
            return;
        }

        let mut pipeline = DiarizationPipeline::new(&model_dir, 4).unwrap();
        
        // 3 seconds: 0-1.5s is 180Hz harmonic tone, 1.5-3.0s is 450Hz harmonic tone
        let mut pcm = vec![0.0f32; 48_000];
        for i in 0..24_000 {
            let t = i as f32 / 16000.0;
            pcm[i] = (2.0 * std::f32::consts::PI * 180.0 * t).sin() * 0.4
                + (2.0 * std::f32::consts::PI * 360.0 * t).sin() * 0.2;
        }
        for i in 24_000..48_000 {
            let t = (i - 24_000) as f32 / 16000.0;
            pcm[i] = (2.0 * std::f32::consts::PI * 450.0 * t).sin() * 0.4
                + (2.0 * std::f32::consts::PI * 900.0 * t).sin() * 0.2;
        }

        let segments = pipeline.diarize(&pcm).unwrap();
        println!("two speakers diarize result: {:?}", segments);
        assert!(!segments.is_empty());
    }

    #[test]
    fn test_diarization_multi_turn() {
        let home = std::env::var("HOME").unwrap();
        let model_dir = std::path::Path::new(&home)
            .join("Library/Application Support/com.whisper.demo/whisper-models");
        if !model_dir.join("segmentation.onnx").exists() {
            return;
        }

        let mut pipeline = DiarizationPipeline::with_threshold(&model_dir, 4, 0.75).unwrap();

        // Turn 1: Speaker A (Vocal tract formants F0=150, F1=600, F2=1000, F3=2400)
        let pcm_a: Vec<f32> = (0..32_000)
            .map(|i| {
                let t = i as f32 / 16000.0;
                0.3 * (2.0 * std::f32::consts::PI * 150.0 * t).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * 600.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 1000.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 2400.0 * t).sin()
            })
            .collect();
        let segs_a = pipeline.diarize(&pcm_a).unwrap();
        println!("turn 1 (Speaker A) segments: {:?}", segs_a);
        let id_a = segs_a[0].speaker_id;

        // Turn 2: Speaker B (Vocal tract formants F0=240, F1=850, F2=1800, F3=3200)
        let pcm_b: Vec<f32> = (0..32_000)
            .map(|i| {
                let t = i as f32 / 16000.0;
                0.3 * (2.0 * std::f32::consts::PI * 240.0 * t).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * 850.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 1800.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 3200.0 * t).sin()
            })
            .collect();
        let segs_b = pipeline.diarize(&pcm_b).unwrap();
        println!("turn 2 (Speaker B) segments: {:?}", segs_b);
        let id_b = segs_b[0].speaker_id;

        // Turn 3: Speaker A again with pitch shift (F0=165) but same vocal tract (F1=600, F2=1000, F3=2400)
        let pcm_a_var: Vec<f32> = (0..32_000)
            .map(|i| {
                let t = i as f32 / 16000.0;
                0.3 * (2.0 * std::f32::consts::PI * 165.0 * t).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * 600.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 1000.0 * t).sin()
                    + 0.2 * (2.0 * std::f32::consts::PI * 2400.0 * t).sin()
            })
            .collect();
        let segs_a_var = pipeline.diarize(&pcm_a_var).unwrap();
        println!("turn 3 (Speaker A with F0=165) segments: {:?}", segs_a_var);
        let id_a_var = segs_a_var[0].speaker_id;

        println!("Identified: A={}, B={}, A_var={}", id_a, id_b, id_a_var);
        assert_eq!(id_a, id_a_var, "Speaker A with natural variation should match Speaker A!");
        assert_ne!(id_a, id_b, "Speaker A and Speaker B should have different speaker IDs!");
    }

    #[test]
    fn test_speaker_profile_naming_and_serialization() {
        let p = SpeakerProfile {
            speaker_id: 2,
            name: Some("Barış".into()),
            centroid: vec![0.1; 192],
            exemplars: vec![vec![0.1; 192]],
            sample_count: 5,
            is_verified: true,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"name\":\"Barış\""));
        let deserialized: SpeakerProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name.as_deref(), Some("Barış"));
        assert_eq!(deserialized.speaker_id, 2);

        // Backward compatibility: old JSON without "name" field should deserialize with None
        let legacy_json = r#"{"speaker_id":1,"centroid":[0.0],"exemplars":[],"sample_count":1}"#;
        let legacy: SpeakerProfile = serde_json::from_str(legacy_json).unwrap();
        assert_eq!(legacy.name, None);
        assert_eq!(legacy.speaker_id, 1);
    }

    #[test]
    fn test_diarization_temporal_continuity_prior() {
        let home = std::env::var("HOME").unwrap();
        let model_dir = std::path::Path::new(&home)
            .join("Library/Application Support/com.whisper.demo/whisper-models");
        if !model_dir.join("segmentation.onnx").exists() {
            return;
        }

        let mut pipeline = DiarizationPipeline::with_threshold(&model_dir, 4, 0.75).unwrap();

        // Chunk 1 at offset 0ms (0s-2s)
        let pcm_1: Vec<f32> = (0..32_000)
            .map(|i| {
                let t = i as f32 / 16000.0;
                0.3 * (2.0 * std::f32::consts::PI * 160.0 * t).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * 650.0 * t).sin()
            })
            .collect();
        let segs_1 = pipeline.diarize_with_offset(&pcm_1, 0).unwrap();
        let id_1 = segs_1[0].speaker_id;
        assert_eq!(pipeline.last_speaker_id, Some(id_1));

        // Chunk 2 at offset 2400ms (400ms gap <= 1500ms) with slight acoustic variation
        let pcm_2: Vec<f32> = (0..32_000)
            .map(|i| {
                let t = i as f32 / 16000.0;
                0.3 * (2.0 * std::f32::consts::PI * 163.0 * t).sin()
                    + 0.3 * (2.0 * std::f32::consts::PI * 655.0 * t).sin()
            })
            .collect();
        let segs_2 = pipeline.diarize_with_offset(&pcm_2, 2400).unwrap();
        let id_2 = segs_2[0].speaker_id;

        assert_eq!(id_1, id_2, "Short-gap turn from same speaker should maintain speaker id via continuity prior");
    }
}

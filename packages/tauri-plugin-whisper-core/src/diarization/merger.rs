#[cfg(feature = "diarization")]
use crate::asr_backend::TranscriptSegment;
#[cfg(feature = "diarization")]
use crate::state::DiarizedSegmentPayload;
#[cfg(feature = "diarization")]
use super::pipeline::SpeakerSegment;
#[cfg(feature = "diarization")]
use std::cmp;

/// Merge transcript segments with speaker segments using word-level temporal overlap.
#[cfg(feature = "diarization")]
pub fn merge(
    transcript: &[TranscriptSegment],
    speakers: &[SpeakerSegment],
) -> Vec<DiarizedSegmentPayload> {
    let mut results = Vec::new();

    for t_seg in transcript {
        if t_seg.words.is_empty() {
            // Fallback for wordless backends (e.g., if token timestamps disabled or failed)
            let mut best_speaker = "speaker_0".to_string();
            let mut best_overlap = 0;

            for s_seg in speakers {
                let overlap_start = cmp::max(t_seg.start_ms, s_seg.start_ms);
                let overlap_end = cmp::min(t_seg.end_ms, s_seg.end_ms);
                let overlap = cmp::max(0, overlap_end - overlap_start);
                
                if overlap > best_overlap {
                    best_overlap = overlap;
                    best_speaker = format!("speaker_{}", s_seg.speaker_id);
                }
            }

            if best_overlap == 0 && !speakers.is_empty() {
                let mut min_dist = i64::MAX;
                for s_seg in speakers {
                    let dist = if t_seg.end_ms < s_seg.start_ms {
                        s_seg.start_ms - t_seg.end_ms
                    } else if s_seg.end_ms < t_seg.start_ms {
                        t_seg.start_ms - s_seg.end_ms
                    } else {
                        0
                    };
                    if dist < min_dist {
                        min_dist = dist;
                        best_speaker = format!("speaker_{}", s_seg.speaker_id);
                    }
                }
            }

            results.push(DiarizedSegmentPayload {
                speaker_id: best_speaker,
                text: t_seg.text.clone(),
                start_ms: t_seg.start_ms,
                end_ms: t_seg.end_ms,
                channel: crate::state::AudioChannel::System,
            });
            continue;
        }

        // Word-level processing
        let mut current_speaker: Option<String> = None;
        let mut current_text = String::new();
        let mut current_start = 0;
        let mut current_end = 0;

        for word in &t_seg.words {
            let mut best_speaker = "speaker_0".to_string();
            let mut best_overlap = 0;

            for s_seg in speakers {
                let overlap_start = cmp::max(word.start_ms, s_seg.start_ms);
                let overlap_end = cmp::min(word.end_ms, s_seg.end_ms);
                let overlap = cmp::max(0, overlap_end - overlap_start);
                
                if overlap > best_overlap {
                    best_overlap = overlap;
                    best_speaker = format!("speaker_{}", s_seg.speaker_id);
                }
            }

            if best_overlap == 0 && !speakers.is_empty() {
                let mut min_dist = i64::MAX;
                for s_seg in speakers {
                    let dist = if word.end_ms < s_seg.start_ms {
                        s_seg.start_ms - word.end_ms
                    } else if s_seg.end_ms < word.start_ms {
                        word.start_ms - s_seg.end_ms
                    } else {
                        0
                    };
                    if dist < min_dist {
                        min_dist = dist;
                        best_speaker = format!("speaker_{}", s_seg.speaker_id);
                    }
                }
            }

            if let Some(ref spk) = current_speaker {
                if *spk == best_speaker {
                    // Accumulate to current segment
                    current_text.push_str(&word.text);
                    current_end = word.end_ms;
                } else {
                    // Speaker changed, push the previous segment
                    if !current_text.trim().is_empty() {
                        results.push(DiarizedSegmentPayload {
                            speaker_id: spk.clone(),
                            text: current_text.trim().to_string(),
                            start_ms: current_start,
                            end_ms: current_end,
                            channel: crate::state::AudioChannel::System,
                        });
                    }
                    current_speaker = Some(best_speaker);
                    current_text = word.text.clone();
                    current_start = word.start_ms;
                    current_end = word.end_ms;
                }
            } else {
                current_speaker = Some(best_speaker);
                current_text = word.text.clone();
                current_start = word.start_ms;
                current_end = word.end_ms;
            }
        }

        // Push the last accumulated segment
        if let Some(spk) = current_speaker {
            if !current_text.trim().is_empty() {
                results.push(DiarizedSegmentPayload {
                    speaker_id: spk,
                    text: current_text.trim().to_string(),
                    start_ms: current_start,
                    end_ms: current_end,
                    channel: crate::state::AudioChannel::System,
                });
            }
        }
    }

    smooth_diarized_segments(results)
}

/// Post-processes diarized segments to remove acoustic glitches and merge consecutive turns.
/// 1. Glitch smoothing: Absorbs isolated single-word anomalies (< 400ms or 1 word) surrounded
///    by the same speaker within 600ms gaps.
/// 2. Consecutive turn consolidation: Merges adjacent segments that share the same speaker_id
///    and channel if the gap between them is <= 1500ms.
#[cfg(feature = "diarization")]
pub fn smooth_diarized_segments(mut segments: Vec<DiarizedSegmentPayload>) -> Vec<DiarizedSegmentPayload> {
    if segments.len() < 2 {
        return segments;
    }

    // Pass 1: Glitch absorption
    if segments.len() >= 3 {
        for i in 1..(segments.len() - 1) {
            let prev_spk = segments[i - 1].speaker_id.clone();
            let next_spk = segments[i + 1].speaker_id.clone();
            let curr_spk = segments[i].speaker_id.clone();

            if prev_spk == next_spk && curr_spk != prev_spk {
                let duration = segments[i].end_ms - segments[i].start_ms;
                let word_count = segments[i].text.split_whitespace().count();
                let gap_prev = segments[i].start_ms - segments[i - 1].end_ms;
                let gap_next = segments[i + 1].start_ms - segments[i].end_ms;

                if (word_count <= 1 || duration < 400) && gap_prev < 600 && gap_next < 600 {
                    segments[i].speaker_id = prev_spk;
                }
            }
        }
    }

    // Pass 2: Merge consecutive segments with identical speaker & channel
    let mut consolidated: Vec<DiarizedSegmentPayload> = Vec::with_capacity(segments.len());
    for seg in segments {
        if let Some(last) = consolidated.last_mut() {
            let gap = seg.start_ms - last.end_ms;
            if last.speaker_id == seg.speaker_id && last.channel == seg.channel && gap <= 1500 {
                let clean_last = crate::asr_backend::clean_whisper_text(&last.text);
                let clean_seg = crate::asr_backend::clean_whisper_text(&seg.text);
                if !clean_last.is_empty() && !clean_seg.is_empty() {
                    last.text = format!("{clean_last} {clean_seg}");
                } else if !clean_seg.is_empty() {
                    last.text = clean_seg;
                }
                last.end_ms = cmp::max(last.end_ms, seg.end_ms);
                continue;
            }
        }
        consolidated.push(seg);
    }

    consolidated
}

#[cfg(all(test, feature = "diarization"))]
mod tests {
    use super::*;
    use crate::state::AudioChannel;

    #[test]
    fn test_glitch_smoothing_single_word_absorbed() {
        let segments = vec![
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "Merhaba nasılsınız".into(),
                start_ms: 100,
                end_ms: 1200,
                channel: AudioChannel::System,
            },
            DiarizedSegmentPayload {
                speaker_id: "speaker_1".into(),
                text: "evet".into(), // 1 word glitch
                start_ms: 1300,
                end_ms: 1550,
                channel: AudioChannel::System,
            },
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "proje durumunu konuşalım".into(),
                start_ms: 1650,
                end_ms: 2800,
                channel: AudioChannel::System,
            },
        ];

        let smoothed = smooth_diarized_segments(segments);
        assert_eq!(smoothed.len(), 1, "Glitch should be absorbed and consolidated into one turn");
        assert_eq!(smoothed[0].speaker_id, "speaker_0");
        assert_eq!(smoothed[0].text, "Merhaba nasılsınız evet proje durumunu konuşalım");
        assert_eq!(smoothed[0].start_ms, 100);
        assert_eq!(smoothed[0].end_ms, 2800);
    }

    #[test]
    fn test_distinct_turns_retained_when_gap_is_large() {
        let segments = vec![
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "İlk konu tamamlandı.".into(),
                start_ms: 100,
                end_ms: 1000,
                channel: AudioChannel::System,
            },
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "Birkaç saniye sonra ikinci konuya geçtik.".into(),
                start_ms: 4000, // 3000ms gap > 1500ms
                end_ms: 6000,
                channel: AudioChannel::System,
            },
        ];

        let smoothed = smooth_diarized_segments(segments);
        assert_eq!(smoothed.len(), 2, "Long gap should preserve distinct paragraphs");
        assert_eq!(smoothed[0].speaker_id, "speaker_0");
        assert_eq!(smoothed[1].speaker_id, "speaker_0");
    }

    #[test]
    fn test_valid_interjection_not_absorbed_if_multi_word() {
        let segments = vec![
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "Bugün sunumu kim yapacak?".into(),
                start_ms: 100,
                end_ms: 1200,
                channel: AudioChannel::System,
            },
            DiarizedSegmentPayload {
                speaker_id: "speaker_1".into(),
                text: "ben yapabilirim".into(), // 2 words, duration >= 400ms
                start_ms: 1300,
                end_ms: 1800,
                channel: AudioChannel::System,
            },
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "Tamam harika o zaman.".into(),
                start_ms: 1900,
                end_ms: 2800,
                channel: AudioChannel::System,
            },
        ];

        let smoothed = smooth_diarized_segments(segments);
        assert_eq!(smoothed.len(), 3, "Legitimate conversational turn should not be absorbed");
        assert_eq!(smoothed[1].speaker_id, "speaker_1");
    }

    #[test]
    fn test_ellipsis_hallucination_stripped_on_merge() {
        let segments = vec![
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "...şu anda...".into(),
                start_ms: 100,
                end_ms: 1000,
                channel: AudioChannel::System,
            },
            DiarizedSegmentPayload {
                speaker_id: "speaker_0".into(),
                text: "...20 milyonun üzerinde...".into(),
                start_ms: 1100,
                end_ms: 2200,
                channel: AudioChannel::System,
            },
        ];

        let smoothed = smooth_diarized_segments(segments);
        assert_eq!(smoothed.len(), 1);
        assert_eq!(smoothed[0].text, "şu anda 20 milyonun üzerinde");
    }
}

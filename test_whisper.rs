fn main() {
    let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::BeamSearch { beam_size: 5, patience: 1.0 });
    params.set_entropy_thold(2.4);
    params.set_logprob_thold(-1.0);
    params.set_no_speech_thold(0.6);
}

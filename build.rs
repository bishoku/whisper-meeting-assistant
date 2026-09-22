const COMMANDS: &[&str] = &[
    "load_model",
    "start_stream",
    "push_audio_chunk",
    "stop_stream",
    "download_model",
    "download_qwen3_model",
    "download_diarization_models",
    "list_backends",
    "load_diarization_model",
    "set_diarization_threshold",
    "merge_speakers",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}

# Whisper Meeting Assistant (Tauri v2 Demo)

Profesyonel, modern ve gizlilik odaklı (%100 yerel ve çevrimdışı) **Toplantı Asistanı ve Canlı Transkripsiyon** masaüstü uygulaması.

Microsoft Teams, Zoom, Google Meet ve diğer konferans/video araçları için tasarlanmış modern bir arayüze sahiptir.

---

## 🌟 Öne Çıkan Özellikler

- **🎧 Çoklu Ses Kaynakları (ScreenCaptureKit & CPAL):**
  - **Yalnızca Mikrofon:** Kendi konuşmalarınız ve yerel ortam sesi.
  - **Yalnızca Sistem Sesi:** Zoom, Teams, Google Chrome veya YouTube gibi uygulamaların ses çıkışını doğrudan yakalama.
  - **Çift Kanal (Hibrit):** Hem kendi mikrofonunuz hem de toplantıdaki diğer kişilerin sesi eş zamanlı transkribe edilir.
- **🗣️ Konuşmacı Ayrıştırma (Diarization) & Dinamik İsimlendirme:**
  - Konuşmacılar (`speaker_0`, `speaker_1`, `Sen`) otomatik olarak tespit edilir ve renkli avatarlarla listelenir.
  - **Dinamik Yeniden Adlandırma:** Herhangi bir konuşmacıya tıklayıp (örn. `speaker_0` -> "Ahmet") ismini değiştirdiğinizde, tüm geçmiş ve gelecek konuşmalar otomatik olarak yeni ismiyle görüntülenir.
- **⚡ Silero VAD v5 Sessizlik Filtresi:**
  - Sessiz anları, nefes seslerini ve arka plan gürültülerini filtreler; transkripsiyon motorunun CPU/GPU tüketimini düşürür ve hayali metin (halüsinasyon) üretimini önler.
- **🤖 İki Güçlü Transkripsiyon Motoru:**
  - **Whisper (GGML / Apple Metal):** Apple Silicon GPU donanım hızlandırmalı, `tiny`'den `large-v3-turbo`'ya kadar tüm modeller.
  - **Qwen3-ASR (ONNX):** Alibaba'nın 0.6B çok dilli akış modeli.
- **📋 Toplantı Notlarını Dışa Aktarma (Export):**
  - Toplantı tutanağını **Markdown (.md)**, **Düz Metin (.txt)** veya **JSON (.json)** formatında tek tıkla panoya kopyalama veya dosya olarak indirme.
- **🎨 Teams/Zoom İlhamlı Modern Arayüz:**
  - React 18, Vite 6 ve Tailwind CSS 3.4 ile tasarlanmış koyu tema (dark mode), akıcı animasyonlar, arama ve konuşmacı filtreleme çubuğu.

---

## 🚀 Çalıştırma

### 1. Bağımlılıkları Yükleme
```bash
cd examples/tauri-whisper-demo
npm install
```

### 2. Geliştirme Modunda Başlatma
```bash
# Tüm özelliklerle (Metal, Qwen3, Diarization, ScreenCaptureKit, VAD)
cargo tauri dev --features "full,screencapturekit"
```

### 3. macOS İzinleri
- Sistem sesi yakalamak için (Chrome, Teams, Zoom vb.) uygulamanın macOS **Ekran ve Sistem Sesi Kaydı** (Screen & System Audio Recording) iznine sahip olması gerekir.
- Ayarlar penceresindeki **"macOS İzni İste"** butonu ile bu izni kolayca açabilirsiniz.

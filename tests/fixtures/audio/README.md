# Audio Test Fixtures

## sample-1s.wav

- **Source**: synthetic silence (FFmpeg `anullsrc` filter)
- **Format**: 16-bit signed little-endian PCM, 16 kHz, mono, 1 second
- **Size**: ~32 KB
- **License**: CC0 / public domain (synthetic, no creative input, no PII)

### Reproduction

```bash
ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -y tests/fixtures/audio/sample-1s.wav
```

### Consumers

Phase 3 multipart-upload tests:

- `apps/api/src/__tests__/litellm-spike-request-id.test.ts` (Plan 02 spike)
- Plan 03 — `/api/transcribe` route handler tests
- Plan 05 — diarization pass-through tests
- Plan 10 — full e2e transcription smoke

Whisper / Whisper-large-v3 accept any RIFF WAV with PCM payload at
8/16/22.05/24/44.1/48 kHz; 16 kHz mono is the canonical Whisper input
sample rate, so this fixture exercises the hot path with the smallest
possible byte cost (~32 KB).

### Why a fixture (not generated at test time)

Hermetic CI: tests run identically on developer machines and CI runners
without requiring `ffmpeg` to be installed. The fixture is committed
so `pnpm test` works after a fresh `git clone`.

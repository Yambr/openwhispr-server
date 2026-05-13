#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 06 — Task 1 GREEN: generate the WAV fixture used by
// the transcribe flow. Reproducible: re-running yields a byte-identical
// file (deterministic 220 Hz sine, no randomness, fixed amplitude).
//
// Output: tools/load-test/src/fixtures/sample-5s-16k.wav
//   - RIFF/WAVE PCM, 16 kHz, mono, 16-bit, 5.000 seconds
//   - Data chunk = 16000 samples/sec * 5 s * 2 bytes = 160000 bytes
//   - Total file size = 160044 bytes (44-byte canonical header)
//
// Run via: node tools/load-test/scripts/generate-wav-fixture.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "src", "fixtures", "sample-5s-16k.wav");

const SAMPLE_RATE = 16000;
const DURATION_S = 5;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const NUM_SAMPLES = SAMPLE_RATE * DURATION_S;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const DATA_SIZE = NUM_SAMPLES * CHANNELS * BYTES_PER_SAMPLE;
const HEADER_SIZE = 44;
const TOTAL_SIZE = HEADER_SIZE + DATA_SIZE;

const buf = Buffer.alloc(TOTAL_SIZE);
// RIFF header
buf.write("RIFF", 0, "ascii");
buf.writeUInt32LE(TOTAL_SIZE - 8, 4);
buf.write("WAVE", 8, "ascii");
// fmt chunk
buf.write("fmt ", 12, "ascii");
buf.writeUInt32LE(16, 16); // PCM fmt-chunk size
buf.writeUInt16LE(1, 20); // audio format = PCM
buf.writeUInt16LE(CHANNELS, 22);
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28); // byte rate
buf.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); // block align
buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
// data chunk
buf.write("data", 36, "ascii");
buf.writeUInt32LE(DATA_SIZE, 40);

// Fill data with a low-amplitude 220 Hz sine wave so the file is not
// dead silence (Whisper sometimes fast-paths silence). Amplitude 0.2 of
// int16 max keeps things subtle and well below clipping.
const FREQ = 220;
const AMP = Math.floor(0.2 * 32767);
for (let i = 0; i < NUM_SAMPLES; i += 1) {
  const t = i / SAMPLE_RATE;
  const sample = Math.round(AMP * Math.sin(2 * Math.PI * FREQ * t));
  buf.writeInt16LE(sample, HEADER_SIZE + i * BYTES_PER_SAMPLE);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buf);
console.log(`Wrote ${OUT} (${buf.length} bytes, ${DURATION_S}s @ ${SAMPLE_RATE} Hz mono)`);

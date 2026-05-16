// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 31 / Plan 03 — LOCKER-03 fixture: one violation per FORBIDDEN[] class.
// This file is intentionally dirty; the unit test scans it from a tmpdir.
// Lines below MUST contain stable hardcoded shapes the regex set matches.

const URL = "http://localhost:3000"; // hits BOTH localhost-string AND port-literal
const IP = "127.0.0.1"; // loopback-ip
const A = "sk-abcdefghijklmnopqrstuvwxyz0123456789"; // secret-shape-openai-anthropic
const B = "AIzaSyTestKeyAaaaaaaaaaaaaaaaaaaaaaaa"; // secret-shape-google
const C = "AKIAIOSFODNN7EXAMPLE"; // secret-shape-aws
const D = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturepart_value"; // secret-shape-jwt-bearer
const PORT = "myhost:8080"; // port-literal (standalone, no localhost)

export { A, B, C, D, IP, PORT, URL };

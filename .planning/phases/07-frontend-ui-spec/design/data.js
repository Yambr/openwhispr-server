// data.js — realistic sample data for OpenWhispr Server v1 self-host

const PROVIDERS = ["openai", "groq", "openrouter", "openwhispr-local"];
const MODELS_STT = ["whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-en"];
const MODELS_LLM = ["gpt-4o-mini", "claude-haiku-4-5", "claude-sonnet-4-5", "llama-3.3-70b"];
const LANGS = ["en", "en", "en", "en", "ru", "auto"];

const TRANSCRIPTIONS = [
  {
    id: "trc_01HZW3K",
    title: "Q2 planning call — engineering syncs",
    dur: "34:12",
    lang: "en",
    provider: "openai",
    model: "whisper-large-v3",
    words: 4128,
    when: "2026-05-12 09:14",
    size: "14.2 MB",
    status: "done",
  },
  {
    id: "trc_01HZW2P",
    title: "Memo: refactor of audit-log partitioning",
    dur: "08:47",
    lang: "en",
    provider: "openwhispr-local",
    model: "whisper-large-v3-turbo",
    words: 1203,
    when: "2026-05-12 08:02",
    size: "3.6 MB",
    status: "done",
  },
  {
    id: "trc_01HZW1V",
    title: "Standup — May 12, audit-log perf",
    dur: "12:33",
    lang: "en",
    provider: "groq",
    model: "whisper-large-v3",
    words: 1844,
    when: "2026-05-12 07:31",
    size: "5.1 MB",
    status: "done",
  },
  {
    id: "trc_01HZVZQ",
    title: "Customer call — Acme rollout",
    dur: "47:08",
    lang: "en",
    provider: "openai",
    model: "whisper-large-v3",
    words: 6021,
    when: "2026-05-11 18:44",
    size: "19.8 MB",
    status: "done",
  },
  {
    id: "trc_01HZVYX",
    title: "Voicenote — DB index plan",
    dur: "02:11",
    lang: "en",
    provider: "openwhispr-local",
    model: "whisper-large-v3-turbo",
    words: 312,
    when: "2026-05-11 15:09",
    size: "0.9 MB",
    status: "done",
  },
  {
    id: "trc_01HZVY4",
    title: "Letучка — продакт-ревью",
    dur: "21:55",
    lang: "ru",
    provider: "openai",
    model: "whisper-large-v3",
    words: 2901,
    when: "2026-05-11 11:20",
    size: "8.7 MB",
    status: "done",
  },
  {
    id: "trc_01HZVX9",
    title: "1:1 with manager — performance",
    dur: "28:14",
    lang: "en",
    provider: "groq",
    model: "whisper-large-v3",
    words: 3677,
    when: "2026-05-11 09:00",
    size: "11.1 MB",
    status: "done",
  },
  {
    id: "trc_01HZVW1",
    title: "Design crit — settings page",
    dur: "53:42",
    lang: "en",
    provider: "openai",
    model: "whisper-large-v3",
    words: 7440,
    when: "2026-05-10 16:22",
    size: "21.4 MB",
    status: "done",
  },
  {
    id: "trc_01HZVV3",
    title: "Lecture — distributed consensus",
    dur: "01:18:09",
    lang: "en",
    provider: "openrouter",
    model: "whisper-large-v3",
    words: 10241,
    when: "2026-05-10 12:01",
    size: "32.0 MB",
    status: "done",
  },
  {
    id: "trc_01HZVTC",
    title: "Quick voicenote — groceries",
    dur: "00:24",
    lang: "en",
    provider: "openwhispr-local",
    model: "whisper-large-v3-turbo",
    words: 41,
    when: "2026-05-10 08:48",
    size: "0.2 MB",
    status: "done",
  },
  {
    id: "trc_01HZVQ8",
    title: "Brainstorm — partition migration strategy",
    dur: "24:30",
    lang: "en",
    provider: "openai",
    model: "whisper-large-v3",
    words: 3204,
    when: "2026-05-09 14:17",
    size: "9.8 MB",
    status: "done",
  },
  {
    id: "trc_01HZVN0",
    title: "Customer interview — workflow gaps",
    dur: "38:51",
    lang: "en",
    provider: "openai",
    model: "whisper-large-v3",
    words: 5012,
    when: "2026-05-09 11:00",
    size: "15.6 MB",
    status: "done",
  },
  {
    id: "trc_01HZVK2",
    title: "Voicenote — review notes for the PR",
    dur: "04:18",
    lang: "en",
    provider: "openwhispr-local",
    model: "distil-whisper-en",
    words: 612,
    when: "2026-05-08 19:42",
    size: "1.8 MB",
    status: "queued",
  },
];

const FOLDERS = [
  { id: "all", label: "All notes", count: 84 },
  { id: "inbox", label: "Inbox", count: 12 },
  { id: "work", label: "Work", count: 31 },
  { id: "meetings", label: "Meetings", count: 18 },
  { id: "ideas", label: "Ideas", count: 14 },
  { id: "archive", label: "Archive", count: 9 },
];

const NOTES = [
  {
    id: "note_01HZW4",
    title: "Phase 6 → 7 handoff",
    folder: "Work",
    type: "meeting",
    words: 612,
    when: "2026-05-12 09:48",
    preview:
      "Partitioning of audit_log landed. Phase 7 SPEC is locked at composite 0.143. Next: design two UI-SPEC artefacts (admin + end-user), enumerating every screen, every field, every state…",
  },
  {
    id: "note_01HZW3",
    title: "OIDC provider matrix",
    folder: "Work",
    type: "quick_note",
    words: 188,
    when: "2026-05-12 08:21",
    preview:
      "Better Auth supports Google, GitHub, Azure AD, Okta out of the box. For self-host we ship Google + GitHub + Generic OIDC. Configure via env vars only — no admin UI in v1.",
  },
  {
    id: "note_01HZW2",
    title: "Idea: PAK rotation flow",
    folder: "Ideas",
    type: "quick_note",
    words: 92,
    when: "2026-05-11 22:10",
    preview:
      "PAK = personal access key. Rotation should be one-click. Old key valid for 24h grace, new key shown once with copy-to-clipboard…",
  },
  {
    id: "note_01HZW1",
    title: "Customer call — Acme",
    folder: "Meetings",
    type: "meeting",
    words: 1422,
    when: "2026-05-11 19:01",
    preview:
      "Acme runs OpenWhispr Server behind their Cloudflare Tunnel. Bottleneck: bursty audit-log writes when night-batch jobs run. They want a Loki dashboard…",
  },
  {
    id: "note_01HZVZ",
    title: "Reading notes — Designing Data-Intensive Apps Ch.7",
    folder: "Inbox",
    type: "transcription",
    words: 2104,
    when: "2026-05-11 11:25",
    preview:
      "Stoyan Stefanov on transaction isolation levels — read committed vs snapshot isolation. Postgres default is read-committed; serializable opt-in via SET TRANSACTION…",
  },
  {
    id: "note_01HZVY",
    title: "Standup notes",
    folder: "Meetings",
    type: "transcription",
    words: 380,
    when: "2026-05-11 09:14",
    preview:
      "Audit-log partitioning shipped. Loki correlation IDs wired through worker but not yet API tier. Tracked as Phase 6.x. Next-up: UI-SPEC writing.",
  },
  {
    id: "note_01HZVX",
    title: "Why Grafana over Datadog for self-host",
    folder: "Work",
    type: "quick_note",
    words: 245,
    when: "2026-05-10 17:33",
    preview:
      "Datadog's pricing breaks down for self-host operators with bursty workloads. Grafana Loki + Mimir + Tempo cover the same telemetry surface for a fraction of the spend…",
  },
  {
    id: "note_01HZVW",
    title: "Voicenote: refactor plan for /api/usage",
    folder: "Work",
    type: "quick_note",
    words: 168,
    when: "2026-05-10 14:01",
    preview:
      "Current /api/usage joins 4 tables synchronously. Move the heavy bits behind a materialized view refreshed nightly. End-user dashboard hits the view, not the live join.",
  },
];

const CONVERSATIONS = [
  {
    id: "cnv_01HZW8",
    title: "How do I debug a partitioned audit-log query?",
    msgs: 8,
    model: "claude-sonnet-4-5",
    tokens: 12_842,
    when: "2026-05-12 10:02",
  },
  {
    id: "cnv_01HZW6",
    title: "Rewrite this paragraph more concisely",
    msgs: 4,
    model: "gpt-4o-mini",
    tokens: 1_344,
    when: "2026-05-12 09:31",
  },
  {
    id: "cnv_01HZW5",
    title: "Explain Postgres partition-pruning to a junior",
    msgs: 12,
    model: "claude-haiku-4-5",
    tokens: 8_211,
    when: "2026-05-12 08:47",
  },
  {
    id: "cnv_01HZVW",
    title: "Pricing model brainstorm",
    msgs: 22,
    model: "claude-sonnet-4-5",
    tokens: 31_204,
    when: "2026-05-11 16:18",
  },
  {
    id: "cnv_01HZVR",
    title: "Translate meeting notes to Russian",
    msgs: 3,
    model: "gpt-4o-mini",
    tokens: 4_120,
    when: "2026-05-11 12:45",
  },
  {
    id: "cnv_01HZVN",
    title: "Code review of audit-log partition migration",
    msgs: 16,
    model: "claude-sonnet-4-5",
    tokens: 22_618,
    when: "2026-05-10 18:02",
  },
  {
    id: "cnv_01HZVK",
    title: "Draft job description — site-reliability eng",
    msgs: 6,
    model: "gpt-4o-mini",
    tokens: 3_001,
    when: "2026-05-10 14:51",
  },
  {
    id: "cnv_01HZVH",
    title: "Summarize Q2 planning call",
    msgs: 2,
    model: "claude-haiku-4-5",
    tokens: 9_318,
    when: "2026-05-10 10:09",
  },
];

const AUDIT = [
  {
    id: "evt_01HZW9A",
    when: "2026-05-12 10:14:22.318Z",
    actor: "elena@acme.dev",
    action: "auth.signin",
    target: "session: s_8f3a",
    result: "ok",
    ip: "203.0.113.42",
    ua: "Chrome 132 · macOS",
  },
  {
    id: "evt_01HZW98",
    when: "2026-05-12 10:11:08.044Z",
    actor: "system",
    action: "security.rate_limit_exceeded",
    target: "ip:198.51.100.7",
    result: "blocked",
    ip: "198.51.100.7",
    ua: "curl/8.4",
  },
  {
    id: "evt_01HZW96",
    when: "2026-05-12 10:02:51.781Z",
    actor: "elena@acme.dev",
    action: "key.issued",
    target: "pak_3f7e",
    result: "ok",
    ip: "203.0.113.42",
    ua: "Chrome 132 · macOS",
  },
  {
    id: "evt_01HZW93",
    when: "2026-05-12 09:58:19.221Z",
    actor: "system",
    action: "security.ssrf_blocked",
    target: "http://169.254.169.254/",
    result: "blocked",
    ip: "203.0.113.42",
    ua: "—",
  },
  {
    id: "evt_01HZW91",
    when: "2026-05-12 09:50:04.612Z",
    actor: "rune@acme.dev",
    action: "auth.signin",
    target: "session: s_8e02",
    result: "ok",
    ip: "198.51.100.91",
    ua: "Firefox 130 · Linux",
  },
  {
    id: "evt_01HZW8X",
    when: "2026-05-12 09:47:33.901Z",
    actor: "system",
    action: "audit.partition_rolled",
    target: "audit_log_2026_05",
    result: "ok",
    ip: "—",
    ua: "pg-cron",
  },
  {
    id: "evt_01HZW8U",
    when: "2026-05-12 09:31:12.488Z",
    actor: "former@acme.dev",
    action: "account.delete",
    target: "user: u_2b91",
    result: "ok",
    ip: "203.0.113.18",
    ua: "Chrome 132 · macOS",
  },
  {
    id: "evt_01HZW8R",
    when: "2026-05-12 09:14:55.012Z",
    actor: "elena@acme.dev",
    action: "note.created",
    target: "note_01HZW4",
    result: "ok",
    ip: "203.0.113.42",
    ua: "Chrome 132 · macOS",
  },
  {
    id: "evt_01HZW8N",
    when: "2026-05-12 09:02:28.700Z",
    actor: "elena@acme.dev",
    action: "transcription.created",
    target: "trc_01HZW3K",
    result: "ok",
    ip: "203.0.113.42",
    ua: "OpenWhispr Desktop 1.0.4",
  },
  {
    id: "evt_01HZW8K",
    when: "2026-05-12 08:55:01.220Z",
    actor: "system",
    action: "auth.signin_failed",
    target: "elena@acme.dev",
    result: "failed",
    ip: "45.83.221.7",
    ua: "unknown",
  },
  {
    id: "evt_01HZW8H",
    when: "2026-05-12 08:51:44.812Z",
    actor: "system",
    action: "auth.signin_failed",
    target: "elena@acme.dev",
    result: "failed",
    ip: "45.83.221.7",
    ua: "unknown",
  },
  {
    id: "evt_01HZW8E",
    when: "2026-05-12 08:47:01.001Z",
    actor: "rune@acme.dev",
    action: "config.updated",
    target: "stt-config",
    result: "ok",
    ip: "198.51.100.91",
    ua: "Firefox 130 · Linux",
  },
  {
    id: "evt_01HZW8B",
    when: "2026-05-12 08:22:13.553Z",
    actor: "elena@acme.dev",
    action: "auth.signin",
    target: "session: s_8d11",
    result: "ok",
    ip: "203.0.113.42",
    ua: "Chrome 132 · macOS",
  },
  {
    id: "evt_01HZW87",
    when: "2026-05-12 07:31:09.014Z",
    actor: "elena@acme.dev",
    action: "transcription.created",
    target: "trc_01HZW1V",
    result: "ok",
    ip: "203.0.113.42",
    ua: "OpenWhispr Desktop 1.0.4",
  },
  {
    id: "evt_01HZW85",
    when: "2026-05-12 07:02:55.402Z",
    actor: "system",
    action: "security.rate_limit_exceeded",
    target: "ip:45.83.221.7",
    result: "blocked",
    ip: "45.83.221.7",
    ua: "unknown",
  },
];

// Usage: 30 days of daily data
const USAGE_30D = (() => {
  const rng = (s) => () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const r = rng(42);
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(2026, 4, 12);
    date.setDate(date.getDate() - i);
    const isWeekend = [0, 6].includes(date.getDay());
    const base = isWeekend ? 18 : 84;
    const req = Math.round(base + r() * 60 - (isWeekend ? 0 : r() * 20));
    out.push({
      date: date.toISOString().slice(0, 10),
      requests: req,
      transcriptions: Math.round(req * (0.3 + r() * 0.2)),
      llm_calls: Math.round(req * (0.4 + r() * 0.3)),
      tokens_in: Math.round(req * 320 + r() * 8000),
      tokens_out: Math.round(req * 180 + r() * 4000),
      audio_minutes: Math.round(req * (0.6 + r() * 0.4)),
    });
  }
  return out;
})();

const USAGE_TOTALS = (() => {
  const t = USAGE_30D.reduce(
    (a, d) => ({
      requests: a.requests + d.requests,
      transcriptions: a.transcriptions + d.transcriptions,
      llm_calls: a.llm_calls + d.llm_calls,
      tokens_in: a.tokens_in + d.tokens_in,
      tokens_out: a.tokens_out + d.tokens_out,
      audio_minutes: a.audio_minutes + d.audio_minutes,
    }),
    { requests: 0, transcriptions: 0, llm_calls: 0, tokens_in: 0, tokens_out: 0, audio_minutes: 0 },
  );
  return t;
})();

const CONFIG_STT = {
  default_provider: "openai",
  default_model: "whisper-large-v3",
  default_language: "auto",
  fallback_chain: ["openai", "groq", "openwhispr-local"],
  max_audio_minutes: 120,
  rate_limit_rps: 8,
  voice_activity_detection: true,
  word_timestamps: true,
};

const CONFIG_NOTE = {
  default_model: "claude-haiku-4-5",
  default_type: "quick_note",
  auto_summarize: true,
  auto_tag: true,
  retention_days: 365,
  embedding_model: "text-embedding-3-small",
};

const MESSAGES_DETAIL = [
  {
    role: "user",
    when: "2026-05-12 10:02:14Z",
    content:
      "How do I debug a partitioned audit-log query that's suddenly doing a seq scan across all partitions?",
  },
  {
    role: "assistant",
    when: "2026-05-12 10:02:18Z",
    content:
      'A few diagnostic steps:\n\n1. Run `EXPLAIN (ANALYZE, BUFFERS)` on the query and confirm partition pruning is in fact NOT happening (look for "Append" over all partitions vs the one you expected).\n2. Check that the predicate on the partition key is a constant or a stable expression. `now()` is volatile; `current_date` is stable but only at plan time.\n3. Verify `enable_partition_pruning = on` and `constraint_exclusion = partition` in postgresql.conf.\n4. If the predicate goes through a function, ensure it\'s marked IMMUTABLE — STABLE/VOLATILE prevent pruning at plan time.',
  },
  {
    role: "user",
    when: "2026-05-12 10:03:01Z",
    content: "It's `WHERE ts >= now() - interval '7 days'`. Looks volatile?",
  },
  {
    role: "assistant",
    when: "2026-05-12 10:03:05Z",
    content:
      "Right — `now()` is STABLE in Postgres, not VOLATILE, so pruning *should* work at plan time. But the planner needs literal-ish bounds to map them to partition ranges. Two fixes:\n\n• Pass the timestamp as a parameter from the app, computed once: `WHERE ts >= $1`.\n• Or use a generated_subquery wrap: `WHERE ts >= (SELECT now() - interval '7 days')` which the planner often handles better.\n\nThen re-run `EXPLAIN` and you should see only the recent partition in the plan.",
  },
  {
    role: "user",
    when: "2026-05-12 10:04:22Z",
    content: "Confirmed — passing as `$1` fixed it. Down to 12ms from 2.4s.",
  },
  {
    role: "assistant",
    when: "2026-05-12 10:04:25Z",
    content:
      "Nice. If you want to make this more durable: add a check in your test suite that asserts `EXPLAIN` for the hot query touches exactly one partition. We do this in apps/api/tests/audit-log-partition-pruning.test.ts.",
  },
];

const PAYLOAD_SAMPLE = {
  request_id: "req_01HZW96K3T2Q8",
  user_id: "usr_01HZ2P9V",
  email: "elena@acme.dev",
  ip: "203.0.113.42",
  user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/132.0.0.0",
  endpoint: "POST /api/auth/issue-pak",
  pak_id: "pak_3f7e",
  pak_name: "desktop-mac-elena",
  scopes: ["transcribe", "notes:write", "conversations:read"],
  expires_at: "2027-05-12T10:02:51.000Z",
  duration_ms: 47,
};

Object.assign(window, {
  PROVIDERS,
  MODELS_STT,
  MODELS_LLM,
  LANGS,
  TRANSCRIPTIONS,
  FOLDERS,
  NOTES,
  CONVERSATIONS,
  AUDIT,
  USAGE_30D,
  USAGE_TOTALS,
  CONFIG_STT,
  CONFIG_NOTE,
  MESSAGES_DETAIL,
  PAYLOAD_SAMPLE,
});

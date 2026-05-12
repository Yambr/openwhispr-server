// screens-user.jsx — U1 sign-in, U2 sign-up, U3 verify email, U4 usage,
// U5 account, U6 transcriptions list, U7 transcription detail,
// U8 notes list, U9 note detail, U10 notes search,
// U11 conversations list, U12 conversation detail, U13 conversations search.

// ── U1 Sign-in ──────────────────────────────────────────────────────────
function ScreenSignIn({ variant = "success" }) {
  const hasErr = variant === "error";
  return (
    <AuthShell>
      <div className="auth-form">
        <h2>Sign in</h2>
        <div className="lede">Welcome back to your OpenWhispr Server.</div>

        <div className="oidc-row">
          <Btn lg icon="google">
            Continue with Google
          </Btn>
          <Btn lg icon="github">
            Continue with GitHub
          </Btn>
          <Btn lg icon="key" kind="ghost">
            Continue with SSO (OIDC)
          </Btn>
        </div>
        <div className="or-sep">Or with email</div>

        <Field label="Email" error={hasErr ? "Invalid email or password." : null}>
          <input
            className="input lg"
            defaultValue="elena@acme.dev"
            style={hasErr ? { borderColor: "var(--danger)" } : null}
          />
        </Field>
        <Field label="Password">
          <div style={{ position: "relative" }}>
            <input type="password" className="input lg" defaultValue="••••••••••••" />
            <button
              className="iconbtn"
              style={{ position: "absolute", right: 5, top: 5, height: 30, width: 30 }}
            >
              <Icon name="eye" size={14} />
            </button>
          </div>
        </Field>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                border: "1.5px solid var(--border-strong)",
                display: "inline-grid",
                placeItems: "center",
              }}
            />
            Remember this device
          </label>
          <a href="#" style={{ fontSize: 13, color: "var(--accent)" }}>
            Forgot password?
          </a>
        </div>

        <Btn kind="accent" lg style={{ width: "100%", justifyContent: "center" }}>
          Sign in
        </Btn>

        <p style={{ marginTop: 22, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
          No account?{" "}
          <a href="#" style={{ color: "var(--accent)" }}>
            Sign up
          </a>
        </p>
      </div>
    </AuthShell>
  );
}

// ── U2 Sign-up ──────────────────────────────────────────────────────────
function ScreenSignUp() {
  return (
    <AuthShell
      sideTitle="Create your OpenWhispr account."
      sideQuote="One account per self-host operator. The first signup becomes the admin."
    >
      <div className="auth-form">
        <h2>Create account</h2>
        <div className="lede">The first registered user becomes the admin of this server.</div>

        <Field label="Name">
          <input className="input lg" defaultValue="Elena Novak" />
        </Field>
        <Field label="Email">
          <input className="input lg" defaultValue="elena@acme.dev" />
        </Field>
        <Field
          label="Password"
          hint="At least 12 characters, mixing letters, numbers, and symbols."
        >
          <input type="password" className="input lg" defaultValue="••••••••••••" />
          <div
            style={{
              height: 4,
              background: "var(--panel-2)",
              borderRadius: 99,
              marginTop: 8,
              overflow: "hidden",
            }}
          >
            <div style={{ width: "78%", height: "100%", background: "var(--ok)" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 4, fontWeight: 500 }}>
            Strong
          </div>
        </Field>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 12.5,
            color: "var(--text-muted)",
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: "var(--accent)",
              display: "inline-grid",
              placeItems: "center",
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <Icon name="check" size={10} stroke={3} style={{ color: "#fff" }} />
          </span>
          I agree to the{" "}
          <a href="#" style={{ color: "var(--accent)" }}>
            terms
          </a>{" "}
          and{" "}
          <a href="#" style={{ color: "var(--accent)" }}>
            privacy policy
          </a>
          .
        </label>

        <Btn kind="accent" lg style={{ width: "100%", justifyContent: "center" }}>
          Create account
        </Btn>

        <p style={{ marginTop: 22, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
          Already have one?{" "}
          <a href="#" style={{ color: "var(--accent)" }}>
            Sign in
          </a>
        </p>
      </div>
    </AuthShell>
  );
}

// ── U3 Verify email ─────────────────────────────────────────────────────
function ScreenVerify({ variant = "success" }) {
  return (
    <AuthShell
      sideTitle="Verify your email."
      sideQuote="We sent a sign-in link to your inbox. The link is valid for 30 minutes."
    >
      <div className="auth-form" style={{ textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background:
              variant === "error"
                ? "color-mix(in oklab, var(--danger) 12%, transparent)"
                : "var(--accent-soft)",
            color: variant === "error" ? "var(--danger)" : "var(--accent)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 18px",
          }}
        >
          <Icon
            name={variant === "error" ? "alert" : variant === "success" ? "check" : "mail"}
            size={26}
            stroke={2}
          />
        </div>
        <h2 style={{ textAlign: "center" }}>
          {variant === "pending" && "Check your inbox"}
          {variant === "verifying" && "Verifying…"}
          {variant === "success" && "Email verified"}
          {variant === "error" && "Link expired"}
        </h2>
        <div className="lede" style={{ textAlign: "center" }}>
          {variant === "pending" && (
            <>
              We sent a verification link to <b style={{ color: "var(--text)" }}>elena@acme.dev</b>.
              Click it to finish setting up your account.
            </>
          )}
          {variant === "verifying" &&
            "Checking your verification token. This usually takes a moment."}
          {variant === "success" &&
            "Your email is confirmed. Redirecting you to the usage dashboard…"}
          {variant === "error" &&
            "This verification link is no longer valid. Request a new one — we will email it within a few seconds."}
        </div>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          {variant === "pending" && (
            <Btn kind="accent" lg style={{ justifyContent: "center" }}>
              Open mail app
            </Btn>
          )}
          {variant === "verifying" && (
            <div className="sk" style={{ height: 40, borderRadius: 8 }} />
          )}
          {variant === "success" && (
            <Btn kind="accent" lg style={{ justifyContent: "center" }} icon="arrow">
              Continue to dashboard
            </Btn>
          )}
          {variant === "error" && (
            <Btn kind="accent" lg style={{ justifyContent: "center" }}>
              Send a new link
            </Btn>
          )}
          <Btn kind="ghost" lg style={{ justifyContent: "center" }}>
            Use a different email
          </Btn>
        </div>
      </div>
    </AuthShell>
  );
}

// ── U4 Usage dashboard (polish) ─────────────────────────────────────────
function ScreenUsage({ state = "success" }) {
  return (
    <Shell
      page="usage"
      crumbs={["Dashboard", "Usage"]}
      actions={
        <>
          <div className="seg" style={{ marginRight: 4 }}>
            <button>24h</button>
            <button>7d</button>
            <button className="on">30d</button>
            <button>90d</button>
          </div>
          <Btn icon="download" sm>
            Export
          </Btn>
        </>
      }
    >
      <div className="content wide">
        <div className="page-head">
          <div>
            <h1>Usage</h1>
            <div className="lede">
              Your activity on this OpenWhispr Server, last 30 days. Numbers update every 15
              minutes.
            </div>
          </div>
        </div>

        {state === "error" && (
          <ErrorState
            body="The /api/usage endpoint failed. Your activity is safe — only this view couldn't load."
            action={<Btn icon="refresh">Retry</Btn>}
          />
        )}

        {state === "empty" && (
          <EmptyState
            icon="chart"
            title="No activity yet"
            body="Your usage stats will show up here once you start using the OpenWhispr desktop client or API."
            action={
              <Btn kind="accent" icon="download">
                Download desktop client
              </Btn>
            }
          />
        )}

        {(state === "success" || state === "loading") && (
          <>
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 18 }}
            >
              {[
                {
                  k: "Requests",
                  v: USAGE_TOTALS.requests.toLocaleString(),
                  d: "+12.4% vs last 30d",
                  dir: "up",
                },
                {
                  k: "Transcriptions",
                  v: USAGE_TOTALS.transcriptions.toLocaleString(),
                  d: "avg 47s / clip",
                  dir: "up",
                },
                {
                  k: "LLM calls",
                  v: USAGE_TOTALS.llm_calls.toLocaleString(),
                  d: "6 models used",
                  dir: null,
                },
                {
                  k: "Tokens",
                  v: ((USAGE_TOTALS.tokens_in + USAGE_TOTALS.tokens_out) / 1000).toFixed(1) + "k",
                  d:
                    "in: " +
                    (USAGE_TOTALS.tokens_in / 1000).toFixed(1) +
                    "k · out: " +
                    (USAGE_TOTALS.tokens_out / 1000).toFixed(1) +
                    "k",
                  dir: null,
                },
              ].map((s) => (
                <div key={s.k} className="card stat">
                  {state === "loading" ? (
                    <>
                      <Sk w={70} h={10} />
                      <div style={{ marginTop: 12 }}>
                        <Sk w={120} h={24} />
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <Sk w={140} h={9} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="k">{s.k}</div>
                      <div className="v">{s.v}</div>
                      <div className="d">
                        {s.dir === "up" && <span style={{ color: "var(--ok)" }}>↑ </span>}
                        {s.d}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", marginBottom: 18 }}>
              <div className="card">
                <div className="card-h">
                  <h3>Requests / day</h3>
                  <div className="sub">Last 30 days · all endpoints</div>
                  <div style={{ flex: 1 }} />
                  <div className="seg">
                    <button className="on">Requests</button>
                    <button>Transcribe</button>
                    <button>LLM</button>
                  </div>
                </div>
                <div className="card-b">
                  {state === "loading" ? (
                    <Sk w="100%" h={240} />
                  ) : (
                    <UsageChart data={USAGE_30D} field="requests" />
                  )}
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>By provider</h3>
                </div>
                <div className="card-b" style={{ padding: 16 }}>
                  {state === "loading" ? (
                    <>
                      <Sk w="100%" h={10} />
                      <div style={{ marginTop: 12 }}>
                        <Sk w="100%" h={10} />
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <Sk w="100%" h={10} />
                      </div>
                    </>
                  ) : (
                    <div className="v-col">
                      {[
                        { name: "openai", v: 41, count: "562 req", color: "var(--accent)" },
                        { name: "groq", v: 28, count: "383 req", color: "var(--info)" },
                        { name: "openwhispr-local", v: 22, count: "301 req", color: "var(--ok)" },
                        { name: "openrouter", v: 9, count: "128 req", color: "var(--warn)" },
                      ].map((p) => (
                        <div key={p.name}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12.5,
                              marginBottom: 5,
                            }}
                          >
                            <span className="mono">{p.name}</span>
                            <span className="dim mono">
                              {p.count} · {p.v}%
                            </span>
                          </div>
                          <div className="progress">
                            <div
                              className="bar"
                              style={{ width: p.v + "%", background: p.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="card">
                <div className="card-h">
                  <h3>Audio minutes / day</h3>
                  <div className="sub">STT only</div>
                </div>
                <div className="card-b">
                  {state === "loading" ? (
                    <Sk w="100%" h={180} />
                  ) : (
                    <UsageChart data={USAGE_30D} field="audio_minutes" kind="bar" h={180} />
                  )}
                </div>
              </div>
              <div className="card">
                <div className="card-h">
                  <h3>Latest activity</h3>
                  <div style={{ flex: 1 }} />
                  <a className="dim" href="#" style={{ fontSize: 12 }}>
                    See all →
                  </a>
                </div>
                <div className="list">
                  {state === "loading"
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <div className="row" key={i}>
                          <div className="icon">
                            <Sk w={14} h={14} r={3} />
                          </div>
                          <div className="body">
                            <Sk w={180} h={11} />
                            <div style={{ marginTop: 4 }}>
                              <Sk w={120} h={9} />
                            </div>
                          </div>
                        </div>
                      ))
                    : [
                        {
                          ico: "mic",
                          t: "Q2 planning call — engineering syncs",
                          d: "34m transcribed · whisper-large-v3 · 6 min ago",
                        },
                        {
                          ico: "msgs",
                          t: "How do I debug a partitioned audit-log query?",
                          d: "claude-sonnet-4-5 · 12,842 tokens · 14 min ago",
                        },
                        {
                          ico: "notes",
                          t: "Phase 6 → 7 handoff",
                          d: "meeting note · auto-summarized · 18 min ago",
                        },
                        {
                          ico: "key",
                          t: "Issued PAK: desktop-mac-elena",
                          d: "pak_3f7e · 26 min ago",
                        },
                      ].map((r, i) => (
                        <div className="row" key={i}>
                          <div className="icon">
                            <Icon name={r.ico} size={14} />
                          </div>
                          <div className="body">
                            <b>{r.t}</b>
                            <span>{r.d}</span>
                          </div>
                        </div>
                      ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

// SVG sparkline-area / bar chart
function UsageChart({ data, field, kind = "line", h = 240 }) {
  const W = 800,
    H = h,
    P = { l: 36, r: 12, t: 12, b: 26 };
  const max = Math.max(...data.map((d) => d[field])) * 1.15;
  const stepX = (W - P.l - P.r) / (data.length - 1);
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max);
  const x = (i) => P.l + i * stepX;
  const pts = data.map((d, i) => [x(i), y(d[field])]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  const area =
    path +
    " L" +
    pts[pts.length - 1][0] +
    " " +
    (H - P.b) +
    " L" +
    pts[0][0] +
    " " +
    (H - P.b) +
    " Z";
  const ticks = [0, max * 0.5, max].map((v) => Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none">
      <g className="grid">
        {ticks.map((t, i) => (
          <line key={i} x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} />
        ))}
      </g>
      <g className="axis">
        {ticks.map((t, i) => (
          <text key={i} x={P.l - 6} y={y(t) + 3} textAnchor="end">
            {t.toLocaleString()}
          </text>
        ))}
        {data
          .filter((_, i) => i % 5 === 0)
          .map((d, i) => (
            <text key={i} x={x(i * 5)} y={H - P.b + 14} textAnchor="middle">
              {d.date.slice(5)}
            </text>
          ))}
      </g>
      {kind === "line" && (
        <>
          <path d={area} className="area" />
          <path d={path} className="line" />
          {pts
            .filter((_, i) => i === pts.length - 1)
            .map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={3.5} className="dot" />
            ))}
        </>
      )}
      {kind === "bar" &&
        pts.map((p, i) => {
          const bw = Math.max(4, stepX - 3);
          return (
            <rect
              key={i}
              x={p[0] - bw / 2}
              y={p[1]}
              width={bw}
              height={H - P.b - p[1]}
              className="bar"
              rx={2}
            />
          );
        })}
    </svg>
  );
}

// ── U5 Account / profile / delete ───────────────────────────────────────
function ScreenAccount({ withModal }) {
  return (
    <Shell page="account" crumbs={["Account", "Profile"]}>
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Account</h1>
            <div className="lede">Your OpenWhispr Server profile and session settings.</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h">
            <h3>Profile</h3>
          </div>
          <div
            className="card-b"
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 1fr",
              gap: 24,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 24,
                background: "var(--accent)",
                color: "#fff",
                fontSize: 36,
                fontWeight: 600,
                display: "grid",
                placeItems: "center",
              }}
            >
              EN
            </div>
            <div>
              <Field label="Name">
                <input className="input" defaultValue="Elena Novak" />
              </Field>
              <Field label="Email" hint="Used for sign-in and notifications.">
                <input className="input" defaultValue="elena@acme.dev" />
              </Field>
            </div>
            <div>
              <Field label="Role">
                <input className="input" defaultValue="Admin" disabled style={{ opacity: 0.7 }} />
              </Field>
              <Field label="Member since">
                <input
                  className="input mono"
                  defaultValue="2024-09-14"
                  disabled
                  style={{ opacity: 0.7 }}
                />
              </Field>
            </div>
          </div>
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
              background: "var(--panel-2)",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <Btn>Cancel</Btn>
            <Btn kind="primary">Save changes</Btn>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h">
            <h3>Sessions</h3>
            <div className="sub">Currently signed-in devices</div>
          </div>
          <div className="list">
            {[
              {
                ico: "globe",
                who: "This browser · Chrome 132 · macOS",
                ip: "203.0.113.42 · San Francisco",
                when: "Active now",
                here: true,
              },
              {
                ico: "mic",
                who: "OpenWhispr Desktop · 1.0.4",
                ip: "203.0.113.42 · San Francisco",
                when: "Last seen 12m ago",
                here: false,
              },
              {
                ico: "globe",
                who: "Firefox 130 · Linux",
                ip: "198.51.100.91 · Berlin",
                when: "Last seen 6h ago",
              },
            ].map((s, i) => (
              <div className="row" key={i}>
                <div className="icon">
                  <Icon name={s.ico} size={14} />
                </div>
                <div className="body">
                  <b>
                    {s.who}{" "}
                    {s.here && (
                      <Badge kind="ok" dot>
                        this device
                      </Badge>
                    )}
                  </b>
                  <span className="mono">
                    {s.ip} · {s.when}
                  </span>
                </div>
                <Btn sm kind="ghost">
                  Revoke
                </Btn>
              </div>
            ))}
          </div>
        </div>

        <div
          className="card"
          style={{ borderColor: "color-mix(in oklab, var(--danger) 30%, var(--border))" }}
        >
          <div className="card-h">
            <h3 style={{ color: "var(--danger)" }}>Danger zone</h3>
          </div>
          <div className="card-b" style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13.5 }}>Delete account</b>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 4, maxWidth: 60 + "ch" }}>
                Permanently removes your account, sessions, transcriptions, notes, conversations,
                and personal access keys. Audit-log entries are retained per Phase 6 policy. This
                cannot be undone.
              </div>
            </div>
            <Btn kind="danger" icon="trash">
              Delete account…
            </Btn>
          </div>
        </div>
      </div>

      {withModal && (
        <div className="scrim">
          <div className="dialog">
            <h3>Delete your account?</h3>
            <p>
              This permanently removes your profile, 13 transcriptions, 84 notes, 8 conversations,
              and 2 personal access keys.{" "}
              <b style={{ color: "var(--text)" }}>This cannot be undone.</b>
            </p>
            <div style={{ padding: "0 20px 14px" }}>
              <label className="label">
                Type <span className="mono">elena@acme.dev</span> to confirm
              </label>
              <input className="input" placeholder="email" />
            </div>
            <div className="actions">
              <Btn>Cancel</Btn>
              <Btn kind="danger" icon="trash">
                Delete account
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── U6 Transcriptions list ──────────────────────────────────────────────
function ScreenTrxList({ state = "success" }) {
  return (
    <Shell
      page="transcriptions"
      crumbs={["Transcriptions"]}
      actions={
        <>
          <Btn icon="download" sm>
            Export
          </Btn>
        </>
      }
    >
      <div className="content wide">
        <div className="page-head">
          <div>
            <h1>Transcriptions</h1>
            <div className="lede">
              Read-only history of your speech-to-text jobs. New transcriptions sync here
              automatically from the OpenWhispr desktop client.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="filterbar">
            <input
              className="input"
              style={{ width: 280 }}
              placeholder="Search title, ID, language…"
            />
            <select className="input" style={{ width: 140 }}>
              <option>All providers</option>
              <option>openai</option>
              <option>groq</option>
              <option>openwhispr-local</option>
            </select>
            <select className="input" style={{ width: 140 }}>
              <option>All languages</option>
              <option>en</option>
              <option>ru</option>
            </select>
            <div style={{ flex: 1 }} />
            <Badge>{state === "success" ? TRANSCRIPTIONS.length + " results" : "—"}</Badge>
          </div>
          {state === "success" && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: 90 }} className="num">
                    Duration
                  </th>
                  <th style={{ width: 80 }}>Lang</th>
                  <th style={{ width: 170 }}>Provider · model</th>
                  <th style={{ width: 90 }} className="num">
                    Words
                  </th>
                  <th style={{ width: 160 }}>When</th>
                  <th style={{ width: 100 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {TRANSCRIPTIONS.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <Icon name="mic" size={14} style={{ color: "var(--text-muted)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {t.title}
                        </span>
                      </div>
                    </td>
                    <td className="num mono" style={{ fontSize: 12 }}>
                      {t.dur}
                    </td>
                    <td>
                      <Badge>{t.lang}</Badge>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {t.provider}
                      </span>{" "}
                      <span className="dim mono" style={{ fontSize: 11.5 }}>
                        {t.model}
                      </span>
                    </td>
                    <td className="num mono" style={{ fontSize: 12 }}>
                      {t.words.toLocaleString()}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {t.when}
                    </td>
                    <td>
                      {t.status === "done" ? (
                        <Badge kind="ok" dot>
                          done
                        </Badge>
                      ) : (
                        <Badge kind="warn" dot>
                          queued
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {state === "loading" && <SkeletonTable cols={7} rows={8} />}
          {state === "empty" && (
            <EmptyState
              icon="mic"
              title="No transcriptions yet"
              body="Your desktop client will sync transcriptions here automatically. Open OpenWhispr Desktop and record your first one."
              action={
                <Btn kind="accent" icon="download">
                  Download desktop client
                </Btn>
              }
            />
          )}
          {state === "error" && <ErrorState />}
        </div>
      </div>
    </Shell>
  );
}

// ── U7 Transcription detail ─────────────────────────────────────────────
function ScreenTrxDetail() {
  const t = TRANSCRIPTIONS[0];
  return (
    <Shell
      page="transcriptions"
      crumbs={["Transcriptions", t.title]}
      actions={
        <>
          <Btn icon="copy" sm>
            Copy text
          </Btn>
          <Btn icon="download" sm>
            Download
          </Btn>
        </>
      }
    >
      <div
        className="content wide"
        style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18 }}
      >
        <div>
          <div className="page-head">
            <div>
              <h1 style={{ fontSize: 20 }}>{t.title}</h1>
              <div className="lede mono" style={{ fontSize: 12 }}>
                {t.id} · recorded 2026-05-12 09:14
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Transcript</h3>
              <div className="sub mono">
                {t.words.toLocaleString()} words · {t.dur}
              </div>
            </div>
            <div className="card-b" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              <p>
                <span className="mono dim" style={{ marginRight: 8 }}>
                  00:00
                </span>{" "}
                Alright, let's kick off the Q2 planning. I want to walk through the audit-log
                partitioning we shipped last week, then talk about Phase 7 — the UI spec — and
                finally what we're punting to Q3.
              </p>
              <p>
                <span className="mono dim" style={{ marginRight: 8 }}>
                  00:42
                </span>{" "}
                So on partitioning: we landed monthly partitions with declarative range
                partitioning. The big win is that our hot 30-day queries now touch one or two
                partitions instead of scanning the whole 18-month history.
              </p>
              <p>
                <span className="mono dim" style={{ marginRight: 8 }}>
                  02:18
                </span>{" "}
                The gotcha we hit was that the planner doesn't prune when the predicate uses{" "}
                <span className="mono">now()</span> at runtime — we had to pass timestamps as bound
                parameters. EXPLAIN ANALYZE went from 2.4 seconds to 12 milliseconds.
              </p>
              <p>
                <span className="mono dim" style={{ marginRight: 8 }}>
                  04:55
                </span>{" "}
                On Phase 7 — Rune, can you walk through what's in scope?
              </p>
              <p className="dim">
                <span className="mono" style={{ marginRight: 8 }}>
                  —
                </span>
                <i>(8 more pages · scroll for full transcript)</i>
              </p>
            </div>
          </div>
        </div>
        <div className="v-col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <h3>Metadata</h3>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <table className="tbl">
                <tbody>
                  <tr>
                    <td className="dim" style={{ fontSize: 12, width: 110 }}>
                      Provider
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {t.provider}
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Model
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {t.model}
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Language
                    </td>
                    <td>
                      <Badge>{t.lang}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Duration
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {t.dur}
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      File size
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {t.size}
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      VAD
                    </td>
                    <td>
                      <Badge kind="ok" dot>
                        on
                      </Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Word timestamps
                    </td>
                    <td>
                      <Badge kind="ok" dot>
                        on
                      </Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Linked notes</h3>
            </div>
            <div className="list">
              <div className="row">
                <div className="icon">
                  <Icon name="notes" size={13} />
                </div>
                <div className="body">
                  <b>Phase 6 → 7 handoff</b>
                  <span>meeting · 612 w</span>
                </div>
              </div>
              <div className="row">
                <div className="icon">
                  <Icon name="notes" size={13} />
                </div>
                <div className="body">
                  <b>Standup notes</b>
                  <span>transcription · 380 w</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── U8 Notes list with folders ──────────────────────────────────────────
function ScreenNotesList() {
  return (
    <Shell
      page="notes"
      crumbs={["Notes"]}
      actions={
        <>
          <Btn icon="search" sm>
            Search
          </Btn>
        </>
      }
    >
      <div
        className="content wide"
        style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 18 }}
      >
        <aside>
          <div className="card">
            <div className="card-h" style={{ padding: "10px 12px" }}>
              <h3
                style={{
                  fontSize: 11.5,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                Folders
              </h3>
            </div>
            <div className="card-b" style={{ padding: 6 }}>
              {FOLDERS.map((f, i) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 10px",
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: "pointer",
                    background: i === 0 ? "var(--accent-soft)" : "transparent",
                    color: i === 0 ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <Icon name={f.id === "all" ? "list" : "folder"} size={14} />
                  <span style={{ flex: 1 }}>{f.label}</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>
                    {f.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
        <div>
          <div className="page-head">
            <div>
              <h1>All notes</h1>
              <div className="lede">
                Your structured notes, voicenotes, and meeting summaries. Created on the desktop
                client and synced here.
              </div>
            </div>
          </div>
          <div className="card">
            <div className="filterbar">
              <input className="input" style={{ width: 280 }} placeholder="Search notes…" />
              <select className="input" style={{ width: 130 }}>
                <option>All types</option>
                <option>transcription</option>
                <option>quick_note</option>
                <option>meeting</option>
              </select>
              <div style={{ flex: 1 }} />
              <div className="seg">
                <button className="on">
                  <Icon name="list" size={12} />
                </button>
                <button>
                  <Icon name="hash" size={12} />
                </button>
              </div>
            </div>
            <div>
              {NOTES.map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}
                  >
                    <b style={{ fontSize: 14, fontWeight: 600 }}>{n.title}</b>
                    <Badge>{n.type}</Badge>
                    <span className="dim mono" style={{ fontSize: 11.5 }}>
                      {n.folder}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span className="dim mono" style={{ fontSize: 11.5 }}>
                      {n.when}
                    </span>
                  </div>
                  <div
                    className="dim"
                    style={{
                      fontSize: 13,
                      lineHeight: 1.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {n.preview}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── U9 Note detail ──────────────────────────────────────────────────────
function ScreenNoteDetail() {
  const n = NOTES[0];
  return (
    <Shell
      page="notes"
      crumbs={["Notes", n.folder, n.title]}
      actions={
        <>
          <Btn icon="copy" sm>
            Copy
          </Btn>
          <Btn icon="external" sm>
            Open in desktop
          </Btn>
        </>
      }
    >
      <div
        className="content wide"
        style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 18 }}
      >
        <div>
          <div className="page-head">
            <div>
              <h1 style={{ fontSize: 22 }}>{n.title}</h1>
              <div className="lede mono" style={{ fontSize: 12 }}>
                {n.id} · {n.when} · {n.words} words
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-b" style={{ fontSize: 13.5, lineHeight: 1.7, padding: 20 }}>
              <p>
                Partitioning of{" "}
                <code
                  className="mono"
                  style={{ background: "var(--panel-2)", padding: "1px 5px", borderRadius: 4 }}
                >
                  audit_log
                </code>{" "}
                landed cleanly in Phase 6 — monthly range partitioning, declarative, with pg_cron
                rolling new partitions on the 1st of each month. The big win is that our hot 30-day
                queries now touch one partition instead of scanning 18 months of history.
              </p>
              <p>
                Phase 7 SPEC is locked at composite <span className="mono">0.143</span> ambiguity.
                The deliverable is two markdown UI-SPEC artefacts — one for the admin console, one
                for the end-user console — each enumerating every screen, every datum, every state,
                and every copy key.
              </p>
              <h4 style={{ marginTop: 18, fontSize: 14 }}>Decisions locked at this handoff</h4>
              <ul style={{ paddingLeft: 18 }}>
                <li>
                  Admin UI is bounded by what the existing API exposes — no UI-driven backend
                  design.
                </li>
                <li>End-user UI is minimal: auth + stats + account only.</li>
                <li>MCP server lives in the desktop-client domain, not the server repo.</li>
                <li>
                  Admin sees own transcriptions, notes, conversations as read-only; RLS prevents
                  cross-tenant view.
                </li>
              </ul>
              <h4 style={{ marginTop: 18, fontSize: 14 }}>Next steps</h4>
              <p>
                Hand SPEC + the two UI-SPEC skeletons to Claude Design for visual mockups. After
                mockups land, /gsd-execute-phase 7 writes the actual UI-SPEC files referencing the
                visual.
              </p>
            </div>
          </div>
        </div>
        <div className="v-col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <h3>Metadata</h3>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <table className="tbl">
                <tbody>
                  <tr>
                    <td className="dim" style={{ fontSize: 12, width: 90 }}>
                      Folder
                    </td>
                    <td>{n.folder}</td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Type
                    </td>
                    <td>
                      <Badge>{n.type}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Words
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {n.words}
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Created
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {n.when}
                    </td>
                  </tr>
                  <tr>
                    <td className="dim" style={{ fontSize: 12 }}>
                      Updated
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      2026-05-12 10:21
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Tags</h3>
            </div>
            <div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["phase-7", "ui-spec", "audit-log", "handoff"].map((t) => (
                <Badge key={t} kind="accent">
                  #{t}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── U10 Notes search (empty) ────────────────────────────────────────────
function ScreenNotesSearch() {
  return (
    <Shell page="notes" crumbs={["Notes", "Search"]}>
      <div className="content wide">
        <div className="page-head">
          <div>
            <h1>Search notes</h1>
            <div className="lede">
              Full-text + semantic search across all your notes. Embeddings refreshed nightly.
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: 18 }}>
            <div style={{ position: "relative" }}>
              <Icon
                name="search"
                size={16}
                style={{ position: "absolute", left: 14, top: 12, color: "var(--text-muted)" }}
              />
              <input
                className="input lg"
                style={{ paddingLeft: 40 }}
                defaultValue="partition pruning postgres"
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Badge kind="accent">#audit-log</Badge>
              <Badge kind="accent">#postgres</Badge>
              <Badge>folder: Work</Badge>
              <Badge>last 30 days</Badge>
            </div>
          </div>
          <EmptyState
            icon="search"
            title="No results for that query"
            body={
              'We searched all 84 notes and found nothing matching "partition pruning postgres" with these filters. Try fewer filters, or broader keywords.'
            }
            action={<Btn>Clear filters</Btn>}
          />
        </div>
      </div>
    </Shell>
  );
}

// ── U11 Conversations list ──────────────────────────────────────────────
function ScreenConvList() {
  return (
    <Shell page="conversations" crumbs={["Conversations"]}>
      <div className="content wide">
        <div className="page-head">
          <div>
            <h1>Conversations</h1>
            <div className="lede">
              Your chat conversations with the OpenWhispr Server. Models route through LiteLLM;
              tokens count against your usage.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="filterbar">
            <input className="input" style={{ width: 280 }} placeholder="Search conversations…" />
            <select className="input" style={{ width: 180 }}>
              <option>All models</option>
              <option>claude-sonnet-4-5</option>
              <option>gpt-4o-mini</option>
            </select>
            <div style={{ flex: 1 }} />
            <Badge>{CONVERSATIONS.length} results</Badge>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th className="num" style={{ width: 90 }}>
                  Messages
                </th>
                <th style={{ width: 200 }}>Model</th>
                <th className="num" style={{ width: 110 }}>
                  Tokens
                </th>
                <th style={{ width: 170 }}>When</th>
              </tr>
            </thead>
            <tbody>
              {CONVERSATIONS.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <Icon name="msgs" size={14} style={{ color: "var(--text-muted)" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.title}
                      </span>
                    </div>
                  </td>
                  <td className="num mono" style={{ fontSize: 12 }}>
                    {c.msgs}
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {c.model}
                    </span>
                  </td>
                  <td className="num mono" style={{ fontSize: 12 }}>
                    {c.tokens.toLocaleString()}
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {c.when}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

// ── U12 Conversation detail ─────────────────────────────────────────────
function ScreenConvDetail() {
  const c = CONVERSATIONS[0];
  return (
    <Shell
      page="conversations"
      crumbs={["Conversations", c.title]}
      actions={
        <>
          <Btn icon="copy" sm>
            Copy
          </Btn>
        </>
      }
    >
      <div className="content" style={{ maxWidth: 900 }}>
        <div className="page-head">
          <div>
            <h1 style={{ fontSize: 20 }}>{c.title}</h1>
            <div className="lede mono" style={{ fontSize: 12 }}>
              {c.id} · {c.model} · {c.tokens.toLocaleString()} tokens · {c.msgs} messages
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: "4px 18px" }}>
            {MESSAGES_DETAIL.map((m, i) => (
              <div key={i} className={"msg " + m.role}>
                <div className="who">
                  <div>{m.role}</div>
                  <div
                    className="mono dim"
                    style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-dim)" }}
                  >
                    {m.when.slice(11, 19)}
                  </div>
                </div>
                <div className="content">{m.content}</div>
              </div>
            ))}
          </div>
          <div
            style={{
              padding: 14,
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: 8,
              background: "var(--panel-2)",
            }}
          >
            <input
              className="input"
              placeholder="This is a read-only view. Reply on the desktop client."
              disabled
              style={{ opacity: 0.6, flex: 1 }}
            />
            <Btn kind="accent" icon="send" disabled>
              Send
            </Btn>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── U13 Conversations search (empty) ────────────────────────────────────
function ScreenConvSearch() {
  return (
    <Shell page="conversations" crumbs={["Conversations", "Search"]}>
      <div className="content wide">
        <div className="page-head">
          <div>
            <h1>Search conversations</h1>
            <div className="lede">
              Find a conversation by its title, by the content of any message, or by tokens / model.
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: 18 }}>
            <div style={{ position: "relative" }}>
              <Icon
                name="search"
                size={16}
                style={{ position: "absolute", left: 14, top: 12, color: "var(--text-muted)" }}
              />
              <input
                className="input lg"
                style={{ paddingLeft: 40 }}
                defaultValue="rust async runtime"
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Badge>model: claude-sonnet-4-5</Badge>
              <Badge>min: 1k tokens</Badge>
            </div>
          </div>
          <EmptyState
            icon="search"
            title="No conversations match"
            body={
              'No conversation contains "rust async runtime" with these filters. Try removing the model filter, or search the wider notes corpus instead.'
            }
            action={
              <>
                <Btn>Clear filters</Btn>
                <Btn kind="ghost">Search notes →</Btn>
              </>
            }
          />
        </div>
      </div>
    </Shell>
  );
}

Object.assign(window, {
  ScreenSignIn,
  ScreenSignUp,
  ScreenVerify,
  ScreenUsage,
  ScreenAccount,
  ScreenTrxList,
  ScreenTrxDetail,
  ScreenNotesList,
  ScreenNoteDetail,
  ScreenNotesSearch,
  ScreenConvList,
  ScreenConvDetail,
  ScreenConvSearch,
});

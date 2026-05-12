// screens-admin.jsx — A1 Audit log, A2 Observability, A3 Config

// ── A1 Audit log viewer ─────────────────────────────────────────────────
function ScreenAudit({ state = "success", selected, withDrawer }) {
  return (
    <Shell
      sidebarKind="admin"
      page="audit"
      crumbs={["Admin", "Audit log"]}
      actions={
        <>
          <Btn icon="download" sm>
            Export CSV
          </Btn>
          <Btn icon="refresh" sm>
            Refresh
          </Btn>
        </>
      }
    >
      <div className="content wide">
        <div className="page-head">
          <div>
            <h1>Audit log</h1>
            <div className="lede">
              Every authenticated action on this OpenWhispr Server instance. Read-only,
              partition-aware, retained per Phase 6 policy.
            </div>
          </div>
          <div className="page-actions">
            <div className="seg">
              <button className="on">All</button>
              <button>Auth</button>
              <button>Security</button>
              <button>System</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="filterbar">
            <input
              className="input"
              style={{ width: 260 }}
              placeholder="Search actor, action, target…"
            />
            <div className="seg">
              <button>1h</button>
              <button>24h</button>
              <button className="on">7d</button>
              <button>30d</button>
              <button>Custom</button>
            </div>
            <select className="input" style={{ width: 150 }}>
              <option>All results</option>
              <option>ok</option>
              <option>failed</option>
              <option>blocked</option>
            </select>
            <select className="input" style={{ width: 150 }}>
              <option>All actors</option>
            </select>
            <div style={{ flex: 1 }} />
            <Badge>{state === "success" ? "1,284 events" : "—"}</Badge>
          </div>

          {state === "success" && (
            <div style={{ maxHeight: 520, overflow: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 200 }}>Timestamp</th>
                    <th style={{ width: 170 }}>Actor</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th style={{ width: 100 }}>Result</th>
                    <th style={{ width: 140 }}>IP</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {AUDIT.map((e, i) => (
                    <tr key={e.id} className={selected === i ? "selected" : ""}>
                      <td className="mono" style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        {e.when}
                      </td>
                      <td>
                        {e.actor === "system" ? (
                          <Badge>system</Badge>
                        ) : (
                          <span className="mono" style={{ fontSize: 12 }}>
                            {e.actor}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className="mono"
                          style={{
                            fontSize: 12.5,
                            color: e.action.startsWith("security.")
                              ? "var(--danger)"
                              : e.action.startsWith("auth.")
                                ? "var(--accent)"
                                : "var(--text)",
                          }}
                        >
                          {e.action}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {e.target}
                      </td>
                      <td>
                        {e.result === "ok" && (
                          <Badge kind="ok" dot>
                            ok
                          </Badge>
                        )}
                        {e.result === "failed" && (
                          <Badge kind="danger" dot>
                            failed
                          </Badge>
                        )}
                        {e.result === "blocked" && (
                          <Badge kind="warn" dot>
                            blocked
                          </Badge>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {e.ip}
                      </td>
                      <td>
                        <Icon name="chevR" size={14} style={{ color: "var(--text-dim)" }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state === "loading" && <SkeletonTable cols={7} rows={9} />}
          {state === "empty" && (
            <EmptyState
              icon="search"
              title="No events match these filters"
              body="Try widening the time range, removing the actor filter, or clearing the search query."
              action={<Btn>Clear filters</Btn>}
            />
          )}
          {state === "error" && (
            <ErrorState
              body="The audit_log query timed out. Partition pruning may have failed — check Grafana → Postgres dashboards."
              action={
                <>
                  <Btn icon="refresh">Retry</Btn>
                  <Btn kind="ghost">Open Grafana</Btn>
                </>
              }
            />
          )}
        </div>

        {withDrawer && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-h">
              <h3>
                Event payload{" "}
                <span className="mono dim" style={{ marginLeft: 6, fontSize: 12 }}>
                  evt_01HZW96
                </span>
              </h3>
              <div style={{ flex: 1 }} />
              <Btn sm icon="copy" kind="ghost">
                Copy JSON
              </Btn>
            </div>
            <div
              className="card-b"
              style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18 }}
            >
              <div className="v-col" style={{ fontSize: 12.5 }}>
                <KV
                  k="Action"
                  v={
                    <span className="mono" style={{ color: "var(--accent)" }}>
                      key.issued
                    </span>
                  }
                />
                <KV k="Actor" v="elena@acme.dev" />
                <KV
                  k="Result"
                  v={
                    <Badge kind="ok" dot>
                      ok
                    </Badge>
                  }
                />
                <KV k="Duration" v={<span className="mono">47 ms</span>} />
                <KV k="Partition" v={<span className="mono">audit_log_2026_05</span>} />
              </div>
              <div className="jsonp">
                <span className="c">// audit_log row · primary key (id, ts)</span>
                {"\n"}
                {"{"}
                {"\n"}
                {"  "}
                <span className="k">"id"</span>: <span className="s">"evt_01HZW96"</span>,{"\n"}
                {"  "}
                <span className="k">"ts"</span>:{" "}
                <span className="s">"2026-05-12T10:02:51.781Z"</span>,{"\n"}
                {"  "}
                <span className="k">"actor"</span>: <span className="s">"elena@acme.dev"</span>,
                {"\n"}
                {"  "}
                <span className="k">"action"</span>: <span className="s">"key.issued"</span>,{"\n"}
                {"  "}
                <span className="k">"result"</span>: <span className="s">"ok"</span>,{"\n"}
                {"  "}
                <span className="k">"target"</span>: <span className="s">"pak_3f7e"</span>,{"\n"}
                {"  "}
                <span className="k">"ip"</span>: <span className="s">"203.0.113.42"</span>,{"\n"}
                {"  "}
                <span className="k">"payload"</span>: {"{"}
                {"\n"}
                {"    "}
                <span className="k">"pak_name"</span>:{" "}
                <span className="s">"desktop-mac-elena"</span>,{"\n"}
                {"    "}
                <span className="k">"scopes"</span>: [<span className="s">"transcribe"</span>,{" "}
                <span className="s">"notes:write"</span>],{"\n"}
                {"    "}
                <span className="k">"expires_at"</span>:{" "}
                <span className="s">"2027-05-12T10:02:51Z"</span>,{"\n"}
                {"    "}
                <span className="k">"duration_ms"</span>: <span className="n">47</span>
                {"\n"}
                {"  "}
                {"}"}
                {"\n"}
                {"}"}
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function KV({ k, v }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "90px 1fr",
        gap: 8,
        padding: "5px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span
        className="dim"
        style={{
          fontSize: 11.5,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          fontWeight: 500,
        }}
      >
        {k}
      </span>
      <span>{v}</span>
    </div>
  );
}

// ── A2 Observability hub ────────────────────────────────────────────────
function ScreenObservability() {
  const dashes = [
    {
      name: "API tier — request latency, p50/p95/p99",
      body: "pino → Loki + RED metrics from Fastify hooks",
      metric: "p95: 124ms",
      kind: "ok",
    },
    {
      name: "Worker — STT job queue depth",
      body: "Bull queues, retries, failures, throughput",
      metric: "3 in flight",
      kind: null,
    },
    {
      name: "Postgres — audit_log partitions",
      body: "partition_pruning hit rate, dead tuples, vacuum",
      metric: "99.4% pruned",
      kind: "ok",
    },
    {
      name: "LiteLLM — provider routing",
      body: "Tokens/sec per provider, fallback chain hits",
      metric: "11 req/min",
      kind: null,
    },
    {
      name: "Security — rate limits, SSRF, auth failures",
      body: "Counters from middleware, 24h rolling",
      metric: "7 blocked · 24h",
      kind: "warn",
    },
    {
      name: "System — CPU, RAM, disk, NET",
      body: "node_exporter on the host",
      metric: "CPU 38%",
      kind: null,
    },
  ];
  return (
    <Shell sidebarKind="admin" page="observ" crumbs={["Admin", "Observability"]}>
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Observability</h1>
            <div className="lede">
              Deep-links to Grafana dashboards for this OpenWhispr Server installation. All metrics,
              logs and traces live in your own stack.
            </div>
          </div>
          <Btn icon="external" kind="primary">
            Open Grafana
          </Btn>
        </div>

        <div className="alert info" style={{ marginBottom: 18 }}>
          <span className="ico">
            <Icon name="globe" size={16} />
          </span>
          <div>
            <b style={{ fontWeight: 600 }}>Grafana endpoint</b>
            <span className="mono dim" style={{ marginLeft: 10 }}>
              https://grafana.openwhispr.local:3000
            </span>
            <span style={{ marginLeft: 14 }}>
              <Badge kind="ok" dot>
                reachable
              </Badge>
            </span>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          {dashes.map((d, i) => (
            <div key={i} className="card" style={{ cursor: "pointer" }}>
              <div
                className="card-b"
                style={{ display: "flex", gap: 14, alignItems: "flex-start" }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    color: "var(--accent)",
                  }}
                >
                  <Icon name="activity" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 13.5, fontWeight: 600 }}>{d.name}</b>
                  </div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {d.body}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    {d.kind === "ok" && (
                      <Badge kind="ok" dot>
                        healthy
                      </Badge>
                    )}
                    {d.kind === "warn" && (
                      <Badge kind="warn" dot>
                        attention
                      </Badge>
                    )}
                    <span className="mono dim" style={{ fontSize: 12 }}>
                      {d.metric}
                    </span>
                    <div style={{ flex: 1 }} />
                    <span
                      className="dim"
                      style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      Open
                      <Icon name="external" size={12} />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h">
            <h3>Quick links</h3>
          </div>
          <div className="list">
            {[
              { label: "Loki — application logs", href: "loki.openwhispr.local", ico: "log" },
              { label: "Mimir — Prometheus metrics", href: "mimir.openwhispr.local", ico: "chart" },
              { label: "Tempo — distributed tracing", href: "tempo.openwhispr.local", ico: "zap" },
              {
                label: "Alertmanager — routing & silences",
                href: "alerts.openwhispr.local",
                ico: "alert",
              },
            ].map((l, i) => (
              <div className="row" key={i}>
                <div className="icon">
                  <Icon name={l.ico} size={15} />
                </div>
                <div className="body">
                  <b>{l.label}</b>
                  <span className="mono">{l.href}</span>
                </div>
                <Icon name="external" size={14} style={{ color: "var(--text-muted)" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── A3 Config view ──────────────────────────────────────────────────────
function ScreenConfig() {
  return (
    <Shell sidebarKind="admin" page="config" crumbs={["Admin", "Config"]}>
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Configuration</h1>
            <div className="lede">
              Server-side configuration for speech-to-text and note recording. Set via env vars;
              admin can view but not edit in v1.
            </div>
          </div>
          <Btn icon="external" kind="ghost">
            Docs: how to override
          </Btn>
        </div>

        <div className="alert" style={{ marginBottom: 18 }}>
          <span className="ico">
            <Icon name="lock" size={15} />
          </span>
          <div>
            <b style={{ fontWeight: 600 }}>Read-only</b>
            <span className="dim" style={{ marginLeft: 8 }}>
              Edits require restarting the api container with updated env. See{" "}
              <a href="#" style={{ color: "var(--accent)" }}>
                config.md
              </a>
              .
            </span>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <div className="card">
            <div className="card-h">
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  background: "var(--panel-2)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--accent)",
                }}
              >
                <Icon name="mic" size={15} />
              </div>
              <div>
                <h3>STT config</h3>
                <div className="sub mono">GET /api/stt-config</div>
              </div>
              <div style={{ flex: 1 }} />
              <Btn sm icon="copy" kind="ghost">
                Copy
              </Btn>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <table className="tbl">
                <tbody>
                  {Object.entries(CONFIG_STT).map(([k, v]) => (
                    <tr key={k} style={{ cursor: "default" }}>
                      <td
                        className="mono"
                        style={{ color: "var(--text-muted)", width: 220, fontSize: 12.5 }}
                      >
                        {k}
                      </td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {Array.isArray(v) ? (
                          v.join(" → ")
                        ) : typeof v === "boolean" ? (
                          <Badge kind={v ? "ok" : null} dot>
                            {String(v)}
                          </Badge>
                        ) : (
                          String(v)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  background: "var(--panel-2)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--accent)",
                }}
              >
                <Icon name="notes" size={15} />
              </div>
              <div>
                <h3>Note recording</h3>
                <div className="sub mono">GET /api/note-recording-config</div>
              </div>
              <div style={{ flex: 1 }} />
              <Btn sm icon="copy" kind="ghost">
                Copy
              </Btn>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <table className="tbl">
                <tbody>
                  {Object.entries(CONFIG_NOTE).map(([k, v]) => (
                    <tr key={k} style={{ cursor: "default" }}>
                      <td
                        className="mono"
                        style={{ color: "var(--text-muted)", width: 220, fontSize: 12.5 }}
                      >
                        {k}
                      </td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {typeof v === "boolean" ? (
                          <Badge kind={v ? "ok" : null} dot>
                            {String(v)}
                          </Badge>
                        ) : (
                          String(v)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-h">
            <h3>Effective env</h3>
            <div className="sub dim">First 6 of 41 variables · sensitive values redacted</div>
            <div style={{ flex: 1 }} />
            <Badge kind="info">v1.0.4</Badge>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Value</th>
                  <th style={{ width: 120 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["DATABASE_URL", "postgres://app:••••@db:5432/openwhispr", "env"],
                  ["REDIS_URL", "redis://cache:6379/0", "env"],
                  ["LITELLM_BASE_URL", "http://litellm:4000", "env"],
                  ["BETTER_AUTH_SECRET", "••••••••••••••••••••", "env"],
                  ["STT_DEFAULT_PROVIDER", "openai", "env"],
                  ["NODE_ENV", "production", "env"],
                ].map(([k, v, src]) => (
                  <tr key={k}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {k}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                      {v}
                    </td>
                    <td>
                      <Badge>{src}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}

Object.assign(window, { ScreenAudit, ScreenObservability, ScreenConfig });

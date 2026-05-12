// ui.jsx — shared primitives: Icon, Shell, Sidebar, TopBar, AuthShell, BrowserFrame,
// Table, Badge, Button, Card, Skeleton — Lucide-style inline SVG icons.

const I = {
  // Lucide-style 16/18px stroke icons
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM21 21l-4.35-4.35",
  filter: "M3 6h18M6 12h12M10 18h4",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  external: "M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
  copy: "M9 9h10v10H9zM5 15V5a2 2 0 0 1 2-2h10",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  clock: "M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z",
  user: "M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  chart: "M3 3v18h18M7 14l4-4 4 4 5-5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  notes:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  msgs: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  alert:
    "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  arrow: "M5 12h14M12 5l7 7-7 7",
  chev: "m6 9 6 6 6-6",
  chevR: "m9 6 6 6-6 6",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowL: "M19 12H5M12 19l-7-7 7-7",
  plus: "M12 5v14M5 12h14",
  mail: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2ZM22 6l-10 7L2 6",
  lock: "M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4",
  log: "M15 3h6v6M14 10 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
  trash:
    "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
  github:
    "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.4 3.4 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7a5.4 5.4 0 0 0-1.5-3.75 5 5 0 0 0-.09-3.77S17.7.65 15 2.48a13.4 13.4 0 0 0-7 0C5.31.65 4.09 1 4.09 1A5 5 0 0 0 4 4.77a5.4 5.4 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22",
  google:
    "M20.4 11.8c0 6.4-4.4 10.9-10.9 10.9a10.8 10.8 0 1 1 0-21.6c2.9 0 5.4 1.1 7.3 2.8l-3 3a6.3 6.3 0 0 0-4.3-1.7 7 7 0 1 0 6.6 9.3h-6.6v-3.9h10.8c.1.6.1 1.1.1 2.2z",
  refresh: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  zap: "M13 2 3 14h9l-1 8 10-12h-9z",
  globe:
    "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8Zm0 0L15.5 7.5 18 10l3-3-2.5-2.5",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  sliders: "M21 4H14M10 4H3M21 12H12M8 12H3M21 20H16M12 20H3M14 2v4M8 10v4M16 18v4",
  send: "m22 2-7 20-4-9-9-4z",
};

function Icon({ name, size = 16, stroke = 1.6, style }) {
  const d = I[name] || I.x;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      {d.split(" M").map((p, i) => (
        <path key={i} d={(i ? "M" : "") + p} />
      ))}
    </svg>
  );
}

// Browser chrome frame — minimal (no URL bar acrobatics)
function BrowserFrame({
  title = "openwhispr.local",
  scope = "Admin",
  children,
  height = 800,
  theme = "dark",
}) {
  const dark = theme === "dark";
  return (
    <div
      data-theme={theme}
      style={{
        width: 1280,
        height,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: dark
          ? "0 20px 60px -20px rgba(0,0,0,.6), 0 0 0 1px #27272a"
          : "0 24px 80px -20px rgba(0,0,0,.18), 0 0 0 1px #e4e4e7",
        display: "flex",
        flexDirection: "column",
        background: dark ? "#09090b" : "#fafafa",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          height: 36,
          flexShrink: 0,
          background: dark ? "#18181b" : "#f4f4f5",
          borderBottom: "1px solid " + (dark ? "#27272a" : "#e4e4e7"),
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 7 }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: dark ? "#a1a1aa" : "#71717a",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            marginLeft: 8,
          }}
        >
          {title} <span style={{ color: dark ? "#52525b" : "#a1a1aa", margin: "0 7px" }}>·</span>{" "}
          {scope}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>{children}</div>
    </div>
  );
}

// In-app shell with sidebar + topbar
function Shell({ section, page, crumbs, actions, children, sidebarKind = "app" }) {
  return (
    <>
      <Sidebar section={section} active={page} kind={sidebarKind} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <TopBar crumbs={crumbs} actions={actions} />
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>{children}</div>
      </div>
    </>
  );
}

const NAV_ADMIN = [
  { id: "audit", label: "Audit log", icon: "log" },
  { id: "observ", label: "Observability", icon: "activity" },
  { id: "config", label: "Config", icon: "sliders" },
];
const NAV_USER = [
  { id: "usage", label: "Usage", icon: "chart" },
  { id: "transcriptions", label: "Transcriptions", icon: "mic" },
  { id: "notes", label: "Notes", icon: "notes" },
  { id: "conversations", label: "Conversations", icon: "msgs" },
  { id: "account", label: "Account", icon: "user" },
];

function Sidebar({ kind = "app", active }) {
  const items = kind === "admin" ? NAV_ADMIN : NAV_USER;
  return (
    <aside className="sb">
      <div className="sb-brand">
        <div className="logo">
          <span>W</span>
        </div>
        <div>
          <div className="title">OpenWhispr</div>
          <div className="sub">{kind === "admin" ? "Admin" : "Console"}</div>
        </div>
      </div>
      <div className="sb-section">{kind === "admin" ? "Operator" : "Workspace"}</div>
      <nav className="sb-nav">
        {items.map((it) => (
          <button key={it.id} className={"sb-link" + (active === it.id ? " active" : "")}>
            <span className="sb-ico">
              <Icon name={it.icon} size={15} />
            </span>
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
      <div className="sb-foot">
        <div className="avatar">EN</div>
        <div className="who">
          <b>Elena Novak</b>
          <span>elena@acme.dev</span>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ crumbs = [], actions }) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "cur" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="spacer" />
      {actions}
      <button className="iconbtn" title="Theme">
        <Icon name="eye" size={15} />
      </button>
      <button className="iconbtn" title="Help">
        <Icon name="external" size={15} />
      </button>
    </div>
  );
}

// Auth wrap (sign-in, sign-up, verify) — split panel
function AuthShell({ children, sideTitle, sideKicker, sideQuote }) {
  return (
    <div className="auth-wrap" style={{ flex: 1, minHeight: 0 }}>
      <div className="side">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            className="logo"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--text)",
              color: "var(--bg)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            W
          </div>
          <div>
            <div style={{ fontWeight: 600, letterSpacing: "-.01em" }}>OpenWhispr Server</div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: ".04em",
              }}
            >
              {sideKicker || "Self-host · v1"}
            </div>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-.025em",
              lineHeight: 1.15,
              maxWidth: "14ch",
            }}
          >
            {sideTitle || "Your speech, on your servers."}
          </h2>
          <p
            style={{
              marginTop: 14,
              color: "var(--text-muted)",
              maxWidth: "40ch",
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            {sideQuote ||
              "Private speech-to-text, structured notes, and conversation history — running in your own environment, with full audit trail."}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 11.5,
            color: "var(--text-muted)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <span className="mono">v1.0.4</span>
          <span>·</span>
          <a className="dim" href="#">
            Status
          </a>
          <a className="dim" href="#">
            Docs
          </a>
          <a className="dim" href="#">
            GitHub
          </a>
        </div>
      </div>
      <div className="form">{children}</div>
    </div>
  );
}

// Table + badges + buttons reused everywhere

function Badge({ kind, children, dot }) {
  return (
    <span className={"badge" + (kind ? " " + kind : "") + (dot ? " dot" : "")}>{children}</span>
  );
}

function Btn({ kind, sm, lg, icon, children, ...rest }) {
  return (
    <button
      className={"btn" + (kind ? " " + kind : "") + (sm ? " sm" : "") + (lg ? " lg" : "")}
      {...rest}
    >
      {icon && <Icon name={icon} size={sm ? 13 : 14} />}
      {children}
    </button>
  );
}

function Field({ label, hint, error, children }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
      {error && (
        <div className="err">
          <Icon name="alert" size={12} />
          {error}
        </div>
      )}
      {hint && !error && <div className="help">{hint}</div>}
    </div>
  );
}

// Skeleton helpers
function Sk({ w = "100%", h = 12, r = 4, style }) {
  return (
    <span
      className="sk"
      style={{ display: "inline-block", width: w, height: h, borderRadius: r, ...style }}
    />
  );
}

function SkeletonTable({ cols = 6, rows = 8 }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i}>
              <Sk w={60} h={9} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}>
                <Sk w={c === 0 ? 140 : c === cols - 1 ? 50 : 90} h={10} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState({ icon = "inbox", title, body, action }) {
  return (
    <div className="empty">
      <div className="icon">
        <Icon name={icon} size={22} />
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

function ErrorState({ title = "Could not load", body, action }) {
  return (
    <div className="empty">
      <div
        className="icon"
        style={{
          color: "var(--danger)",
          background: "color-mix(in oklab, var(--danger) 8%, transparent)",
          borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)",
        }}
      >
        <Icon name="alert" size={22} />
      </div>
      <h4>{title}</h4>
      <p>
        {body || "Something went wrong while fetching from the API. Check your network and retry."}
      </p>
      <div style={{ marginTop: 8 }}>{action || <Btn icon="refresh">Retry</Btn>}</div>
    </div>
  );
}

Object.assign(window, {
  Icon,
  BrowserFrame,
  Shell,
  Sidebar,
  TopBar,
  AuthShell,
  Badge,
  Btn,
  Field,
  Sk,
  SkeletonTable,
  EmptyState,
  ErrorState,
});

/* Direction B · Calm Orchestrator
   Editorial, generous whitespace, status-as-narrative. Same data, different posture. */

const { useState: bUseState, useMemo: bUseMemo } = React;

const B_TOKENS = {
  bg: 'var(--b-bg)', surface: 'var(--b-surface)', surface2: 'var(--b-surface-2)',
  border: 'var(--b-border)', border2: 'var(--b-border-2)',
  text: 'var(--b-text)', text2: 'var(--b-text-2)', text3: 'var(--b-text-3)',
  accent: 'var(--b-accent)', accent2: 'var(--b-accent-2)',
  good: 'var(--b-good)', warn: 'var(--b-warn)', bad: 'var(--b-bad)', info: 'var(--b-info)',
  sans: 'var(--b-sans)', display: 'var(--b-display)'
};

// ─── Atoms ─────────────────────────────────────────────
function BConfigureInApp({ title, steps, link }) {
  return (
    <div style={{
      marginBottom: 14, padding: '12px 14px',
      background: `${B_TOKENS.info}0c`,
      border: `1px solid ${B_TOKENS.info}30`,
      borderRadius: 8,
    }}>
      <div style={{
        fontFamily: B_TOKENS.sans, fontSize: 11, fontWeight: 600,
        letterSpacing: 0.3, textTransform: 'uppercase',
        color: B_TOKENS.info, marginBottom: 8,
      }}>↗ {title}</div>
      <ol style={{
        margin: 0, padding: '0 0 0 18px',
        fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2,
        lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {link && (
        <a href={link.href} target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-block', marginTop: 10,
          fontFamily: B_TOKENS.sans, fontSize: 12, fontWeight: 500,
          color: B_TOKENS.info, textDecoration: 'none',
          borderBottom: `1px solid ${B_TOKENS.info}60`,
          paddingBottom: 1,
        }}>{link.label} →</a>
      )}
    </div>
  );
}

function BPill({ children, color, bg, style }) {
  return <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '3px 9px', borderRadius: 999,
    fontSize: 11, fontWeight: 500, letterSpacing: 0.1,
    fontFamily: B_TOKENS.sans,
    color: color || B_TOKENS.text2,
    background: bg || `${B_TOKENS.surface2}`,
    border: `1px solid ${B_TOKENS.border}`,
    whiteSpace: 'nowrap',
    ...style
  }}>{children}</span>;
}

function BTierBadge({ tier, tiers, size = 'md' }) {
  const t = tiers.find((x) => x.id === tier) || tiers[0];
  const sm = size === 'sm';
  return <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: sm ? '2px 8px' : '3px 10px',
    borderRadius: 999,
    background: `${t.color}15`,
    border: `1px solid ${t.color}40`,
    color: t.color,
    fontFamily: B_TOKENS.sans, fontSize: sm ? 10 : 11, fontWeight: 500
  }}>
    <span style={{ width: sm ? 5 : 6, height: sm ? 5 : 6, borderRadius: '50%', background: t.color }} />
    {t.label}
  </span>;
}

function BStatusDot({ status }) {
  const map = { running: B_TOKENS.good, idle: B_TOKENS.text3, stopped: B_TOKENS.text3, error: B_TOKENS.bad };
  const c = map[status] || B_TOKENS.text3;
  const pulse = status === 'running';
  return <span style={{ position: 'relative', display: 'inline-block', width: 8, height: 8 }}>
    <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: c }} />
    {pulse && <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: c, opacity: 0.25, animation: 'aPulse 2s ease-out infinite' }} />}
  </span>;
}

function BBtn({ children, kind = 'default', size = 'md', onClick, icon, style }) {
  const sizes = {
    sm: { padding: '5px 10px', fontSize: 12 },
    md: { padding: '8px 14px', fontSize: 13 },
    lg: { padding: '10px 18px', fontSize: 14 }
  };
  const kinds = {
    default: { background: B_TOKENS.surface, color: B_TOKENS.text, border: `1px solid ${B_TOKENS.border}` },
    primary: { background: B_TOKENS.accent, color: '#fff', border: `1px solid ${B_TOKENS.accent}` },
    ghost: { background: 'transparent', color: B_TOKENS.text2, border: '1px solid transparent' },
    danger: { background: 'transparent', color: B_TOKENS.bad, border: `1px solid ${B_TOKENS.bad}40` }
  };
  return <button onClick={onClick} style={{
    display: 'inline-flex', alignItems: 'center', gap: 7,
    fontFamily: B_TOKENS.sans, fontWeight: 500,
    cursor: 'pointer', borderRadius: 8,
    transition: 'all 0.15s',
    ...sizes[size], ...kinds[kind], ...style
  }}>{icon && <BIcon name={icon} size={size === 'sm' ? 13 : 14} />}{children}</button>;
}

function BIcon({ name, size = 16, color }) {
  const c = color || 'currentColor';
  const ic = {
    chev: <path d="M6 5 L11 8 L6 11" stroke={c} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
    chevD: <path d="M5 7 L8 10 L11 7" stroke={c} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
    plus: <path d="M8 3 L8 13 M3 8 L13 8" stroke={c} strokeWidth="1.6" strokeLinecap="round" />,
    refresh: <path d="M3 8 A5 5 0 0 1 13 8 M13 8 L11 6 M13 8 L11 10" stroke={c} fill="none" strokeWidth="1.5" strokeLinecap="round" />,
    play: <path d="M5 3 L13 8 L5 13 Z" fill={c} />,
    stop: <rect x="4" y="4" width="9" height="9" fill={c} rx="1" />,
    grid: <><rect x="2" y="2" width="5" height="5" stroke={c} strokeWidth="1.5" fill="none" rx="1" /><rect x="9" y="2" width="5" height="5" stroke={c} strokeWidth="1.5" fill="none" rx="1" /><rect x="2" y="9" width="5" height="5" stroke={c} strokeWidth="1.5" fill="none" rx="1" /><rect x="9" y="9" width="5" height="5" stroke={c} strokeWidth="1.5" fill="none" rx="1" /></>,
    flow: <path d="M2 8 L4 8 L6 4 L10 12 L12 8 L14 8" stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    link: <path d="M5 11 A3 3 0 0 1 5 7 L7 5 A3 3 0 0 1 11 5 M11 5 A3 3 0 0 1 11 9 L9 11 A3 3 0 0 1 5 11 M6 9 L10 5" stroke={c} strokeWidth="1.5" fill="none" />,
    bolt: <path d="M9 1 L4 9 L8 9 L7 15 L12 7 L8 7 Z" fill={c} />,
    key: <><circle cx="5" cy="11" r="2.5" stroke={c} strokeWidth="1.5" fill="none" /><path d="M7 9 L13 3 M11 5 L13 7 M9 7 L11 9" stroke={c} strokeWidth="1.5" /></>,
    brain: <path d="M5 4 C3 4 3 7 4 8 C3 9 3 12 5 12 C5 13 8 14 8 12 C8 14 11 13 11 12 C13 12 13 9 12 8 C13 7 13 4 11 4 C11 3 8 2 8 4 C8 2 5 3 5 4 Z" stroke={c} strokeWidth="1.4" fill="none" />,
    shield: <path d="M8 1 L13 3 L13 8 C13 11 11 13 8 14 C5 13 3 11 3 8 L3 3 Z" stroke={c} fill="none" strokeWidth="1.5" />,
    book: <path d="M3 3 L3 13 L8 12 L13 13 L13 3 L8 4 Z M8 4 L8 12" stroke={c} strokeWidth="1.5" fill="none" />,
    settings: <><circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.5" fill="none" /><path d="M8 1 L8 3 M8 13 L8 15 M1 8 L3 8 M13 8 L15 8 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3" stroke={c} strokeWidth="1.5" /></>,
    arrow: <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke={c} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    search: <><circle cx="7" cy="7" r="4" stroke={c} strokeWidth="1.5" fill="none" /><path d="M10 10 L13 13" stroke={c} strokeWidth="1.5" strokeLinecap="round" /></>,
    check: <path d="M3 8 L7 12 L13 4" stroke={c} strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    warn: <><path d="M8 2 L14 13 L2 13 Z" stroke={c} fill="none" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6 L8 9 M8 11 L8 11.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" /></>,
    sparkle: <path d="M8 2 L9 7 L14 8 L9 9 L8 14 L7 9 L2 8 L7 7 Z" fill={c} />
  };
  return <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>{ic[name]}</svg>;
}

function BPlatformIcon({ kind, size = 14 }) {
  // reuse A's
  return APlatformIcon({ kind, size });
}

function BCard({ children, style, padded = true }) {
  return <div style={{
    background: B_TOKENS.surface,
    border: `1px solid ${B_TOKENS.border}`,
    borderRadius: 12,
    padding: padded ? 18 : 0,
    ...style
  }}>{children}</div>;
}

function BSectionLabel({ children, style }) {
  return <div style={{
    fontFamily: B_TOKENS.sans, fontSize: 11, fontWeight: 600,
    letterSpacing: 0.5, textTransform: 'uppercase',
    color: B_TOKENS.text3, ...style
  }}>{children}</div>;
}

// ─── Sidebar ───────────────────────────────────────────
function BSidebar({ route, setRoute }) {
  const items = [
  { id: 'dashboard', label: 'Overview', icon: 'grid' },
  { id: 'harnesses', label: 'Harnesses', icon: 'flow', count: 8 },
  { id: 'surfaces', label: 'Chat surfaces', icon: 'link' },
  { id: 'tools', label: 'Tools', icon: 'bolt' },
  { id: 'keys', label: 'Keys', icon: 'key', warn: true },
  { id: 'memory', label: 'Memory', icon: 'brain' },
  { id: 'permissions', label: 'People', icon: 'shield' },
  { id: 'audit', label: 'Activity', icon: 'book' }];

  const baseRoute = route.split('/')[0];
  return <div style={{
    width: 224, flexShrink: 0,
    background: B_TOKENS.bg,
    borderRight: `1px solid ${B_TOKENS.border}`,
    display: 'flex', flexDirection: 'column',
    padding: 20
  }}>
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontFamily: B_TOKENS.display, fontSize: 22, fontWeight: 500,
        color: B_TOKENS.text, letterSpacing: -0.6, lineHeight: 1
      }}>Swarm-Map</div>
      <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 5 }}>Multiplayer AI for the cyborg era.
v0.4 · Hermes
      </div>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((it) => {
        const active = baseRoute === it.id;
        return <button key={it.id} onClick={() => setRoute(it.id)} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', borderRadius: 8,
          background: active ? B_TOKENS.surface : 'transparent',
          color: active ? B_TOKENS.text : B_TOKENS.text2,
          border: 'none', cursor: 'pointer',
          fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: active ? 500 : 400,
          textAlign: 'left',
          boxShadow: active ? `inset 0 0 0 1px ${B_TOKENS.border}` : 'none'
        }}>
          <BIcon name={it.icon} size={14} color={active ? B_TOKENS.accent : B_TOKENS.text3} />
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.count != null && <span style={{ fontSize: 11, color: B_TOKENS.text3 }}>{it.count}</span>}
          {it.warn && <span style={{ width: 6, height: 6, borderRadius: '50%', background: B_TOKENS.warn }} />}
        </button>;
      })}
    </div>

    <div style={{ flex: 1 }} />

    <button onClick={() => setRoute('settings')} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 8, background: 'transparent',
      color: baseRoute === 'settings' ? B_TOKENS.text : B_TOKENS.text2,
      border: 'none', cursor: 'pointer',
      fontFamily: B_TOKENS.sans, fontSize: 13, textAlign: 'left'
    }}>
      <BIcon name="settings" size={14} color={B_TOKENS.text3} />Settings
    </button>

    <div style={{
      marginTop: 12, padding: '10px 12px',
      background: B_TOKENS.surface, borderRadius: 10,
      border: `1px solid ${B_TOKENS.border}`,
      display: 'flex', alignItems: 'center', gap: 8
    }}>
      <BStatusDot status="running" />
      <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11 }}>
        <div style={{ color: B_TOKENS.text }}>Hermes connected</div>
        <div style={{ color: B_TOKENS.text3, fontSize: 10, marginTop: 1 }}>localhost:8400</div>
      </div>
    </div>
  </div>;
}

// ─── Top bar ───────────────────────────────────────────
function BTopBar({ route, setRoute, theme, setTheme, viewToggle }) {
  return <div style={{
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 28px',
    borderBottom: `1px solid ${B_TOKENS.border}`,
    background: B_TOKENS.bg
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 8,
      background: B_TOKENS.surface, border: `1px solid ${B_TOKENS.border}`,
      color: B_TOKENS.text3, fontFamily: B_TOKENS.sans, fontSize: 12,
      flex: 1, maxWidth: 380
    }}>
      <BIcon name="search" size={13} color={B_TOKENS.text3} />
      <span style={{ flex: 1 }}>Search harnesses, tools, people…</span>
      <span style={{
        padding: '1px 5px', borderRadius: 4, background: B_TOKENS.surface2,
        fontSize: 10
      }}>⌘K</span>
    </div>
    <div style={{ flex: 1 }} />
    {viewToggle}
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    style={{
      background: 'transparent', border: `1px solid ${B_TOKENS.border}`,
      color: B_TOKENS.text2, padding: '6px 10px', borderRadius: 8,
      cursor: 'pointer', fontFamily: B_TOKENS.sans, fontSize: 13
    }}>{theme === 'dark' ? '☾' : '☼'}</button>
    <div style={{
      width: 30, height: 30, borderRadius: '50%',
      background: B_TOKENS.accent, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: B_TOKENS.sans, fontSize: 12, fontWeight: 600
    }}>JB</div>
  </div>;
}

// ─── Dashboard ─────────────────────────────────────────
function BDashboard({ data, setRoute }) {
  const running = data.HARNESSES.filter((h) => h.status === 'running').length;
  const errors = data.HARNESSES.filter((h) => h.status === 'error').length;
  const totalCost = data.HARNESSES.reduce((s, h) => s + (h.costToday || 0), 0);
  const totalCalls = data.HARNESSES.reduce((s, h) => s + (h.invocations || 0), 0);
  const expiredKey = data.KEYS.find((k) => k.health === 'expired');

  return <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
    {/* Hero greeting */}
    <div>
      <h1 style={{
        margin: 0, fontFamily: B_TOKENS.display, fontSize: 32, fontWeight: 400,
        color: B_TOKENS.text, letterSpacing: -0.8, lineHeight: 1.1
      }}>Good morning, Juni.</h1>
      <p style={{
        margin: '10px 0 0', fontFamily: B_TOKENS.sans, fontSize: 15,
        color: B_TOKENS.text2, lineHeight: 1.5, maxWidth: 640
      }}>
        <span style={{ color: B_TOKENS.text }}>{running} of {data.HARNESSES.length} harnesses running.</span>{' '}
        Today's flock has handled <span style={{ color: B_TOKENS.text }}>{totalCalls.toLocaleString()} invocations</span> for <span style={{ color: B_TOKENS.text }}>${totalCost.toFixed(2)}</span>.{' '}
        {errors > 0 && <span style={{ color: B_TOKENS.bad }}>{errors} need a look.</span>}
      </p>
    </div>

    {/* Alert if any */}
    {expiredKey &&
    <BCard style={{ background: `${B_TOKENS.warn}15`, borderColor: `${B_TOKENS.warn}50` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <BIcon name="warn" size={20} color={B_TOKENS.warn} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 500, color: B_TOKENS.text }}>
              {expiredKey.label} expired
            </div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, marginTop: 3 }}>
              {expiredKey.healthMsg}. {expiredKey.assignedTo.length} harnesses affected.
            </div>
          </div>
          <BBtn size="sm" onClick={() => setRoute('keys')}>Rotate now</BBtn>
        </div>
      </BCard>
    }

    {/* Top stats row */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      <BStatCard label="Running" value={`${running}/${data.HARNESSES.length}`} foot="all healthy" accent={B_TOKENS.good} />
      <BStatCard label="Today's spend" value={`$${totalCost.toFixed(2)}`} foot="across 5 keys" />
      <BStatCard label="Invocations" value={totalCalls.toLocaleString()} foot="↑ 18% vs yesterday" />
      <BStatCard label="Needs attention" value={errors + (expiredKey ? 1 : 0)} foot={expiredKey ? '1 key, 1 harness' : 'all clear'} accent={errors > 0 ? B_TOKENS.bad : B_TOKENS.text} />
    </div>

    {/* Two-up: harnesses and habitat */}
    <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr', gap: 14 }}>
      <BCard padded={false}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${B_TOKENS.border}`
        }}>
          <h2 style={{
            margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600,
            color: B_TOKENS.text
          }}>Your harnesses</h2>
          <BBtn size="sm" icon="plus" kind="primary">New harness</BBtn>
        </div>
        <div>
          {data.HARNESSES.map((h, i) => {
            const last = Math.round((data.now - h.lastSeen) / 60000);
            return <button key={h.id} onClick={() => setRoute('harnesses/' + h.id)}
            style={{
              width: '100%', display: 'grid',
              gridTemplateColumns: '20px 1fr auto auto auto auto 16px',
              alignItems: 'center', gap: 14,
              padding: '12px 20px',
              background: 'transparent', border: 'none',
              borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = B_TOKENS.surface2}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <BStatusDot status={h.status} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 500, color: B_TOKENS.text }}>
                  {h.name}
                </div>
                <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 2,
                  display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis'
                }}>
                  <BPlatformIcon kind={h.platform} size={11} />
                  {h.channel} · {h.persona}
                </div>
              </div>
              <BTierBadge tier={h.tier} tiers={data.TIERS} size="sm" />
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, minWidth: 50, textAlign: 'right' }}>
                ${h.costToday.toFixed(2)}
              </span>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, minWidth: 60, textAlign: 'right' }}>
                {h.invocations} calls
              </span>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, minWidth: 50, textAlign: 'right' }}>
                {last < 1 ? 'now' : last < 60 ? `${last}m` : `${Math.round(last / 60)}h`}
              </span>
              <BIcon name="chev" size={12} color={B_TOKENS.text3} />
            </button>;
          })}
        </div>
      </BCard>

      <BCard>
        <h2 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text }}>
          Habitats
        </h2>
        <p style={{ margin: '5px 0 18px', fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, lineHeight: 1.5 }}>
          Where each harness lives sets the ceiling on what it can do there.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.TIERS.map((t) => {
            const count = data.HARNESSES.filter((h) => h.tier === t.id).length;
            const pct = count / data.HARNESSES.length * 100;
            return <div key={t.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />
                <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{t.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3 }}>{count}</span>
              </div>
              <div style={{ height: 4, background: B_TOKENS.surface2, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: t.color }} />
              </div>
              <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 5, lineHeight: 1.4 }}>
                {t.desc}
              </div>
            </div>;
          })}
        </div>
      </BCard>
    </div>

    {/* Activity + surfaces */}
    <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr', gap: 14 }}>
      <BCard>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text }}>
            Today's activity
          </h2>
          <BPill color={B_TOKENS.good}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: B_TOKENS.good }} />
            Live
          </BPill>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.RECENT_LOGS.slice(0, 7).map((log, i) => {
            const t = new Date(log.ts);
            const min = Math.round((data.now - log.ts) / 60000);
            return <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingBottom: 10, borderBottom: i < 6 ? `1px dashed ${B_TOKENS.border}` : 'none' }}>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, width: 50, flexShrink: 0, marginTop: 2 }}>
                {min < 1 ? 'just now' : `${min}m ago`}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text }}>
                  <span style={{ color: B_TOKENS.accent, fontWeight: 500 }}>{log.harness}</span> · {log.msg}
                </div>
              </div>
              {log.level !== 'info' && <BPill color={log.level === 'error' ? B_TOKENS.bad : B_TOKENS.warn}>{log.level}</BPill>}
            </div>;
          })}
        </div>
      </BCard>

      <BCard>
        <h2 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 14 }}>
          Chat surfaces
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.INTEGRATIONS.map((it) => {
            const stColor = it.status === 'connected' ? B_TOKENS.good : B_TOKENS.text3;
            return <div key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: B_TOKENS.surface2, borderRadius: 8,
              opacity: it.status === 'connected' ? 1 : 0.55
            }}>
              <BPlatformIcon kind={it.kind} size={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text, fontWeight: 500 }}>
                  {it.label}
                </div>
                <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 2 }}>
                  {it.harnessIds.length > 0 ? `${it.harnessIds.length} harnesses` : it.serverInfo}
                </div>
              </div>
              <BPill color={stColor}>{it.status}</BPill>
            </div>;
          })}
        </div>
      </BCard>
    </div>
  </div>;
}

function BStatCard({ label, value, foot, accent }) {
  return <BCard>
    <BSectionLabel>{label}</BSectionLabel>
    <div style={{
      fontFamily: B_TOKENS.display, fontSize: 32, fontWeight: 400,
      color: accent || B_TOKENS.text, letterSpacing: -0.8,
      marginTop: 6, lineHeight: 1.1
    }}>{value}</div>
    {foot && <div style={{
      fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, marginTop: 6
    }}>{foot}</div>}
  </BCard>;
}

// ─── BModelStack ────────────────────────────────────────
// Calm rendering of a model priority stack. Shows primary clearly, fallbacks subdued.
function BModelStack({ models }) {
  const list = models || [];
  if (!list.length) return null;
  const catalog = (window.MOCK_DATA && window.MOCK_DATA.MODELS) || [];
  const meta = (id) => catalog.find((m) => m.id === id) || { id, label: id, accessTier: 'open', costClass: '?' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {list.map((id, i) => {
        const m = meta(id);
        const isAdmin = m.accessTier === 'admin';
        const primary = i === 0;
        return (
          <React.Fragment key={id}>
            {i > 0 && <span style={{ color: B_TOKENS.text3, fontSize: 11 }}>↳</span>}
            <span title={`${m.label || m.id}${isAdmin ? ' · admin-only model' : ''}${primary ? ' · primary' : ' · fallback'}`}
              style={{
                fontFamily: B_TOKENS.sans, fontSize: 12,
                color: primary ? B_TOKENS.text2 : B_TOKENS.text3,
                fontWeight: primary ? 500 : 400,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              {isAdmin && <span style={{ color: B_TOKENS.warn, fontSize: 9 }}>◆</span>}
              {id}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
}

Object.assign(window, { B_TOKENS, BPill, BTierBadge, BStatusDot, BBtn, BIcon, BCard, BSectionLabel, BSidebar, BTopBar, BDashboard, BPlatformIcon, BModelStack });
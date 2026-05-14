/* Direction A · Operator Console
   Dense, terminal-utility energy. Mono accents. Status as data. */

const { useState, useMemo, useEffect } = React;

const A_TOKENS = {
  bg: 'var(--a-bg)',
  surface: 'var(--a-surface)',
  surface2: 'var(--a-surface-2)',
  border: 'var(--a-border)',
  border2: 'var(--a-border-2)',
  text: 'var(--a-text)',
  text2: 'var(--a-text-2)',
  text3: 'var(--a-text-3)',
  accent: 'var(--a-accent)',
  accent2: 'var(--a-accent-2)',
  good: 'var(--a-good)',
  warn: 'var(--a-warn)',
  bad: 'var(--a-bad)',
  info: 'var(--a-info)',
  mono: 'var(--a-mono)',
  sans: 'var(--a-sans)',
};

// ─── Atoms ──────────────────────────────────────────

function ATag({ children, color = A_TOKENS.text2, bg = 'transparent', mono = true, style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 6px', borderRadius: 3,
      border: `1px solid ${A_TOKENS.border}`,
      fontFamily: mono ? A_TOKENS.mono : A_TOKENS.sans,
      fontSize: 10, lineHeight: 1.2, letterSpacing: 0.2,
      color, background: bg,
      whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  );
}

function AStatusDot({ status }) {
  const map = {
    running: A_TOKENS.good,
    idle: A_TOKENS.text3,
    stopped: A_TOKENS.text3,
    error: A_TOKENS.bad,
    warn: A_TOKENS.warn,
  };
  const color = map[status] || A_TOKENS.text3;
  const pulse = status === 'running';
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 8, height: 8 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
      }}/>
      {pulse && <span style={{
        position: 'absolute', inset: -3, borderRadius: '50%',
        background: color, opacity: 0.25,
        animation: 'aPulse 2s ease-out infinite',
      }}/>}
    </span>
  );
}

function ATierChip({ tier, tiers, compact }) {
  const t = tiers.find((x) => x.id === tier) || tiers[0];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: compact ? '1px 5px' : '2px 7px',
      borderRadius: 3,
      background: `${t.color}15`,
      border: `1px solid ${t.color}40`,
      color: t.color,
      fontFamily: A_TOKENS.mono,
      fontSize: compact ? 9 : 10,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.color }}/>
      T{t.rank} {compact ? t.label.slice(0, 3) : t.label}
    </span>
  );
}

function ARiskBar({ level }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1.5, alignItems: 'center' }}>
      {[1,2,3,4,5].map((i) => (
        <span key={i} style={{
          width: 4, height: 8,
          background: i <= level ? `var(--risk-${level})` : `${A_TOKENS.border}`,
          borderRadius: 1,
        }}/>
      ))}
    </span>
  );
}

function APlatformIcon({ kind, size = 14 }) {
  const fill = A_TOKENS.text2;
  const s = size;
  if (kind === 'mattermost') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 3 C7 3 3 7 3 12 C3 14.5 4 16.7 5.5 18.3 L4.5 21 L7.7 20.3 C9 21 10.4 21.4 12 21.4 L13 21.3 L13 18 C9.7 18 7 15.3 7 12 C7 8.7 9.7 6 13 6 L13.2 6 C13 5 12.6 4 12 3 Z M16 5.3 L16 17 C18.4 16 20 13.7 20 12 C20 9.5 18.4 6.7 16 5.3 Z"
        fill={fill}/>
    </svg>
  );
  if (kind === 'telegram') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M21 4 L2.5 11 L9 13.3 L11.5 20.5 L14.5 16 L19 19.5 Z M9.5 14 L17 7 L11 14.5 L11 18 Z" fill={fill}/>
    </svg>
  );
  if (kind === 'discord') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M19 5 L15 4 L14.5 5 C13 4.7 11 4.7 9.5 5 L9 4 L5 5 C3 9 2.5 13 3 17 L7 19 L8 17 C7 16.7 6.3 16 6 15.5 C6.5 16 9 17 12 17 C15 17 17.5 16 18 15.5 C17.7 16 17 16.7 16 17 L17 19 L21 17 C21.5 13 21 9 19 5 Z M9.5 13.5 C8.7 13.5 8 12.7 8 11.7 C8 10.7 8.7 10 9.5 10 C10.3 10 11 10.7 11 11.7 C11 12.7 10.3 13.5 9.5 13.5 Z M14.5 13.5 C13.7 13.5 13 12.7 13 11.7 C13 10.7 13.7 10 14.5 10 C15.3 10 16 10.7 16 11.7 C16 12.7 15.3 13.5 14.5 13.5 Z" fill={fill}/>
    </svg>
  );
  if (kind === 'signal') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={fill} strokeWidth="1.5"/>
      <path d="M12 7 L12 12 L15 13" stroke={fill} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
  return null;
}

function AIcon({ name, size = 14, color }) {
  const s = size; const c = color || 'currentColor';
  const icons = {
    play: <path d="M5 3 L13 8 L5 13 Z" fill={c}/>,
    stop: <rect x="4" y="4" width="8" height="8" fill={c}/>,
    refresh: <path d="M3 8 A5 5 0 0 1 13 8 M13 8 L11 6 M13 8 L11 10" stroke={c} fill="none" strokeWidth="1.4" strokeLinecap="round"/>,
    plus: <path d="M8 3 L8 13 M3 8 L13 8" stroke={c} strokeWidth="1.4" strokeLinecap="round"/>,
    chev: <path d="M5 4 L10 8 L5 12" stroke={c} strokeWidth="1.4" fill="none" strokeLinecap="round"/>,
    chevDown: <path d="M4 6 L8 10 L12 6" stroke={c} strokeWidth="1.4" fill="none" strokeLinecap="round"/>,
    dot: <circle cx="8" cy="8" r="2" fill={c}/>,
    search: <><circle cx="7" cy="7" r="4" stroke={c} strokeWidth="1.4" fill="none"/><path d="M10 10 L13 13" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></>,
    cmd: <path d="M5 3 A2 2 0 0 0 5 7 L11 7 A2 2 0 0 0 11 3 A2 2 0 0 0 11 7 L11 9 L11 11 A2 2 0 0 0 13 13 A2 2 0 0 0 11 13 L5 13 A2 2 0 0 0 5 9 L11 9" stroke={c} strokeWidth="1.2" fill="none"/>,
    bolt: <path d="M9 1 L4 9 L8 9 L7 15 L12 7 L8 7 Z" fill={c}/>,
    shield: <path d="M8 1 L13 3 L13 8 C13 11 11 13 8 14 C5 13 3 11 3 8 L3 3 Z" stroke={c} fill="none" strokeWidth="1.3"/>,
    key: <><circle cx="5" cy="11" r="2.5" stroke={c} strokeWidth="1.3" fill="none"/><path d="M7 9 L13 3 M11 5 L13 7 M9 7 L11 9" stroke={c} strokeWidth="1.3"/></>,
    layers: <><path d="M8 1 L14 5 L8 9 L2 5 Z" stroke={c} strokeWidth="1.3" fill="none"/><path d="M2 8 L8 12 L14 8 M2 11 L8 15 L14 11" stroke={c} strokeWidth="1.3" fill="none"/></>,
    brain: <path d="M5 4 C3 4 3 7 4 8 C3 9 3 12 5 12 C5 13 8 14 8 12 C8 14 11 13 11 12 C13 12 13 9 12 8 C13 7 13 4 11 4 C11 3 8 2 8 4 C8 2 5 3 5 4 Z" stroke={c} strokeWidth="1.2" fill="none"/>,
    book: <path d="M3 3 L3 13 L8 12 L13 13 L13 3 L8 4 Z M8 4 L8 12" stroke={c} strokeWidth="1.3" fill="none"/>,
    settings: <><circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.3" fill="none"/><path d="M8 1 L8 3 M8 13 L8 15 M1 8 L3 8 M13 8 L15 8 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3" stroke={c} strokeWidth="1.3"/></>,
    activity: <path d="M1 8 L4 8 L6 3 L10 13 L12 8 L15 8" stroke={c} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    grid: <><rect x="2" y="2" width="5" height="5" stroke={c} strokeWidth="1.3" fill="none"/><rect x="9" y="2" width="5" height="5" stroke={c} strokeWidth="1.3" fill="none"/><rect x="2" y="9" width="5" height="5" stroke={c} strokeWidth="1.3" fill="none"/><rect x="9" y="9" width="5" height="5" stroke={c} strokeWidth="1.3" fill="none"/></>,
    list: <><path d="M2 4 L14 4 M2 8 L14 8 M2 12 L14 12" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></>,
    arrow: <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke={c} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    x: <path d="M3 3 L13 13 M13 3 L3 13" stroke={c} strokeWidth="1.4" strokeLinecap="round"/>,
    check: <path d="M3 8 L7 12 L13 4" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    copy: <><rect x="3" y="3" width="8" height="10" stroke={c} strokeWidth="1.3" fill="none"/><path d="M5 3 L5 1 L13 1 L13 11 L11 11" stroke={c} strokeWidth="1.3" fill="none"/></>,
    eye: <><path d="M1 8 C3 4 5 3 8 3 C11 3 13 4 15 8 C13 12 11 13 8 13 C5 13 3 12 1 8 Z" stroke={c} strokeWidth="1.3" fill="none"/><circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.3" fill="none"/></>,
    link: <path d="M6 9 L9 6 M5 11 A3 3 0 0 1 5 7 L7 5 A3 3 0 0 1 11 5 M11 5 A3 3 0 0 1 11 9 L9 11 A3 3 0 0 1 5 11" stroke={c} strokeWidth="1.3" fill="none"/>,
  };
  return <svg width={s} height={s} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>{icons[name]}</svg>;
}

function ABtn({ children, kind = 'default', size = 'md', onClick, style, title, icon, active }) {
  const sizes = {
    sm: { padding: '4px 8px', fontSize: 10 },
    md: { padding: '6px 10px', fontSize: 11 },
    lg: { padding: '8px 14px', fontSize: 12 },
  };
  const kinds = {
    default: {
      background: A_TOKENS.surface2,
      border: `1px solid ${A_TOKENS.border}`,
      color: A_TOKENS.text,
    },
    primary: {
      background: A_TOKENS.accent,
      border: `1px solid ${A_TOKENS.accent}`,
      color: '#1a1a1a',
    },
    ghost: {
      background: active ? A_TOKENS.surface2 : 'transparent',
      border: `1px solid ${active ? A_TOKENS.border : 'transparent'}`,
      color: active ? A_TOKENS.text : A_TOKENS.text2,
    },
    danger: {
      background: 'transparent',
      border: `1px solid ${A_TOKENS.bad}40`,
      color: A_TOKENS.bad,
    },
  };
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontFamily: A_TOKENS.mono,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        cursor: 'pointer',
        borderRadius: 3,
        transition: 'all 0.15s',
        ...sizes[size], ...kinds[kind], ...style,
      }}
    >
      {icon && <AIcon name={icon} size={size === 'sm' ? 11 : 12}/>}
      {children}
    </button>
  );
}

function APanel({ title, children, right, style, scroll, padding = true }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: A_TOKENS.surface,
      border: `1px solid ${A_TOKENS.border}`,
      borderRadius: 4,
      overflow: 'hidden',
      ...style,
    }}>
      {title && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${A_TOKENS.border}`,
          background: A_TOKENS.surface2,
        }}>
          <div style={{
            fontFamily: A_TOKENS.mono,
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: A_TOKENS.text2,
          }}>{title}</div>
          {right}
        </div>
      )}
      <div style={{
        flex: 1, minHeight: 0,
        padding: padding ? 14 : 0,
        overflow: scroll ? 'auto' : 'visible',
      }}>{children}</div>
    </div>
  );
}

function AStat({ label, value, sub, accent }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
        textTransform: 'uppercase', color: A_TOKENS.text3, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: A_TOKENS.mono, fontSize: 22, fontWeight: 500,
        color: accent || A_TOKENS.text, lineHeight: 1.1,
        letterSpacing: -0.3,
      }}>{value}</div>
      {sub && <div style={{
        fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3, marginTop: 4,
      }}>{sub}</div>}
    </div>
  );
}

// Export to window for the main app
Object.assign(window, {
  A_TOKENS, ATag, AStatusDot, ATierChip, ARiskBar, APlatformIcon, AIcon, ABtn, APanel, AStat, AModelStack,
});

// ─── AModelStack ────────────────────────────────────────
// Renders priority-ordered models. First is primary, rest are fallbacks.
// Hover any chip to see vendor / cost-class hint via title.
function AModelStack({ models, models_full }) {
  const list = models || [];
  if (!list.length) return null;
  const catalog = (window.MOCK_DATA && window.MOCK_DATA.MODELS) || [];
  const meta = (id) => catalog.find((m) => m.id === id) || { id, label: id, accessTier: 'open', costClass: '?' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span>models:</span>
      {list.map((id, i) => {
        const m = meta(id);
        const isAdmin = m.accessTier === 'admin';
        return (
          <span key={id} title={`${m.label || m.id} · ${m.costClass}${isAdmin ? ' · admin-only' : ''}${i === 0 ? ' · primary' : ' · fallback'}`}
            style={{
              padding: '1px 5px', border: `1px solid ${A_TOKENS.border}`, borderRadius: 2,
              fontSize: 9, color: i === 0 ? A_TOKENS.text : A_TOKENS.text3,
              background: i === 0 ? A_TOKENS.surface2 : 'transparent',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
            {isAdmin && <span style={{ color: A_TOKENS.warn, fontSize: 8 }}>◆</span>}
            {id}
            {i < list.length - 1 && <span style={{ color: A_TOKENS.text3, marginLeft: 2 }}>›</span>}
          </span>
        );
      })}
    </span>
  );
}

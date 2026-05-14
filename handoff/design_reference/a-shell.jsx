/* Direction A · Operator Console — main screens */

const { useState: aUseState, useMemo: aUseMemo } = React;

// ─── Sidebar ───────────────────────────────────────────
function ASidebar({ route, setRoute, density }) {
  const items = [
    { id: 'dashboard',   label: 'Dashboard',   icon: 'grid' },
    { id: 'harnesses',   label: 'Harnesses',   icon: 'activity', count: 8 },
    { id: 'surfaces',    label: 'Surfaces',    icon: 'link' },
    { id: 'tools',       label: 'Tools',       icon: 'bolt' },
    { id: 'keys',        label: 'Keys',        icon: 'key', warn: true },
    { id: 'memory',      label: 'Memory',      icon: 'brain' },
    { id: 'permissions', label: 'Permissions', icon: 'shield' },
    { id: 'audit',       label: 'Audit',       icon: 'book' },
  ];
  const baseRoute = route.split('/')[0];
  const compact = density === 'compact';
  return (
    <div style={{
      width: compact ? 200 : 220,
      flexShrink: 0,
      borderRight: `1px solid ${A_TOKENS.border}`,
      background: A_TOKENS.bg,
      display: 'flex', flexDirection: 'column',
      padding: '14px 10px',
      gap: 14,
    }}>
      <div style={{ padding: '6px 8px 14px', borderBottom: `1px solid ${A_TOKENS.border}` }}>
        <div style={{
          fontFamily: A_TOKENS.mono, fontSize: 11, letterSpacing: 2,
          color: A_TOKENS.accent, fontWeight: 500,
        }}>SWARM-MAP</div>
        <div style={{
          fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.5,
          color: A_TOKENS.text3, marginTop: 3,
        }}>OPERATOR · v0.4-slim</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {items.map((it) => {
          const active = baseRoute === it.id;
          return (
            <button key={it.id} onClick={() => setRoute(it.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: compact ? '6px 8px' : '7px 10px',
                background: active ? A_TOKENS.surface2 : 'transparent',
                color: active ? A_TOKENS.text : A_TOKENS.text2,
                border: 'none',
                borderLeft: `2px solid ${active ? A_TOKENS.accent : 'transparent'}`,
                fontFamily: A_TOKENS.sans, fontSize: 12,
                letterSpacing: 0.2,
                cursor: 'pointer',
                borderRadius: '0 3px 3px 0',
                textAlign: 'left',
              }}>
              <AIcon name={it.icon} size={13} color={active ? A_TOKENS.accent : A_TOKENS.text2}/>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.count != null && (
                <span style={{
                  fontFamily: A_TOKENS.mono, fontSize: 9, color: A_TOKENS.text3,
                }}>{it.count}</span>
              )}
              {it.warn && <span style={{
                width: 5, height: 5, borderRadius: '50%', background: A_TOKENS.warn,
              }}/>}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{ borderTop: `1px solid ${A_TOKENS.border}`, paddingTop: 10 }}>
        <button onClick={() => setRoute('settings')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', background: 'transparent',
            color: baseRoute === 'settings' ? A_TOKENS.text : A_TOKENS.text2,
            border: 'none', cursor: 'pointer',
            fontFamily: A_TOKENS.sans, fontSize: 12, textAlign: 'left',
          }}>
          <AIcon name="settings" size={12} color={A_TOKENS.text3}/>
          Settings
        </button>
        <div style={{
          padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: A_TOKENS.mono, fontSize: 9, color: A_TOKENS.text3,
        }}>
          <AStatusDot status="running"/>
          <span>hermes · localhost:8400</span>
        </div>
      </div>
    </div>
  );
}

// ─── Top bar ─────────────────────────────────────────
function ATopBar({ route, setRoute, breadcrumb, theme, setTheme, viewToggle }) {
  const segs = breadcrumb || route.split('/');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 18px',
      background: A_TOKENS.bg,
      borderBottom: `1px solid ${A_TOKENS.border}`,
      fontFamily: A_TOKENS.mono, fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: A_TOKENS.text3 }}>
        <span style={{ color: A_TOKENS.accent }}>$</span>
        {segs.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: A_TOKENS.text3 }}>/</span>}
            <button onClick={() => i === 0 && setRoute(s)} style={{
              background: 'none', border: 'none', cursor: i === 0 ? 'pointer' : 'default',
              padding: 0,
              color: i === segs.length - 1 ? A_TOKENS.text : A_TOKENS.text2,
              fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 0.3,
            }}>{s}</button>
          </React.Fragment>
        ))}
      </div>

      <div style={{ flex: 1 }}/>
      {viewToggle}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 9px', borderRadius: 3,
        border: `1px solid ${A_TOKENS.border}`, background: A_TOKENS.surface,
        color: A_TOKENS.text3, fontSize: 10,
      }}>
        <AIcon name="search" size={11} color={A_TOKENS.text3}/>
        <span style={{ width: 140 }}>search harnesses, tools, keys</span>
        <span style={{
          padding: '1px 4px', borderRadius: 2, background: A_TOKENS.surface2,
          color: A_TOKENS.text3, fontSize: 9,
        }}>⌘K</span>
      </div>

      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={`Theme: ${theme}`}
        style={{
          background: 'transparent', border: `1px solid ${A_TOKENS.border}`,
          color: A_TOKENS.text2, padding: '5px 8px', borderRadius: 3,
          cursor: 'pointer', fontFamily: A_TOKENS.mono, fontSize: 10,
        }}>{theme === 'dark' ? '☾' : '☼'}</button>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────
function ADashboard({ data, setRoute }) {
  const running = data.HARNESSES.filter((h) => h.status === 'running').length;
  const errors = data.HARNESSES.filter((h) => h.status === 'error').length;
  const totalCost = data.HARNESSES.reduce((s, h) => s + (h.costToday || 0), 0);
  const totalCalls = data.HARNESSES.reduce((s, h) => s + (h.invocations || 0), 0);
  const expiredKey = data.KEYS.find((k) => k.health === 'expired');

  // Tier distribution
  const byTier = data.TIERS.map((t) => ({
    ...t,
    count: data.HARNESSES.filter((h) => h.tier === t.id).length,
    cost: data.HARNESSES.filter((h) => h.tier === t.id).reduce((s, h) => s + (h.costToday || 0), 0),
  }));

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(12, 1fr)',
      gridAutoRows: 'auto',
      gap: 12,
      padding: 18,
    }}>
      {/* Row 1: stats */}
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="HARNESSES · LIVE" value={`${running}/${data.HARNESSES.length}`}
          sub={errors > 0 ? <span style={{ color: A_TOKENS.bad }}>{errors} in error</span> : 'all healthy'} accent={A_TOKENS.good}/>
      </APanel>
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="SPEND · TODAY" value={`$${totalCost.toFixed(2)}`} sub="across 5 keys" accent={A_TOKENS.accent}/>
      </APanel>
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="INVOCATIONS · 24H" value={totalCalls.toLocaleString()} sub="↑ 18% vs yesterday"/>
      </APanel>
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="ALERTS" value={expiredKey ? '1' : '0'} sub={expiredKey ? expiredKey.label : 'none'} accent={expiredKey ? A_TOKENS.warn : A_TOKENS.good}/>
      </APanel>

      {/* Row 2: harness fleet */}
      <APanel title="harness fleet" style={{ gridColumn: 'span 8' }} padding={false}
        right={<ABtn size="sm" icon="plus">new harness</ABtn>}>
        <div style={{ overflow: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text,
          }}>
            <thead>
              <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
                {['', 'name', 'tier', 'surface', 'model', 'spend', 'calls', 'last', ''].map((h, i) => (
                  <th key={i} style={{
                    textAlign: 'left', padding: '7px 10px', fontSize: 9,
                    letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 500,
                    borderBottom: `1px solid ${A_TOKENS.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.HARNESSES.map((h) => {
                const last = Math.round((data.now - h.lastSeen) / 60000);
                return (
                  <tr key={h.id}
                    onClick={() => setRoute('harnesses/' + h.id)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: `1px solid ${A_TOKENS.border}`,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = A_TOKENS.surface2}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '8px 10px', width: 20 }}>
                      <AStatusDot status={h.status}/>
                    </td>
                    <td style={{ padding: '8px 10px', color: A_TOKENS.text }}>
                      <span style={{ color: A_TOKENS.accent }}>~/</span>{h.name}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <ATierChip tier={h.tier} tiers={data.TIERS} compact/>
                    </td>
                    <td style={{ padding: '8px 10px', color: A_TOKENS.text2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <APlatformIcon kind={h.platform} size={11}/>
                        {h.channel}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: A_TOKENS.text3, fontSize: 10 }}>{h.model}</td>
                    <td style={{ padding: '8px 10px', color: h.costToday > 1 ? A_TOKENS.warn : A_TOKENS.text2 }}>
                      ${h.costToday.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 10px', color: A_TOKENS.text2 }}>{h.invocations}</td>
                    <td style={{ padding: '8px 10px', color: A_TOKENS.text3, fontSize: 10 }}>
                      {last < 1 ? 'now' : last < 60 ? `${last}m` : `${Math.round(last/60)}h`}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <AIcon name="chev" size={11} color={A_TOKENS.text3}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </APanel>

      {/* Row 2: tier distribution */}
      <APanel title="habitat distribution" style={{ gridColumn: 'span 4' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {byTier.map((t) => (
            <div key={t.id}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                fontFamily: A_TOKENS.mono, fontSize: 10, marginBottom: 4,
              }}>
                <span style={{ color: t.color }}>T{t.rank} · {t.label}</span>
                <span style={{ color: A_TOKENS.text3 }}>{t.count} · ${t.cost.toFixed(2)}</span>
              </div>
              <div style={{
                height: 4, background: A_TOKENS.surface2, borderRadius: 1, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${(t.count / data.HARNESSES.length) * 100}%`,
                  background: t.color, opacity: 0.8,
                }}/>
              </div>
              <div style={{
                fontFamily: A_TOKENS.sans, fontSize: 10, color: A_TOKENS.text3,
                marginTop: 4, lineHeight: 1.4,
              }}>{t.desc}</div>
            </div>
          ))}
        </div>
      </APanel>

      {/* Row 3: live tail */}
      <APanel title="event tail · live" style={{ gridColumn: 'span 8' }} padding={false}
        right={<div style={{ display: 'flex', gap: 4, alignItems: 'center', color: A_TOKENS.text3, fontFamily: A_TOKENS.mono, fontSize: 9 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: A_TOKENS.good, animation: 'aPulse 2s infinite' }}/>
          STREAMING
        </div>}>
        <div style={{ fontFamily: A_TOKENS.mono, fontSize: 11, lineHeight: 1.7 }}>
          {data.RECENT_LOGS.map((log, i) => {
            const t = new Date(log.ts);
            const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
            const lvlColor = log.level === 'error' ? A_TOKENS.bad : log.level === 'warn' ? A_TOKENS.warn : A_TOKENS.text3;
            return (
              <div key={i} style={{ display: 'flex', gap: 10, color: A_TOKENS.text2 }}>
                <span style={{ color: A_TOKENS.text3 }}>{ts}</span>
                <span style={{ color: lvlColor, width: 38 }}>{log.level.toUpperCase()}</span>
                <span style={{ color: A_TOKENS.accent, width: 90 }}>{log.harness}</span>
                <span style={{ flex: 1 }}>{log.msg}</span>
              </div>
            );
          })}
        </div>
      </APanel>

      {/* Row 3: surfaces */}
      <APanel title="surfaces" style={{ gridColumn: 'span 4' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.INTEGRATIONS.map((it) => {
            const st = it.status;
            const stColor = st === 'connected' ? A_TOKENS.good : st === 'available' ? A_TOKENS.text3 : A_TOKENS.text3;
            return (
              <div key={it.id} style={{
                padding: 10, border: `1px solid ${A_TOKENS.border}`, borderRadius: 3,
                background: A_TOKENS.surface2,
                opacity: st === 'connected' ? 1 : 0.55,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <APlatformIcon kind={it.kind} size={14}/>
                  <span style={{ fontFamily: A_TOKENS.sans, fontSize: 12, color: A_TOKENS.text }}>{it.label}</span>
                  <span style={{ flex: 1 }}/>
                  <span style={{
                    fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 0.8,
                    textTransform: 'uppercase', color: stColor,
                  }}>{st}</span>
                </div>
                <div style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3 }}>
                  {it.serverInfo}
                </div>
                {it.harnessIds.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {it.harnessIds.slice(0, 4).map((hid) => {
                      const h = data.HARNESSES.find((x) => x.id === hid);
                      return h && <ATag key={hid}>{h.name}</ATag>;
                    })}
                    {it.harnessIds.length > 4 && <ATag>+{it.harnessIds.length - 4}</ATag>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </APanel>
    </div>
  );
}

Object.assign(window, { ASidebar, ATopBar, ADashboard });

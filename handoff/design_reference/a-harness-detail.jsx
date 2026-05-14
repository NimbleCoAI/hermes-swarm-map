/* Direction A · Harness Detail
   This is the working surface. Logs/config/tools/keys/memory/surfaces/security tabs.
   Header has the smart restart split-button + cache state. */

const { useState: aDetailState, useMemo: aDetailMemo } = React;

function AHarnessDetail({ data, harnessId, setRoute }) {
  const h = data.HARNESSES.find((x) => x.id === harnessId);
  const [tab, setTab] = aDetailState('overview');
  const [cacheState, setCacheState] = aDetailState('warm');
  // 'warm' | 'rebuild-needed' | 'rebuilding'
  const [restartOpen, setRestartOpen] = aDetailState(false);

  if (!h) return <div style={{ padding: 30, color: A_TOKENS.text2 }}>Harness not found</div>;

  const surface = data.INTEGRATIONS.find((it) => it.kind === h.platform);
  const keysForH = data.KEYS.filter((k) => k.assignedTo.includes(h.id));
  const toolsForH = data.TOOLS.filter((t) => h.tools.some((tn) => t.name.startsWith(tn) || t.category === tn));
  const memoryForH = data.MEMORY_SCOPES.filter((m) => m.tier === h.tier);

  const tabs = [
    { id: 'overview', label: 'overview' },
    { id: 'logs',     label: 'logs',     count: data.RECENT_LOGS.filter((l) => l.harness === h.name).length },
    { id: 'tools',    label: 'tools',    count: toolsForH.length },
    { id: 'surfaces', label: 'surfaces', count: 1 },
    { id: 'keys',     label: 'keys',     count: keysForH.length },
    { id: 'memory',   label: 'memory',   count: memoryForH.length },
    { id: 'security', label: 'security' },
    { id: 'env',      label: 'env' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${A_TOKENS.border}`,
        background: A_TOKENS.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={() => setRoute('harnesses')}
            style={{
              background: 'transparent', border: 'none', color: A_TOKENS.text3,
              cursor: 'pointer', padding: 4, display: 'flex',
            }}>
            <AIcon name="chev" size={14} color={A_TOKENS.text3} style={{ transform: 'rotate(180deg)' }}/>
          </button>
          <AStatusDot status={h.status}/>
          <h1 style={{
            margin: 0, fontFamily: A_TOKENS.mono, fontSize: 22, letterSpacing: -0.5,
            color: A_TOKENS.text, fontWeight: 500,
          }}>
            <span style={{ color: A_TOKENS.accent }}>~/</span>{h.name}
          </h1>
          <ATag mono color={A_TOKENS.text2}>{h.runtime}</ATag>
          <ATierChip tier={h.tier} tiers={data.TIERS}/>
          <span style={{
            fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <APlatformIcon kind={h.platform} size={12}/>
            {h.channel}
          </span>

          <div style={{ flex: 1 }}/>

          {/* Cache state pill */}
          <ACacheStatePill state={cacheState} setState={setCacheState}/>

          {/* Restart split-button */}
          <ARestartButton cacheState={cacheState} onRestart={(mode) => {
            setCacheState('rebuilding');
            setTimeout(() => setCacheState('warm'), mode === 'rebuild' ? 1800 : 600);
          }}/>

          {h.status === 'running' ? (
            <ABtn icon="stop" kind="default">stop</ABtn>
          ) : (
            <ABtn icon="play" kind="primary">start</ABtn>
          )}
        </div>

        <div style={{
          display: 'flex', gap: 18,
          fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3,
        }}>
          <span>persona: <span style={{ color: A_TOKENS.text2 }}>{h.persona}</span></span>
          <span>·</span>
          <AModelStack models={h.models || [h.model]}/>
          <span>·</span>
          <span>cpu: <span style={{ color: A_TOKENS.text2 }}>{h.cpu}%</span></span>
          <span>mem: <span style={{ color: A_TOKENS.text2 }}>{h.mem}MB</span></span>
        </div>

        {/* Inline alert */}
        {h.errorMsg && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: `${A_TOKENS.bad}12`, border: `1px solid ${A_TOKENS.bad}40`,
            borderRadius: 3,
            fontFamily: A_TOKENS.mono, fontSize: 10,
            color: A_TOKENS.bad, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>⚠</span>
            <span>{h.errorMsg}</span>
            <span style={{ flex: 1 }}/>
            <button style={{
              background: 'transparent', border: `1px solid ${A_TOKENS.bad}40`,
              color: A_TOKENS.bad, padding: '3px 8px', borderRadius: 2,
              fontFamily: 'inherit', fontSize: 9, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>open keys</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0,
        padding: '0 18px',
        borderBottom: `1px solid ${A_TOKENS.border}`,
        background: A_TOKENS.bg,
      }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                background: 'transparent', border: 'none',
                padding: '10px 14px',
                fontFamily: A_TOKENS.mono, fontSize: 11,
                color: active ? A_TOKENS.accent : A_TOKENS.text2,
                borderBottom: `2px solid ${active ? A_TOKENS.accent : 'transparent'}`,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                letterSpacing: 0.3,
              }}>
              {t.label}
              {t.count != null && (
                <span style={{
                  fontFamily: A_TOKENS.mono, fontSize: 9,
                  padding: '0 5px', borderRadius: 2,
                  background: A_TOKENS.surface2, color: A_TOKENS.text3,
                }}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {tab === 'overview' && <AOverviewTab h={h} data={data}
          keys={keysForH} tools={toolsForH} memory={memoryForH} surface={surface}/>}
        {tab === 'logs'     && <ALogsTab h={h} data={data}/>}
        {tab === 'tools'    && <AToolsTab h={h} data={data} tools={toolsForH}/>}
        {tab === 'surfaces' && <ASurfacesTab h={h} surface={surface} tiers={data.TIERS}/>}
        {tab === 'keys'     && <AKeysTab keys={keysForH}/>}
        {tab === 'memory'   && <AMemoryTab memory={memoryForH} h={h}/>}
        {tab === 'security' && <ASecurityTab h={h} data={data}/>}
        {tab === 'env'      && <AEnvTab h={h}/>}
      </div>
    </div>
  );
}

// ─── Cache state pill + restart split-button ─────────
function ACacheStatePill({ state }) {
  const cfg = {
    warm:             { dot: A_TOKENS.good, text: A_TOKENS.text2, label: 'warm cache · 4m old' },
    'rebuild-needed': { dot: A_TOKENS.warn, text: A_TOKENS.warn,  label: 'rebuild needed · Dockerfile changed 2m ago' },
    rebuilding:      { dot: A_TOKENS.info, text: A_TOKENS.info,  label: 'rebuilding…' },
  };
  const c = cfg[state] || cfg.warm;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '4px 9px', borderRadius: 3,
      border: `1px solid ${A_TOKENS.border}`, background: A_TOKENS.surface,
      fontFamily: A_TOKENS.mono, fontSize: 10, color: c.text,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: c.dot,
        animation: state === 'rebuilding' ? 'aPulse 1.2s infinite' : undefined,
      }}/>
      {c.label}
    </div>
  );
}

function ARestartButton({ cacheState, onRestart }) {
  const [open, setOpen] = aDetailState(false);
  const isRebuilding = cacheState === 'rebuilding';
  const needsRebuild = cacheState === 'rebuild-needed';
  // Smart pick: rebuild if needed, else quick
  const smartMode = needsRebuild ? 'rebuild' : 'quick';
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => onRestart(smartMode)} disabled={isRebuilding}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 11px',
          background: needsRebuild ? `${A_TOKENS.warn}20` : A_TOKENS.surface2,
          border: `1px solid ${needsRebuild ? A_TOKENS.warn : A_TOKENS.border2}`,
          borderRight: 'none',
          borderRadius: '3px 0 0 3px',
          color: needsRebuild ? A_TOKENS.warn : A_TOKENS.text,
          fontFamily: A_TOKENS.mono, fontSize: 11, letterSpacing: 0.3,
          textTransform: 'uppercase', cursor: 'pointer',
          opacity: isRebuilding ? 0.5 : 1,
        }}>
        <AIcon name="refresh" size={12}/>
        {isRebuilding ? 'rebuilding' : (needsRebuild ? 'rebuild & restart' : 'restart')}
      </button>
      <button onClick={() => setOpen(!open)} disabled={isRebuilding}
        style={{
          padding: '6px 7px',
          background: needsRebuild ? `${A_TOKENS.warn}20` : A_TOKENS.surface2,
          border: `1px solid ${needsRebuild ? A_TOKENS.warn : A_TOKENS.border2}`,
          borderRadius: '0 3px 3px 0',
          color: needsRebuild ? A_TOKENS.warn : A_TOKENS.text2,
          cursor: 'pointer', display: 'flex', alignItems: 'center',
        }}>
        <AIcon name="chevDown" size={11}/>
      </button>
      {open && (
        <div onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4,
            background: A_TOKENS.surface, border: `1px solid ${A_TOKENS.border2}`,
            borderRadius: 3, padding: 4,
            minWidth: 240, zIndex: 10,
            boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
          }}>
          {[
            { id: 'quick', title: 'Quick restart', desc: 'Reload config · env · tools · prompt. ~600ms.' },
            { id: 'rebuild', title: 'Full rebuild', desc: 'docker build + restart. 10-60s.' },
            { id: 'purge', title: 'Purge cache & rebuild', desc: 'Drops layer cache. Slow but bulletproof.', danger: true },
          ].map((opt) => (
            <button key={opt.id}
              onClick={() => { setOpen(false); onRestart(opt.id); }}
              style={{
                width: '100%', textAlign: 'left',
                padding: '8px 10px', borderRadius: 3,
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'block',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = A_TOKENS.surface2}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <div style={{
                fontFamily: A_TOKENS.mono, fontSize: 11,
                color: opt.danger ? A_TOKENS.bad : A_TOKENS.text,
                marginBottom: 2, letterSpacing: 0.3, textTransform: 'uppercase',
              }}>{opt.title}</div>
              <div style={{
                fontFamily: A_TOKENS.sans, fontSize: 10, color: A_TOKENS.text3,
              }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: overview ─────────────────────────────────────
function AOverviewTab({ h, data, keys, tools, memory, surface }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 12 }}>
      {/* Stats */}
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="STATUS" value={h.status} accent={h.status === 'running' ? A_TOKENS.good : h.status === 'error' ? A_TOKENS.bad : A_TOKENS.text2}/>
      </APanel>
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="SPEND · TODAY" value={`$${h.costToday.toFixed(2)}`} sub={`of $5.00 cap`} accent={A_TOKENS.accent}/>
      </APanel>
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="INVOCATIONS" value={h.invocations} sub="last 24h"/>
      </APanel>
      <APanel style={{ gridColumn: 'span 3' }}>
        <AStat label="ERRORS" value={h.errors} sub={h.errors > 0 ? '⚠ check logs' : 'clean'} accent={h.errors > 0 ? A_TOKENS.bad : A_TOKENS.good}/>
      </APanel>

      {/* Bindings overview */}
      <APanel title="bindings" style={{ gridColumn: 'span 8' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <ABindingGroup label="tools" count={tools.length}>
            {tools.slice(0, 6).map((t) => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0',
                borderBottom: `1px solid ${A_TOKENS.border}`,
              }}>
                <ARiskBar level={t.risk}/>
                <span style={{ fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text }}>
                  {t.name}
                </span>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: A_TOKENS.mono, fontSize: 9, color: A_TOKENS.text3 }}>
                  {t.category}
                </span>
              </div>
            ))}
          </ABindingGroup>
          <ABindingGroup label="keys" count={keys.length}>
            {keys.map((k) => (
              <div key={k.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0',
                borderBottom: `1px solid ${A_TOKENS.border}`,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: k.health === 'expired' ? A_TOKENS.bad : k.health === 'ok' ? A_TOKENS.good : A_TOKENS.text3,
                }}/>
                <span style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text }}>
                  {k.label}
                </span>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: A_TOKENS.mono, fontSize: 9, color: A_TOKENS.text3 }}>
                  {k.masked}
                </span>
              </div>
            ))}
          </ABindingGroup>
          <ABindingGroup label="memory scopes" count={memory.length}>
            {memory.map((m) => (
              <div key={m.id} style={{ padding: '5px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text }}>{m.name}</span>
                  <ATag>{m.strategy}</ATag>
                  <span style={{ flex: 1 }}/>
                  <span style={{ fontFamily: A_TOKENS.mono, fontSize: 9, color: A_TOKENS.text3 }}>{m.size}</span>
                </div>
                <div style={{ fontFamily: A_TOKENS.sans, fontSize: 10, color: A_TOKENS.text3, marginTop: 2 }}>
                  {m.notes}
                </div>
              </div>
            ))}
          </ABindingGroup>
          <ABindingGroup label="surface" count={1}>
            {surface && (
              <div style={{ padding: '5px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <APlatformIcon kind={surface.kind} size={13}/>
                  <span style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text }}>{surface.label}</span>
                  <span style={{ flex: 1 }}/>
                  <ATag color={A_TOKENS.good}>{surface.status}</ATag>
                </div>
                <div style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3, marginTop: 4 }}>
                  on: {h.channel}
                </div>
              </div>
            )}
          </ABindingGroup>
        </div>
      </APanel>

      {/* Recent activity */}
      <APanel title="recent activity" style={{ gridColumn: 'span 4' }}>
        <div style={{ fontFamily: A_TOKENS.mono, fontSize: 11, lineHeight: 1.7 }}>
          {data.RECENT_LOGS.filter((l) => l.harness === h.name).slice(0, 5).map((log, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'baseline',
                color: log.level === 'error' ? A_TOKENS.bad : log.level === 'warn' ? A_TOKENS.warn : A_TOKENS.text2,
              }}>
                <span style={{ color: A_TOKENS.text3, fontSize: 10 }}>
                  {new Date(log.ts).toLocaleTimeString().slice(0, 8)}
                </span>
                <ATag color={log.level === 'error' ? A_TOKENS.bad : A_TOKENS.text3}>{log.level}</ATag>
              </div>
              <div style={{ color: A_TOKENS.text2, fontSize: 10, marginTop: 2, paddingLeft: 4 }}>
                {log.msg}
              </div>
            </div>
          ))}
          {data.RECENT_LOGS.filter((l) => l.harness === h.name).length === 0 && (
            <div style={{ color: A_TOKENS.text3, fontSize: 10 }}>No recent activity.</div>
          )}
        </div>
      </APanel>
    </div>
  );
}

function ABindingGroup({ label, count, children }) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        marginBottom: 8, paddingBottom: 6,
        borderBottom: `1px solid ${A_TOKENS.border2}`,
      }}>
        <span style={{
          fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
          textTransform: 'uppercase', color: A_TOKENS.accent,
        }}>{label}</span>
        <span style={{ fontFamily: A_TOKENS.mono, fontSize: 9, color: A_TOKENS.text3 }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Tab: logs ─────────────────────────────────────────
function ALogsTab({ h, data }) {
  const logs = data.RECENT_LOGS.filter((l) => l.harness === h.name);
  // Add some synthetic detail
  const moreLogs = [
    ...logs,
    { ts: data.now - 800000, harness: h.name, level: 'info', msg: 'startup: tools initialized (' + h.tools.length + ')' },
    { ts: data.now - 800500, harness: h.name, level: 'info', msg: 'startup: keys loaded · scope=' + h.tier },
    { ts: data.now - 801000, harness: h.name, level: 'info', msg: 'startup: connecting to ' + h.platform + '://' + h.channel },
    { ts: data.now - 802000, harness: h.name, level: 'info', msg: 'startup: hermes runtime v0.4.2 · pid 14829' },
  ];
  return (
    <APanel title="event log" padding={false} style={{ height: 600 }}
      right={<div style={{ display: 'flex', gap: 6 }}>
        <ABtn size="sm" kind="ghost">all</ABtn>
        <ABtn size="sm" kind="ghost">errors</ABtn>
        <ABtn size="sm" kind="ghost">tools</ABtn>
        <ABtn size="sm" kind="ghost" icon="copy">export</ABtn>
      </div>}>
      <div style={{
        height: '100%', overflow: 'auto',
        fontFamily: A_TOKENS.mono, fontSize: 11, lineHeight: 1.65,
        padding: 12,
      }}>
        {moreLogs.length === 0 && <div style={{ color: A_TOKENS.text3 }}>No logs.</div>}
        {moreLogs.map((log, i) => {
          const t = new Date(log.ts);
          const ts = `${t.toISOString().slice(11,19)}.${String(t.getMilliseconds()).padStart(3,'0')}`;
          const lvlColor = log.level === 'error' ? A_TOKENS.bad : log.level === 'warn' ? A_TOKENS.warn : A_TOKENS.text3;
          return (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '2px 0' }}>
              <span style={{ color: A_TOKENS.text3, flexShrink: 0 }}>{ts}</span>
              <span style={{ color: lvlColor, width: 50, flexShrink: 0 }}>{log.level.toUpperCase()}</span>
              <span style={{ color: A_TOKENS.text2 }}>{log.msg}</span>
            </div>
          );
        })}
      </div>
    </APanel>
  );
}

// ─── Tab: tools ────────────────────────────────────────
function AToolsTab({ h, data, tools }) {
  // Show ALL tools, with which are bound
  const myToolNames = new Set(h.tools);
  return (
    <APanel title="tool bindings" padding={false}
      right={<ABtn size="sm" icon="plus">attach tool</ABtn>}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontFamily: A_TOKENS.mono, fontSize: 11,
      }}>
        <thead>
          <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
            {['', 'tool', 'category', 'risk', 'tier ceiling', 'status', ''].map((h, i) => (
              <th key={i} style={{
                textAlign: 'left', padding: '8px 12px', fontSize: 9,
                letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 500,
                borderBottom: `1px solid ${A_TOKENS.border}`,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.TOOLS.map((t) => {
            const bound = myToolNames.has(t.name) || myToolNames.has(t.category);
            const allowed = t.allowedTiers.includes(h.tier);
            return (
              <tr key={t.id} style={{
                borderBottom: `1px solid ${A_TOKENS.border}`,
                opacity: bound ? 1 : 0.45,
              }}>
                <td style={{ padding: '8px 12px', width: 30 }}>
                  <span style={{
                    width: 14, height: 14,
                    border: `1px solid ${bound ? A_TOKENS.accent : A_TOKENS.border2}`,
                    background: bound ? A_TOKENS.accent : 'transparent',
                    borderRadius: 2, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {bound && <AIcon name="check" size={10} color="#1a1a1a"/>}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>
                  <div>{t.name}</div>
                  <div style={{ fontSize: 9, color: A_TOKENS.text3, marginTop: 2 }}>{t.desc}</div>
                </td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{t.category}</td>
                <td style={{ padding: '8px 12px' }}>
                  <ARiskBar level={t.risk}/>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {data.TIERS.map((tier) => (
                      <div key={tier.id} title={tier.label}
                        style={{
                          width: 14, height: 6, borderRadius: 1,
                          background: t.allowedTiers.includes(tier.id) ? tier.color : A_TOKENS.border,
                          opacity: t.allowedTiers.includes(tier.id) ? 0.9 : 0.4,
                        }}/>
                    ))}
                  </div>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {!allowed ? (
                    <ATag color={A_TOKENS.bad}>blocked · tier</ATag>
                  ) : bound ? (
                    <ATag color={A_TOKENS.good}>active</ATag>
                  ) : (
                    <ATag>available</ATag>
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <button style={{
                    background: 'transparent', border: 'none', color: A_TOKENS.text3,
                    cursor: 'pointer', fontFamily: A_TOKENS.mono, fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{bound ? 'detach' : 'attach'}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </APanel>
  );
}

// ─── Tab: surfaces ─────────────────────────────────────
function ASurfacesTab({ h, surface, tiers }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
      <APanel title="active surface">
        {surface && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <APlatformIcon kind={surface.kind} size={20}/>
              <span style={{ fontFamily: A_TOKENS.sans, fontSize: 14, color: A_TOKENS.text, fontWeight: 500 }}>
                {surface.label}
              </span>
              <ATag color={A_TOKENS.good}>{surface.status}</ATag>
              <span style={{ flex: 1 }}/>
              <span style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3 }}>{surface.serverInfo}</span>
            </div>

            <div style={{
              padding: 12, background: A_TOKENS.surface2, borderRadius: 3,
              border: `1px solid ${A_TOKENS.border}`, marginBottom: 12,
            }}>
              <div style={{
                fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
                textTransform: 'uppercase', color: A_TOKENS.text3, marginBottom: 8,
              }}>HABITAT TIER · CLAMPS CAPABILITY</div>
              <ATierChip tier={h.tier} tiers={tiers}/>
              <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2, marginTop: 8, lineHeight: 1.5 }}>
                Where this harness lives on this surface. Tier sets the ceiling on what tools and memory it may use here, regardless of what it has bound.
              </div>
            </div>

            <div>
              <div style={{
                fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
                textTransform: 'uppercase', color: A_TOKENS.text3, marginBottom: 8,
              }}>SCOPING RULES</div>
              {surface.kind === 'mattermost' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <span>direct messages</span>
                    <ATag color={surface.dmsBlocked ? A_TOKENS.bad : A_TOKENS.good}>
                      {surface.dmsBlocked ? 'blocked' : 'open'}
                    </ATag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <span>channel allowlist</span>
                    <span style={{ color: A_TOKENS.text }}>{surface.allowList} channels</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <span>active channel</span>
                    <span style={{ color: A_TOKENS.accent }}>{h.channel}</span>
                  </div>
                </div>
              )}
              {surface.kind === 'telegram' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <span>direct messages</span>
                    <ATag>{surface.dmsAllowed}</ATag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <span>group adds</span>
                    <ATag>{surface.groupAdds}</ATag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <span>handle</span>
                    <span style={{ color: A_TOKENS.accent }}>{h.channel}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </APanel>

      <APanel title="add another surface" right={<ABtn size="sm" icon="plus">add</ABtn>}>
        <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2, lineHeight: 1.5, marginBottom: 12 }}>
          A harness can speak through multiple surfaces. Each surface has its own habitat tier, which clamps what tools/memory it may use there.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { kind: 'mattermost', label: 'Mattermost' },
            { kind: 'telegram', label: 'Telegram' },
            { kind: 'discord', label: 'Discord', soon: true },
            { kind: 'signal', label: 'Signal', soon: true },
          ].map((s) => (
            <button key={s.kind} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 3,
              background: A_TOKENS.surface2, border: `1px solid ${A_TOKENS.border}`,
              color: A_TOKENS.text, cursor: 'pointer',
              fontFamily: A_TOKENS.sans, fontSize: 12, textAlign: 'left',
              opacity: s.soon ? 0.5 : 1,
            }}>
              <APlatformIcon kind={s.kind} size={14}/>
              <span style={{ flex: 1 }}>{s.label}</span>
              {s.soon && <ATag>soon</ATag>}
            </button>
          ))}
        </div>
      </APanel>
    </div>
  );
}

// ─── Tab: keys ─────────────────────────────────────────
function AKeysTab({ keys }) {
  return (
    <APanel title="key bindings" padding={false} right={<ABtn size="sm" icon="plus">bind key</ABtn>}>
      {keys.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: A_TOKENS.text3, fontFamily: A_TOKENS.mono, fontSize: 11 }}>
          No keys bound to this harness.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
          <thead>
            <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
              {['provider', 'label', 'value', 'status', 'spend', ''].map((h, i) => (
                <th key={i} style={{
                  textAlign: 'left', padding: '8px 12px', fontSize: 9,
                  letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 500,
                  borderBottom: `1px solid ${A_TOKENS.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: `1px solid ${A_TOKENS.border}` }}>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{k.provider}</td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>{k.label}</td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{k.masked}</td>
                <td style={{ padding: '8px 12px' }}>
                  <ATag color={k.health === 'expired' ? A_TOKENS.bad : k.health === 'ok' ? A_TOKENS.good : A_TOKENS.text3}>
                    {k.health}{k.healthMsg ? ' · ' + k.healthMsg : ''}
                  </ATag>
                </td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>
                  {k.budgetUsd ? `$${k.spentUsd.toFixed(2)} / $${k.budgetUsd}` : '—'}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <button style={{
                    background: 'transparent', border: 'none', color: A_TOKENS.text3, cursor: 'pointer',
                    fontFamily: A_TOKENS.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>unbind</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </APanel>
  );
}

// ─── Tab: memory ───────────────────────────────────────
function AMemoryTab({ memory, h }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {memory.map((m) => (
        <APanel key={m.id} title={m.name}
          right={<ATag>{m.strategy}</ATag>}>
          <div style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3, marginBottom: 12 }}>
            <div>tier: <span style={{ color: A_TOKENS.text2 }}>{m.tier}</span></div>
            <div>members: <span style={{ color: A_TOKENS.text2 }}>{m.members}</span></div>
            <div>size: <span style={{ color: A_TOKENS.text2 }}>{m.size}</span></div>
          </div>
          <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2, lineHeight: 1.5 }}>
            {m.notes}
          </div>
        </APanel>
      ))}
      {memory.length === 0 && (
        <div style={{ color: A_TOKENS.text3, fontFamily: A_TOKENS.mono, fontSize: 11, padding: 24 }}>
          No memory scopes available at tier <span style={{ color: A_TOKENS.text2 }}>{h.tier}</span>.
        </div>
      )}
    </div>
  );
}

// ─── Tab: security ─────────────────────────────────────
function ASecurityTab({ h, data }) {
  const tier = data.TIERS.find((t) => t.id === h.tier);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
      <APanel title="capability ceiling">
        <div style={{ marginBottom: 16 }}>
          <ATierChip tier={h.tier} tiers={data.TIERS}/>
          <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2, marginTop: 10, lineHeight: 1.5 }}>
            {tier.desc}
          </div>
        </div>

        <div style={{
          fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
          textTransform: 'uppercase', color: A_TOKENS.text3,
          margin: '12px 0 6px',
        }}>ALWAYS-DANGEROUS PRIMITIVES (TIER-CLAMPED)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { name: 'web.search', risk: 5, note: 'LLMs can read content as commands.' },
            { name: 'web.fetch',  risk: 5, note: 'Same. Worse without filters.' },
            { name: 'code.exec',  risk: 4, note: 'Sandboxed. Network isolated.' },
            { name: '*.delete',   risk: 5, note: 'Confirm + audit on every call.' },
            { name: 'memory.append (unscoped)', risk: 4, note: 'Always scope-tag writes.' },
          ].map((p, i) => {
            const allowed = data.TOOLS.find((t) => t.name === p.name)?.allowedTiers.includes(h.tier);
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: A_TOKENS.surface2, borderRadius: 3,
                border: `1px solid ${A_TOKENS.border}`,
              }}>
                <ARiskBar level={p.risk}/>
                <span style={{ fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text }}>{p.name}</span>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: A_TOKENS.sans, fontSize: 10, color: A_TOKENS.text3 }}>{p.note}</span>
                <ATag color={allowed === false ? A_TOKENS.bad : A_TOKENS.text3}>
                  {allowed === false ? 'blocked' : 'gated'}
                </ATag>
              </div>
            );
          })}
        </div>
      </APanel>

      <APanel title="budget · this harness">
        <AStat label="SPEND TODAY" value={`$${h.costToday.toFixed(2)}`} sub="of $5.00 cap" accent={A_TOKENS.accent}/>
        <div style={{ height: 8, background: A_TOKENS.surface2, borderRadius: 1, marginTop: 12, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${Math.min((h.costToday / 5) * 100, 100)}%`,
            background: h.costToday / 5 > 0.8 ? A_TOKENS.warn : A_TOKENS.accent,
          }}/>
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{
            fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
            textTransform: 'uppercase', color: A_TOKENS.text3, marginBottom: 8,
          }}>WHO CAN INVOKE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.PEOPLE.filter((p) => p.tierAccess.includes(h.tier)).map((p) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: A_TOKENS.mono, fontSize: 11, color: A_TOKENS.text2,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: A_TOKENS.surface2, border: `1px solid ${A_TOKENS.border}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: A_TOKENS.text3,
                }}>{p.name[0]}</span>
                <span>{p.handle}</span>
                <span style={{ flex: 1 }}/>
                <ATag>{p.role}</ATag>
              </div>
            ))}
          </div>
        </div>
      </APanel>
    </div>
  );
}

// ─── Tab: env ──────────────────────────────────────────
function AEnvTab({ h }) {
  const env = [
    ['HARNESS_NAME', h.name],
    ['HARNESS_TIER', h.tier],
    ['MODEL', h.model],
    ['PLATFORM', h.platform],
    ['CHANNEL', h.channel],
    ['HERMES_RUNTIME_URL', 'http://hermes:8400'],
    ['ANTHROPIC_API_KEY', '••••••••••••q4F2'],
    ['GITHUB_TOKEN', '••••••••••N3'],
    ['LOG_LEVEL', 'info'],
    ['MEMORY_SCOPE', h.tier === 'individual' ? 'sanctum' : 'team-shared'],
  ];
  return (
    <APanel title="environment · readonly mirror" padding={false}
      right={<div style={{ display: 'flex', gap: 6 }}>
        <ABtn size="sm" icon="plus">add var</ABtn>
        <ABtn size="sm" icon="copy">copy as .env</ABtn>
      </div>}>
      <div style={{ fontFamily: A_TOKENS.mono, fontSize: 11, padding: 12 }}>
        {env.map(([k, v], i) => {
          const isSecret = String(v).startsWith('••');
          return (
            <div key={i} style={{
              display: 'flex', gap: 12,
              padding: '5px 0',
              borderBottom: `1px solid ${A_TOKENS.border}`,
            }}>
              <span style={{ color: A_TOKENS.accent, width: 220 }}>{k}</span>
              <span style={{ color: A_TOKENS.text3 }}>=</span>
              <span style={{ color: isSecret ? A_TOKENS.text3 : A_TOKENS.text2, flex: 1 }}>
                {isSecret ? v : `"${v}"`}
              </span>
              {isSecret && (
                <button style={{
                  background: 'transparent', border: 'none', color: A_TOKENS.text3, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 10,
                }}><AIcon name="eye" size={11} color={A_TOKENS.text3}/></button>
              )}
            </div>
          );
        })}
      </div>
    </APanel>
  );
}

Object.assign(window, { AHarnessDetail });

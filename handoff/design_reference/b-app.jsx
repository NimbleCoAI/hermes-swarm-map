/* Direction B · Harness detail + admin pages
   Editorial, calm, status-as-narrative. Same data model as A. */

const { useState: bDState } = React;

function BHarnessDetail({ data, harnessId, setRoute }) {
  const h = data.HARNESSES.find((x) => x.id === harnessId);
  const [tab, setTab] = bDState('overview');
  const [cacheState, setCacheState] = bDState('warm');
  const [restartOpen, setRestartOpen] = bDState(false);
  if (!h) return null;
  const surface = data.INTEGRATIONS.find((it) => it.kind === h.platform);
  const keysForH = data.KEYS.filter((k) => k.assignedTo.includes(h.id));
  const memoryForH = data.MEMORY_SCOPES.filter((m) => m.tier === h.tier);
  const tier = data.TIERS.find((t) => t.id === h.tier);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'logs', label: 'Activity' },
    { id: 'tools', label: 'Tools' },
    { id: 'surfaces', label: 'Surfaces' },
    { id: 'keys', label: 'Keys' },
    { id: 'memory', label: 'Memory' },
    { id: 'security', label: 'Security' },
  ];

  return <div style={{ padding: '28px 32px', minHeight: '100%' }}>
    {/* Crumb back */}
    <button onClick={() => setRoute('harnesses')} style={{
      background: 'transparent', border: 'none', cursor: 'pointer',
      fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3,
      display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 16, padding: 0,
    }}>
      <BIcon name="chev" size={12} color={B_TOKENS.text3} style={{ transform: 'rotate(180deg)' }}/> Back to harnesses
    </button>

    {/* Header */}
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 18 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <BStatusDot status={h.status}/>
          <h1 style={{
            margin: 0, fontFamily: B_TOKENS.display, fontSize: 32, fontWeight: 400,
            letterSpacing: -0.8, color: B_TOKENS.text, lineHeight: 1,
          }}>{h.name}</h1>
          <BTierBadge tier={h.tier} tiers={data.TIERS}/>
        </div>
        <p style={{
          margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14,
          color: B_TOKENS.text2, lineHeight: 1.5, maxWidth: 640,
        }}>{h.persona}</p>
        <div style={{ marginTop: 10, display: 'flex', gap: 18, fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <BPlatformIcon kind={h.platform} size={12}/>
            {h.channel}
          </span>
          <span>·</span>
          <BModelStack models={h.models || [h.model]}/>
          <span>·</span>
          <span>{h.cpu}% CPU · {h.mem}MB</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
        <BCacheStatePill state={cacheState}/>
        <BRestartButton cacheState={cacheState} onRestart={(mode) => {
          setCacheState('rebuilding');
          setTimeout(() => setCacheState('warm'), mode === 'rebuild' ? 1800 : 600);
        }}/>
        {h.status === 'running' ? <BBtn icon="stop">Stop</BBtn> : <BBtn icon="play" kind="primary">Start</BBtn>}
      </div>
    </div>

    {h.errorMsg && (
      <BCard style={{ background: `${B_TOKENS.bad}10`, borderColor: `${B_TOKENS.bad}40`, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BIcon name="warn" size={16} color={B_TOKENS.bad}/>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text, flex: 1 }}>{h.errorMsg}</span>
          <BBtn size="sm" onClick={() => setRoute('keys')}>Open keys</BBtn>
        </div>
      </BCard>
    )}

    {/* Tabs */}
    <div style={{
      display: 'flex', gap: 2, borderBottom: `1px solid ${B_TOKENS.border}`,
      marginBottom: 22,
    }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        return <button key={t.id} onClick={() => setTab(t.id)} style={{
          background: 'transparent', border: 'none',
          padding: '10px 16px',
          fontFamily: B_TOKENS.sans, fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? B_TOKENS.text : B_TOKENS.text2,
          borderBottom: `2px solid ${active ? B_TOKENS.accent : 'transparent'}`,
          marginBottom: -1, cursor: 'pointer',
        }}>{t.label}</button>;
      })}
    </div>

    {/* Tab body */}
    {tab === 'overview' && <BOverviewTab h={h} data={data} keys={keysForH} memory={memoryForH} surface={surface} tier={tier}/>}
    {tab === 'logs' && <BLogsTab h={h} data={data}/>}
    {tab === 'tools' && <BToolsTab h={h} data={data}/>}
    {tab === 'surfaces' && <BSurfacesTab h={h} surface={surface} tiers={data.TIERS}/>}
    {tab === 'keys' && <BKeysTab keys={keysForH}/>}
    {tab === 'memory' && <BMemoryTab memory={memoryForH} h={h}/>}
    {tab === 'security' && <BSecurityTab h={h} data={data} tier={tier}/>}
  </div>;
}

function BCacheStatePill({ state }) {
  const cfg = {
    warm: { dot: B_TOKENS.good, label: 'Warm cache · 4m old', text: B_TOKENS.text2 },
    'rebuild-needed': { dot: B_TOKENS.warn, label: 'Rebuild needed', text: B_TOKENS.warn },
    rebuilding: { dot: B_TOKENS.info, label: 'Rebuilding…', text: B_TOKENS.info },
  };
  const c = cfg[state];
  return <BPill color={c.text}>
    <span style={{
      width: 6, height: 6, borderRadius: '50%', background: c.dot,
      animation: state === 'rebuilding' ? 'aPulse 1.2s infinite' : undefined,
    }}/>{c.label}
  </BPill>;
}

function BRestartButton({ cacheState, onRestart }) {
  const [open, setOpen] = bDState(false);
  const isRebuilding = cacheState === 'rebuilding';
  const needsRebuild = cacheState === 'rebuild-needed';
  return <div style={{ position: 'relative', display: 'inline-flex' }}>
    <button onClick={() => onRestart(needsRebuild ? 'rebuild' : 'quick')} disabled={isRebuilding}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '8px 14px',
        background: needsRebuild ? `${B_TOKENS.warn}15` : B_TOKENS.surface,
        color: needsRebuild ? B_TOKENS.warn : B_TOKENS.text,
        border: `1px solid ${needsRebuild ? B_TOKENS.warn : B_TOKENS.border}`,
        borderRight: 'none',
        borderRadius: '8px 0 0 8px',
        fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500,
        cursor: 'pointer',
      }}>
      <BIcon name="refresh" size={14}/>
      {isRebuilding ? 'Rebuilding' : (needsRebuild ? 'Rebuild & restart' : 'Restart')}
    </button>
    <button onClick={() => setOpen(!open)} disabled={isRebuilding}
      style={{
        padding: '8px 9px',
        background: needsRebuild ? `${B_TOKENS.warn}15` : B_TOKENS.surface,
        color: needsRebuild ? B_TOKENS.warn : B_TOKENS.text2,
        border: `1px solid ${needsRebuild ? B_TOKENS.warn : B_TOKENS.border}`,
        borderRadius: '0 8px 8px 0',
        cursor: 'pointer', display: 'flex', alignItems: 'center',
      }}>
      <BIcon name="chevD" size={12}/>
    </button>
    {open && (
      <div onMouseLeave={() => setOpen(false)}
        style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: B_TOKENS.surface, border: `1px solid ${B_TOKENS.border}`,
          borderRadius: 10, padding: 6, minWidth: 280, zIndex: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
        {[
          { id: 'quick', title: 'Quick restart', desc: 'Reload config — env, tools, prompt. ~600ms.' },
          { id: 'rebuild', title: 'Full rebuild', desc: 'docker build + restart. 10-60s.' },
          { id: 'purge', title: 'Purge & rebuild', desc: 'Drops layer cache. Slow but bulletproof.', danger: true },
        ].map((opt) => (
          <button key={opt.id} onClick={() => { setOpen(false); onRestart(opt.id); }}
            style={{
              width: '100%', textAlign: 'left',
              padding: '10px 12px', borderRadius: 7,
              background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'block',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = B_TOKENS.surface2}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <div style={{
              fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500,
              color: opt.danger ? B_TOKENS.bad : B_TOKENS.text, marginBottom: 2,
            }}>{opt.title}</div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>{opt.desc}</div>
          </button>
        ))}
      </div>
    )}
  </div>;
}

function BOverviewTab({ h, data, keys, memory, surface, tier }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr', gap: 14 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <BCard>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          <BStatInline label="Today's spend" value={`$${h.costToday.toFixed(2)}`} sub="of $5.00 cap"/>
          <BStatInline label="Invocations" value={h.invocations} sub="last 24h"/>
          <BStatInline label="Errors" value={h.errors} sub={h.errors > 0 ? 'check logs' : 'clean'} accent={h.errors > 0 ? B_TOKENS.bad : B_TOKENS.text}/>
          <BStatInline label="Tools" value={h.tools.length} sub="bound"/>
        </div>
      </BCard>

      <BCard>
        <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 14 }}>
          Recent activity
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.RECENT_LOGS.filter((l) => l.harness === h.name).slice(0, 5).map((log, i) => {
            const min = Math.round((data.now - log.ts) / 60000);
            return <div key={i} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              paddingBottom: 8, borderBottom: i < 4 ? `1px dashed ${B_TOKENS.border}` : 'none',
            }}>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, width: 50, flexShrink: 0, marginTop: 1 }}>
                {min < 1 ? 'now' : `${min}m ago`}
              </span>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text, flex: 1 }}>
                {log.msg}
              </span>
              {log.level !== 'info' && <BPill color={log.level === 'error' ? B_TOKENS.bad : B_TOKENS.warn}>{log.level}</BPill>}
            </div>;
          })}
          {data.RECENT_LOGS.filter((l) => l.harness === h.name).length === 0 && (
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text3 }}>Nothing recent.</div>
          )}
        </div>
      </BCard>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <BCard>
        <BSectionLabel style={{ marginBottom: 10 }}>Habitat</BSectionLabel>
        <BTierBadge tier={h.tier} tiers={data.TIERS}/>
        <p style={{
          margin: '12px 0 0', fontFamily: B_TOKENS.sans, fontSize: 12,
          color: B_TOKENS.text2, lineHeight: 1.5,
        }}>{tier.desc} The tier sets the ceiling on what tools and memory this harness may use here.</p>
      </BCard>

      <BCard>
        <BSectionLabel style={{ marginBottom: 10 }}>Surface</BSectionLabel>
        {surface && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <BPlatformIcon kind={surface.kind} size={14}/>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>
                {surface.label}
              </span>
            </div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3 }}>
              on <span style={{ color: B_TOKENS.text2 }}>{h.channel}</span>
            </div>
          </div>
        )}
      </BCard>

      <BCard>
        <BSectionLabel style={{ marginBottom: 10 }}>Bound keys</BSectionLabel>
        {keys.length === 0 ? <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3 }}>None</div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {keys.map((k) => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: k.health === 'expired' ? B_TOKENS.bad : k.health === 'ok' ? B_TOKENS.good : B_TOKENS.text3,
                }}/>
                <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text }}>{k.label}</span>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>{k.masked}</span>
              </div>
            ))}
          </div>
        }
      </BCard>

      <BCard>
        <BSectionLabel style={{ marginBottom: 10 }}>Memory scopes</BSectionLabel>
        {memory.length === 0 ? <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3 }}>None at this tier</div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {memory.map((m) => (
              <div key={m.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{m.name}</span>
                  <BPill style={{ fontSize: 10 }}>{m.strategy}</BPill>
                </div>
                <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, lineHeight: 1.4 }}>
                  {m.notes}
                </div>
              </div>
            ))}
          </div>
        }
      </BCard>
    </div>
  </div>;
}

function BStatInline({ label, value, sub, accent }) {
  return <div>
    <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: B_TOKENS.text3 }}>{label}</div>
    <div style={{
      fontFamily: B_TOKENS.display, fontSize: 24, fontWeight: 400,
      color: accent || B_TOKENS.text, marginTop: 4, letterSpacing: -0.5, lineHeight: 1.1,
    }}>{value}</div>
    {sub && <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 4 }}>{sub}</div>}
  </div>;
}

function BLogsTab({ h, data }) {
  const logs = data.RECENT_LOGS.filter((l) => l.harness === h.name);
  return <BCard padded={false}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${B_TOKENS.border}` }}>
      <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text }}>Activity log</h3>
      <div style={{ display: 'flex', gap: 6 }}>
        <BBtn size="sm" kind="ghost">All</BBtn>
        <BBtn size="sm" kind="ghost">Errors</BBtn>
        <BBtn size="sm" kind="ghost">Tools</BBtn>
      </div>
    </div>
    <div style={{ padding: 18, fontFamily: B_TOKENS.sans, fontSize: 13, lineHeight: 1.7 }}>
      {logs.length === 0 ? <div style={{ color: B_TOKENS.text3 }}>Nothing recent.</div> :
        logs.map((log, i) => {
          const min = Math.round((data.now - log.ts) / 60000);
          return <div key={i} style={{
            display: 'flex', gap: 14, padding: '6px 0',
            borderBottom: i < logs.length - 1 ? `1px dashed ${B_TOKENS.border}` : 'none',
          }}>
            <span style={{ color: B_TOKENS.text3, width: 60, flexShrink: 0 }}>{min < 1 ? 'now' : `${min}m ago`}</span>
            {log.level !== 'info' && <BPill color={log.level === 'error' ? B_TOKENS.bad : B_TOKENS.warn}>{log.level}</BPill>}
            <span style={{ color: B_TOKENS.text }}>{log.msg}</span>
          </div>;
        })}
    </div>
  </BCard>;
}

function BToolsTab({ h, data }) {
  const myTools = new Set(h.tools);
  return <BCard padded={false}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${B_TOKENS.border}` }}>
      <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text }}>Tool bindings</h3>
      <BBtn size="sm" icon="plus">Attach tool</BBtn>
    </div>
    <div>
      {data.TOOLS.map((t, i) => {
        const bound = myTools.has(t.name) || myTools.has(t.category);
        const allowed = t.allowedTiers.includes(h.tier);
        return <div key={t.id} style={{
          display: 'grid', gridTemplateColumns: '24px 1fr auto auto auto', gap: 14, alignItems: 'center',
          padding: '12px 18px',
          borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
          opacity: bound ? 1 : 0.55,
        }}>
          <span style={{
            width: 18, height: 18,
            border: `1.5px solid ${bound ? B_TOKENS.accent : B_TOKENS.border2}`,
            background: bound ? B_TOKENS.accent : 'transparent',
            borderRadius: 4, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
          }}>{bound && <BIcon name="check" size={12} color="#fff"/>}</span>
          <div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{t.name}</div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 2 }}>{t.desc}</div>
          </div>
          <BPill>Risk {t.risk}</BPill>
          <div style={{ display: 'flex', gap: 3 }}>
            {data.TIERS.map((tier) => (
              <div key={tier.id} title={tier.label}
                style={{
                  width: 14, height: 6, borderRadius: 2,
                  background: t.allowedTiers.includes(tier.id) ? tier.color : B_TOKENS.border,
                }}/>
            ))}
          </div>
          <div style={{ minWidth: 80, textAlign: 'right' }}>
            {!allowed ? <BPill color={B_TOKENS.bad}>Blocked</BPill> :
              bound ? <BPill color={B_TOKENS.good}>Active</BPill> : <BPill>Available</BPill>}
          </div>
        </div>;
      })}
    </div>
  </BCard>;
}

function BSurfacesTab({ h, surface, tiers }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
    <BCard>
      <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 14 }}>
        Active surface
      </h3>
      {surface && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <BPlatformIcon kind={surface.kind} size={20}/>
            <span style={{ fontFamily: B_TOKENS.sans, fontSize: 15, fontWeight: 500, color: B_TOKENS.text }}>{surface.label}</span>
            <BPill color={B_TOKENS.good}>{surface.status}</BPill>
          </div>
          <div style={{ padding: 14, background: B_TOKENS.surface2, borderRadius: 8, marginBottom: 14 }}>
            <BSectionLabel style={{ marginBottom: 8 }}>Habitat — clamps capability</BSectionLabel>
            <BTierBadge tier={h.tier} tiers={tiers}/>
            <p style={{ margin: '10px 0 0', fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, lineHeight: 1.5 }}>
              Same harness, different surface = different clamp. The tier here decides what the harness may do, regardless of what's bound.
            </p>
          </div>
          <BSectionLabel style={{ marginBottom: 8 }}>Scoping rules</BSectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {surface.kind === 'mattermost' ? [
              ['DMs', surface.dmsBlocked ? 'Blocked' : 'Open'],
              ['Channel allowlist', `${surface.allowList} channels`],
              ['Active channel', h.channel],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px dashed ${B_TOKENS.border}`, fontFamily: B_TOKENS.sans, fontSize: 12 }}>
                <span style={{ color: B_TOKENS.text3 }}>{k}</span>
                <span style={{ color: B_TOKENS.text }}>{v}</span>
              </div>
            )) : [
              ['DMs', surface.dmsAllowed],
              ['Group adds', surface.groupAdds],
              ['Handle', h.channel],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px dashed ${B_TOKENS.border}`, fontFamily: B_TOKENS.sans, fontSize: 12 }}>
                <span style={{ color: B_TOKENS.text3 }}>{k}</span>
                <span style={{ color: B_TOKENS.text }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </BCard>
    <BCard>
      <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 6 }}>Add another surface</h3>
      <p style={{ margin: '0 0 14px', fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, lineHeight: 1.5 }}>
        A harness can speak through multiple surfaces. Each gets its own habitat tier.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { kind: 'mattermost', label: 'Mattermost' },
          { kind: 'telegram', label: 'Telegram' },
          { kind: 'discord', label: 'Discord', soon: true },
          { kind: 'signal', label: 'Signal', soon: true },
        ].map((s) => (
          <button key={s.kind} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 7,
            background: B_TOKENS.surface2, border: `1px solid ${B_TOKENS.border}`,
            color: B_TOKENS.text, cursor: 'pointer',
            fontFamily: B_TOKENS.sans, fontSize: 12, textAlign: 'left',
            opacity: s.soon ? 0.5 : 1,
          }}>
            <BPlatformIcon kind={s.kind} size={14}/>
            <span style={{ flex: 1 }}>{s.label}</span>
            {s.soon && <BPill style={{ fontSize: 10 }}>Soon</BPill>}
          </button>
        ))}
      </div>
    </BCard>
  </div>;
}

function BKeysTab({ keys }) {
  return <BCard padded={false}>
    <div style={{ padding: '14px 18px', borderBottom: `1px solid ${B_TOKENS.border}` }}>
      <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text }}>Bound keys</h3>
    </div>
    {keys.map((k, i) => (
      <div key={k.id} style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
        borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: k.health === 'expired' ? B_TOKENS.bad : k.health === 'ok' ? B_TOKENS.good : B_TOKENS.text3,
        }}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{k.label}</div>
          <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 2 }}>{k.provider} · {k.masked}</div>
        </div>
        <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2 }}>
          {k.budgetUsd ? `$${k.spentUsd.toFixed(2)} / $${k.budgetUsd}` : '—'}
        </span>
        <BPill color={k.health === 'expired' ? B_TOKENS.bad : k.health === 'ok' ? B_TOKENS.good : B_TOKENS.text3}>
          {k.health}
        </BPill>
      </div>
    ))}
  </BCard>;
}

function BMemoryTab({ memory, h }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
    {memory.map((m) => (
      <BCard key={m.id}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text }}>{m.name}</h4>
          <BPill>{m.strategy}</BPill>
        </div>
        <p style={{ margin: '0 0 12px', fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, lineHeight: 1.5 }}>{m.notes}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>
          <span>{m.members} members</span>
          <span>{m.size}</span>
        </div>
      </BCard>
    ))}
  </div>;
}

function BSecurityTab({ h, data, tier }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
    <BCard>
      <BSectionLabel style={{ marginBottom: 12 }}>Capability ceiling</BSectionLabel>
      <BTierBadge tier={h.tier} tiers={data.TIERS}/>
      <p style={{ margin: '12px 0 18px', fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text2, lineHeight: 1.5 }}>
        {tier.desc}
      </p>
      <BSectionLabel style={{ marginBottom: 10 }}>Always-dangerous primitives</BSectionLabel>
      {[
        { name: 'web.search', risk: 5, note: 'LLMs read content as commands' },
        { name: 'web.fetch', risk: 5, note: 'Same. Worse without filters.' },
        { name: 'code.exec', risk: 4, note: 'Sandboxed. Network isolated.' },
        { name: '*.delete', risk: 5, note: 'Confirm + audit on every call.' },
      ].map((p, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 0', borderBottom: i < 3 ? `1px dashed ${B_TOKENS.border}` : 'none',
        }}>
          <BPill>R{p.risk}</BPill>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text }}>{p.name}</span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>{p.note}</span>
        </div>
      ))}
    </BCard>
    <BCard>
      <BSectionLabel style={{ marginBottom: 10 }}>Daily budget</BSectionLabel>
      <div style={{ fontFamily: B_TOKENS.display, fontSize: 28, color: B_TOKENS.text, letterSpacing: -0.5 }}>
        ${h.costToday.toFixed(2)}
      </div>
      <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, marginTop: 4 }}>of $5.00 cap</div>
      <div style={{ height: 6, background: B_TOKENS.surface2, borderRadius: 3, marginTop: 12, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min((h.costToday / 5) * 100, 100)}%`, background: B_TOKENS.accent }}/>
      </div>
      <BSectionLabel style={{ margin: '20px 0 10px' }}>Who can invoke</BSectionLabel>
      {data.PEOPLE.filter((p) => p.tierAccess.includes(h.tier)).slice(0, 4).map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%',
            background: B_TOKENS.surface2, border: `1px solid ${B_TOKENS.border}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: B_TOKENS.text2, fontWeight: 500,
          }}>{p.name[0]}</span>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text }}>{p.handle}</span>
          <span style={{ flex: 1 }}/>
          <BPill style={{ fontSize: 10 }}>{p.role}</BPill>
        </div>
      ))}
    </BCard>
  </div>;
}

// ─── Admin pages ───────────────────────────────────────
function BHarnessesPage({ data, setRoute }) {
  const runningCount = data.HARNESSES.filter((h) => h.status === 'running').length;
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Harnesses" subtitle="The whole flock. Click any to drill in. Hover a row for inline controls."
      action={<div style={{ display: 'flex', gap: 8 }}>
        <BBtn icon="refresh" title={`Restart all ${runningCount} running harnesses`}>Restart running ({runningCount})</BBtn>
        <BBtn>Import</BBtn><BBtn icon="plus" kind="primary">New harness</BBtn>
      </div>}/>
    <BCard padded={false} style={{ marginTop: 18 }}>
      {data.HARNESSES.map((h, i) => {
        const last = Math.round((data.now - h.lastSeen) / 60000);
        const isRunning = h.status === 'running' || h.status === 'idle';
        return <div key={h.id} className="b-row"
          onClick={() => setRoute('harnesses/' + h.id)}
          style={{
            display: 'grid',
            gridTemplateColumns: '20px 1fr auto auto auto auto auto auto 16px',
            alignItems: 'center', gap: 14, padding: '14px 20px',
            background: 'transparent',
            borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = B_TOKENS.surface2; const a = e.currentTarget.querySelector('.b-row-actions'); if (a) a.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; const a = e.currentTarget.querySelector('.b-row-actions'); if (a) a.style.opacity = '0'; }}>
          <BStatusDot status={h.status}/>
          <div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 500, color: B_TOKENS.text }}>{h.name}</div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 2 }}>
              {h.persona}
            </div>
          </div>
          <BTierBadge tier={h.tier} tiers={data.TIERS} size="sm"/>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2 }}>
            <BPlatformIcon kind={h.platform} size={11}/>{h.channel}
          </span>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, minWidth: 50, textAlign: 'right' }}>
            ${h.costToday.toFixed(2)}
          </span>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, minWidth: 50, textAlign: 'right' }}>{h.invocations}</span>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, minWidth: 40, textAlign: 'right' }}>
            {last < 1 ? 'now' : last < 60 ? `${last}m` : `${Math.round(last/60)}h`}
          </span>
          <div className="b-row-actions" onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', gap: 4, opacity: 0, transition: 'opacity 0.12s' }}>
            {isRunning
              ? <BRowAction icon="refresh" title="Restart"/>
              : <BRowAction icon="play" title="Start"/>}
            {isRunning && <BRowAction icon="stop" title="Stop"/>}
          </div>
          <BIcon name="chev" size={12} color={B_TOKENS.text3}/>
        </div>;
      })}
    </BCard>
  </div>;
}

function BRowAction({ icon, title, onClick }) {
  return <button onClick={onClick} title={title}
    style={{
      background: B_TOKENS.surface, border: `1px solid ${B_TOKENS.border}`,
      color: B_TOKENS.text2, padding: '5px 7px', borderRadius: 4,
      cursor: 'pointer', lineHeight: 0,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.color = B_TOKENS.text; e.currentTarget.style.borderColor = B_TOKENS.text3; }}
    onMouseLeave={(e) => { e.currentTarget.style.color = B_TOKENS.text2; e.currentTarget.style.borderColor = B_TOKENS.border; }}>
    <BIcon name={icon} size={12}/>
  </button>;
}

function BPageHero({ title, subtitle, action }) {
  return <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
    <div>
      <h1 style={{ margin: 0, fontFamily: B_TOKENS.display, fontSize: 32, fontWeight: 400, color: B_TOKENS.text, letterSpacing: -0.8 }}>{title}</h1>
      {subtitle && <p style={{ margin: '8px 0 0', fontFamily: B_TOKENS.sans, fontSize: 14, color: B_TOKENS.text2, lineHeight: 1.5, maxWidth: 600 }}>{subtitle}</p>}
    </div>
    {action}
  </div>;
}

function BSurfacesPage({ data }) {
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Chat surfaces"
      subtitle="How harnesses speak to humans. Adapter pattern — adding Discord, Slack, or Signal later means a new card, not a new IA."
      action={<BBtn icon="plus">Add adapter</BBtn>}/>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14, marginTop: 22 }}>
      {data.INTEGRATIONS.map((it) => {
        const harnesses = it.harnessIds.map((id) => data.HARNESSES.find((h) => h.id === id)).filter(Boolean);
        return <BCard key={it.id} style={{ opacity: it.status === 'planned' ? 0.55 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <BPlatformIcon kind={it.kind} size={18}/>
            <span style={{ fontFamily: B_TOKENS.sans, fontSize: 15, fontWeight: 500, color: B_TOKENS.text }}>{it.label}</span>
            <span style={{ flex: 1 }}/>
            <BPill color={it.status === 'connected' ? B_TOKENS.good : B_TOKENS.text3}>{it.status}</BPill>
          </div>
          <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, marginBottom: 14 }}>{it.serverInfo}</div>
          {it.kind === 'mattermost' && it.status === 'connected' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                {[['DMs', it.dmsBlocked ? 'Blocked' : 'Open'], ['Channels', `${it.allowList} allowed`], ['Per team', '1 runtime, scope by channel']].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px dashed ${B_TOKENS.border}`, fontFamily: B_TOKENS.sans, fontSize: 12 }}>
                    <span style={{ color: B_TOKENS.text3 }}>{k}</span>
                    <span style={{ color: B_TOKENS.text }}>{v}</span>
                  </div>
                ))}
              </div>
              <BConfigureInApp
                title="Configure in Mattermost"
                steps={[
                  'System Console → Integrations → Bot Accounts. Create or pick the bot for this surface; copy the access token into Keys.',
                  'Add the bot to the channels you want it to participate in — channel membership is the allowlist.',
                ]}
                link={{ label: 'Open Mattermost admin', href: it.serverInfo ? `https://${it.serverInfo.replace(/^.*?\/\//, '')}/admin_console` : '#' }}
              />
            </>
          )}
          {it.kind === 'telegram' && it.status === 'connected' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                {[['DMs', it.dmsAllowed], ['Group adds', it.groupAdds], ['Bots', '3 registered']].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px dashed ${B_TOKENS.border}`, fontFamily: B_TOKENS.sans, fontSize: 12 }}>
                    <span style={{ color: B_TOKENS.text3 }}>{k}</span>
                    <span style={{ color: B_TOKENS.text }}>{v}</span>
                  </div>
                ))}
              </div>
              <BConfigureInApp
                title="Configure in BotFather"
                steps={[
                  '/mybots → pick this bot → Bot Settings → Group Privacy → Disable, so it can read group mentions.',
                  'Bot Settings → Allow Groups? → On. Set commands and description here too — Hermes does not push these for you.',
                ]}
                link={{ label: 'Open BotFather', href: 'https://t.me/BotFather' }}
              />
            </>
          )}
          {harnesses.length > 0 && (
            <div>
              <BSectionLabel style={{ marginBottom: 8 }}>Harnesses on this surface</BSectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {harnesses.map((h) => (
                  <BPill key={h.id}>
                    <BStatusDot status={h.status}/>{h.name}
                  </BPill>
                ))}
              </div>
            </div>
          )}
          {it.status !== 'connected' && (
            <div style={{ marginTop: 6 }}>
              {it.status === 'available' ? <BBtn size="sm" kind="primary">Connect</BBtn> : <BBtn size="sm" kind="ghost">Notify when ready</BBtn>}
            </div>
          )}
        </BCard>;
      })}
    </div>
  </div>;
}

function BToolsPage({ data }) {
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Tools"
      subtitle="Tool registry. Risk × habitat. Web access and deletes are always the highest risk; clamps tighten as habitat opens."
      action={<BBtn icon="plus">Register tool</BBtn>}/>
    <BCard padded={false} style={{ marginTop: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr auto auto auto', gap: 14, padding: '14px 18px', borderBottom: `1px solid ${B_TOKENS.border}` }}>
        <BSectionLabel>Tool</BSectionLabel><BSectionLabel>Risk</BSectionLabel>
        <BSectionLabel style={{ minWidth: 90 }}>Allowed tiers</BSectionLabel>
        <BSectionLabel>Bound</BSectionLabel>
      </div>
      {data.TOOLS.map((t, i) => {
        const bound = data.HARNESSES.filter((h) => h.tools.some((tn) => t.name.startsWith(tn) || t.category === tn)).length;
        return <div key={t.id} style={{
          display: 'grid', gridTemplateColumns: '2fr auto auto auto', gap: 14, alignItems: 'center',
          padding: '12px 18px', borderTop: `1px solid ${B_TOKENS.border}`,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{t.name}</span>
              <span title={t.source === 'builtin' ? 'Ships with Hermes; hand-classified.' :
                           t.source === 'mcp' ? 'From an MCP server, hand-classified by an admin.' :
                           'User-added; admin sets risk + ceiling.'}
                style={{
                  padding: '1px 7px', fontSize: 10, borderRadius: 10,
                  background: B_TOKENS.surface2,
                  color: t.source === 'builtin' ? B_TOKENS.good : t.source === 'mcp' ? B_TOKENS.text2 : B_TOKENS.warn,
                  border: `1px solid ${B_TOKENS.border}`,
                }}>{t.source === 'builtin' ? '✓ Built-in' : t.source === 'mcp' ? 'MCP' : 'Custom'}</span>
              {t.reviewed === false && (
                <span title="Not yet reviewed by an admin — risk + tier ceiling are placeholders."
                  style={{
                    padding: '1px 7px', fontSize: 10, borderRadius: 10,
                    background: `${B_TOKENS.warn}18`, color: B_TOKENS.warn,
                    border: `1px solid ${B_TOKENS.warn}50`,
                  }}>Needs review</span>
              )}
            </div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 3 }}>{t.desc}</div>
          </div>
          <BPill color={t.risk >= 4 ? B_TOKENS.bad : t.risk >= 3 ? B_TOKENS.warn : B_TOKENS.text2}>
            R{t.risk}
          </BPill>
          <div style={{ display: 'flex', gap: 3 }}>
            {data.TIERS.map((tier) => (
              <div key={tier.id} title={tier.label}
                style={{ width: 14, height: 14, borderRadius: 3, background: t.allowedTiers.includes(tier.id) ? tier.color : B_TOKENS.border }}/>
            ))}
          </div>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, textAlign: 'right' }}>{bound}</span>
        </div>;
      })}
    </BCard>
  </div>;
}

function BKeysPage({ data }) {
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Keys"
      subtitle="One vault. One key can bind to many harnesses. Type-sorting can come later — for now, flat is calm."
      action={<BBtn icon="plus" kind="primary">Add key</BBtn>}/>
    <BCard padded={false} style={{ marginTop: 22 }}>
      {data.KEYS.map((k, i) => {
        const boundHarnesses = k.assignedTo.map((id) => data.HARNESSES.find((h) => h.id === id)).filter(Boolean);
        const tierIdsUsed = Array.from(new Set(boundHarnesses.map((h) => h.tier)));
        return (
        <div key={k.id} style={{
          display: 'grid', gridTemplateColumns: '12px 2fr 1fr 1fr auto auto', gap: 14, alignItems: 'center',
          padding: '14px 18px', borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: k.health === 'expired' ? B_TOKENS.bad : k.health === 'ok' ? B_TOKENS.good : B_TOKENS.text3,
          }}/>
          <div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{k.label}</div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3, marginTop: 2 }}>{k.provider} · {k.masked}</div>
          </div>
          <BTierMix tierIds={tierIdsUsed} tiers={data.TIERS}/>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {boundHarnesses.length === 0 ? <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>Unbound</span> :
              <>
                {boundHarnesses.slice(0, 2).map((h) => <BPill key={h.id} style={{ fontSize: 10 }}>{h.name}</BPill>)}
                {boundHarnesses.length > 2 && <BPill style={{ fontSize: 10 }}>+{boundHarnesses.length - 2}</BPill>}
              </>
            }
          </div>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2 }}>
            {k.budgetUsd ? `$${k.spentUsd.toFixed(2)}/$${k.budgetUsd}` : '—'}
          </span>
          <BPill color={k.health === 'expired' ? B_TOKENS.bad : k.health === 'ok' ? B_TOKENS.good : B_TOKENS.text3}>{k.health}</BPill>
        </div>
      )})}
    </BCard>
    <div style={{
      marginTop: 14, padding: '12px 16px', fontFamily: B_TOKENS.sans, fontSize: 12,
      color: B_TOKENS.text3, lineHeight: 1.55,
      background: B_TOKENS.surface2, borderRadius: 6,
    }}>
      Keys live in the vault — they don't carry a tier of their own. When a harness uses a key, the request inherits the harness's habitat clamp. The colored squares show which tiers a key currently spans, so a single key sitting in both sanctum and public catches your eye.
    </div>
  </div>;
}

function BTierMix({ tierIds, tiers }) {
  if (!tierIds.length) return <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>—</span>;
  const ordered = tiers.filter((t) => tierIds.includes(t.id));
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {ordered.map((t) => (
        <span key={t.id} title={t.label}
          style={{
            width: 11, height: 11, borderRadius: 3, background: t.color,
            display: 'inline-block',
          }}/>
      ))}
    </span>
  );
}

function BMemoryPage({ data }) {
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Memory"
      subtitle="Memory inherits the habitat tier. Strategy — siloed runtime or tag-gated SQL — depends on risk."
      action={<BBtn icon="plus">New scope</BBtn>}/>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginTop: 22 }}>
      {data.MEMORY_SCOPES.map((m) => {
        const harnesses = data.HARNESSES.filter((h) => h.tier === m.tier);
        return <BCard key={m.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontFamily: B_TOKENS.display, fontSize: 20, fontWeight: 400, color: B_TOKENS.text, letterSpacing: -0.4 }}>{m.name}</h3>
            <BTierBadge tier={m.tier} tiers={data.TIERS} size="sm"/>
          </div>
          <BPill style={{ marginBottom: 12 }}>{m.strategy}</BPill>
          <p style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, lineHeight: 1.5 }}>{m.notes}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>
            <span>{m.members} members</span>
            <span>{harnesses.length} harnesses</span>
            <span>{m.size}</span>
          </div>
        </BCard>;
      })}
    </div>
  </div>;
}

function BPermsPage({ data }) {
  const me = data.PEOPLE[0];
  const community = data.PEOPLE.slice(1);
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="People"
      subtitle="v1 is single-player local. You're the admin; everyone reaching your harnesses through chat is community. Per-handle roles arrive in v2."/>
    <div style={{ display: 'grid', gridTemplateColumns: '5fr 3fr', gap: 14, marginTop: 22 }}>
      <BCard>
        <BSectionLabel style={{ marginBottom: 10 }}>You — admin</BSectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{
            width: 40, height: 40, borderRadius: '50%',
            background: B_TOKENS.accent, color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600,
          }}>{me.name[0]}</span>
          <div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 15, fontWeight: 500, color: B_TOKENS.text }}>{me.name}</div>
            <div style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, marginTop: 2 }}>Local admin · everything, no cap</div>
          </div>
        </div>
        <BSectionLabel style={{ marginBottom: 8 }}>Your handles across surfaces</BSectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { kind: 'mattermost', handle: '@juni', server: 'team.nimbleco' },
            { kind: 'telegram', handle: '@juniperb', server: 'telegram.org' },
          ].map((h) => (
            <div key={h.kind} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
              background: B_TOKENS.surface2, borderRadius: 6,
            }}>
              <BPlatformIcon kind={h.kind} size={14}/>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text }}>{h.handle}</span>
              <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>· {h.server}</span>
            </div>
          ))}
        </div>
      </BCard>
      <BCard>
        <BSectionLabel style={{ marginBottom: 10 }}>Coming in v2</BSectionLabel>
        <h3 style={{ margin: 0, fontFamily: B_TOKENS.display, fontSize: 18, fontWeight: 400, color: B_TOKENS.text, letterSpacing: -0.3, marginBottom: 8 }}>
          Invite teammates
        </h3>
        <p style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2, lineHeight: 1.55 }}>
          Per-handle roles, cross-surface identity (@juni on Telegram = @juni on Mattermost), and budget caps for non-admins land in the multiplayer rebuild.
        </p>
        <button disabled style={{
          marginTop: 14, padding: '8px 12px', borderRadius: 7,
          background: 'transparent', border: `1px dashed ${B_TOKENS.border2}`,
          color: B_TOKENS.text3, fontFamily: B_TOKENS.sans, fontSize: 12,
          cursor: 'not-allowed', width: '100%',
        }}>+ Invite teammate (v2)</button>
      </BCard>
    </div>

    <div style={{ marginTop: 22 }}>
      <BSectionLabel style={{ marginBottom: 10 }}>Community — recent invokers across your surfaces</BSectionLabel>
      <BCard padded={false}>
        {community.map((p, i) => (
          <div key={p.id} style={{
            display: 'grid', gridTemplateColumns: '32px 2fr 1fr 1fr auto', gap: 14, alignItems: 'center',
            padding: '14px 18px', borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
          }}>
            <span style={{
              width: 30, height: 30, borderRadius: '50%',
              background: B_TOKENS.surface2, border: `1px solid ${B_TOKENS.border}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: B_TOKENS.sans, fontSize: 12, fontWeight: 600, color: B_TOKENS.text2,
            }}>{p.name[0]}</span>
            <div>
              <div style={{ fontFamily: B_TOKENS.sans, fontSize: 13, fontWeight: 500, color: B_TOKENS.text }}>{p.name}</div>
              <div style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.accent, marginTop: 2 }}>{p.handle}</div>
            </div>
            <BPill>community</BPill>
            <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>
              invoked {Math.floor(Math.random() * 30) + 2} times
            </span>
            <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>
              {Math.round((data.now - p.lastActive) / 60000)}m ago
            </span>
          </div>
        ))}
      </BCard>
      <p style={{
        margin: '14px 0 0', fontFamily: B_TOKENS.sans, fontSize: 12,
        color: B_TOKENS.text3, lineHeight: 1.5, fontStyle: 'italic',
      }}>
        Per-harness invocation rules (allowlists, blocklists) live on each harness's Surfaces tab — that's where the question of "who can talk to this bot here" naturally belongs.
      </p>
    </div>
  </div>;
}

function BAuditPage({ data }) {
  const audit = [
    { ts: data.now - 120000, who: '@juni', what: 'rotated key', target: 'Anthropic — primary' },
    { ts: data.now - 380000, who: '@audrey', what: 'attached tool', target: 'audrey · notion.search' },
    { ts: data.now - 720000, who: '@max', what: 'restarted harness', target: 'pr-review' },
    { ts: data.now - 1480000, who: '@juni', what: 'created harness', target: 'egregore (orgpublic)' },
    { ts: data.now - 2200000, who: '@juni', what: 'enabled', target: 'local API for Claude Code' },
    { ts: data.now - 4800000, who: '@audrey', what: 'invited', target: '@rin · operator' },
    { ts: data.now - 9600000, who: '@juni', what: 'rebuilt', target: 'cryptid · Dockerfile changed' },
  ];
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Activity" subtitle="Append-only log of every privileged action."
      action={<BBtn>Export</BBtn>}/>
    <BCard padded={false} style={{ marginTop: 22 }}>
      {audit.map((a, i) => {
        const min = Math.round((data.now - a.ts) / 60000);
        return <div key={i} style={{
          display: 'grid', gridTemplateColumns: '90px 80px 1fr', gap: 14, alignItems: 'center',
          padding: '12px 18px', borderTop: i > 0 ? `1px solid ${B_TOKENS.border}` : 'none',
        }}>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 11, color: B_TOKENS.text3 }}>
            {min < 60 ? `${min}m ago` : `${Math.round(min/60)}h ago`}
          </span>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.accent, fontWeight: 500 }}>{a.who}</span>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text }}>
            {a.what} <span style={{ color: B_TOKENS.text2 }}>· {a.target}</span>
          </span>
        </div>;
      })}
    </BCard>
  </div>;
}

function BSettingsPage({ data }) {
  const [localApi, setLocalApi] = bDState(true);
  return <div style={{ padding: '28px 32px' }}>
    <BPageHero title="Settings" subtitle="Global config. Lean. Add as needed."/>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 22 }}>
      <BCard>
        <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 8 }}>Local API for Claude Code</h3>
        <p style={{ margin: '0 0 14px', fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text3, lineHeight: 1.5 }}>
          Lets a local Claude Code instance hit Hermes directly — no bearer tokens to manage. Replaces the old swarm-bearer system.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setLocalApi(!localApi)} style={{
            width: 38, height: 22, borderRadius: 11, padding: 2,
            background: localApi ? B_TOKENS.accent : B_TOKENS.border,
            border: 'none', cursor: 'pointer', position: 'relative',
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff', display: 'block',
              transform: `translateX(${localApi ? 16 : 0}px)`, transition: 'transform 0.15s',
            }}/>
          </button>
          <span style={{ fontFamily: B_TOKENS.sans, fontSize: 13, color: B_TOKENS.text }}>
            {localApi ? 'Exposed' : 'Disabled'}
          </span>
          {localApi && <span style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 11,
            padding: '4px 8px', borderRadius: 5,
            background: B_TOKENS.surface2, color: B_TOKENS.accent,
          }}>http://localhost:8400/v1</span>}
        </div>
      </BCard>
      <BCard>
        <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 14 }}>Defaults</h3>
        {[
          ['Default tier for new harnesses', 'Individual'],
          ['Default model', 'claude-sonnet-4.5'],
          ['Default daily budget', '$5.00'],
          ['Restart strategy', 'Smart (auto-rebuild on Dockerfile change)'],
        ].map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 3 ? `1px dashed ${B_TOKENS.border}` : 'none' }}>
            <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text2 }}>{k}</span>
            <span style={{ fontFamily: B_TOKENS.sans, fontSize: 12, color: B_TOKENS.text }}>{v}</span>
          </div>
        ))}
      </BCard>
      <BCard style={{ gridColumn: 'span 2' }}>
        <h3 style={{ margin: 0, fontFamily: B_TOKENS.sans, fontSize: 14, fontWeight: 600, color: B_TOKENS.text, marginBottom: 14 }}>Hermes runtime</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <BStatInline label="Version" value="v0.4.2"/>
          <BStatInline label="Uptime" value="14d"/>
          <BStatInline label="Docker" value="24.0.7"/>
          <BStatInline label="Layer cache" value="2.4 GB" sub="across 8 harnesses"/>
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
          <BBtn size="sm" icon="refresh">Restart Hermes</BBtn>
          <BBtn size="sm" kind="ghost">Purge build cache</BBtn>
          <BBtn size="sm" kind="ghost">View logs</BBtn>
        </div>
      </BCard>
    </div>
  </div>;
}

// ─── App shell ─────────────────────────────────────────
function BCalmOrchestrator({ data, theme, setTheme, initialRoute, route: extRoute, setRoute: extSetRoute, viewToggle }) {
  const [innerRoute, innerSetRoute] = bDState(initialRoute || 'dashboard');
  const route = extRoute != null ? extRoute : innerRoute;
  const setRoute = extSetRoute || innerSetRoute;
  const baseRoute = route.split('/')[0];
  const harnessId = route.startsWith('harnesses/') ? route.split('/')[1] : null;
  return <div data-direction="b" data-theme={theme} className="sm-root"
    style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'row',
      background: B_TOKENS.bg, color: B_TOKENS.text,
      fontFamily: B_TOKENS.sans, overflow: 'hidden',
    }}>
    <BSidebar route={route} setRoute={setRoute}/>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <BTopBar route={route} setRoute={setRoute} theme={theme} setTheme={setTheme} viewToggle={viewToggle}/>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {harnessId && <BHarnessDetail data={data} harnessId={harnessId} setRoute={setRoute}/>}
        {!harnessId && baseRoute === 'dashboard' && <BDashboard data={data} setRoute={setRoute}/>}
        {!harnessId && baseRoute === 'harnesses' && <BHarnessesPage data={data} setRoute={setRoute}/>}
        {baseRoute === 'surfaces' && <BSurfacesPage data={data}/>}
        {baseRoute === 'tools' && <BToolsPage data={data}/>}
        {baseRoute === 'keys' && <BKeysPage data={data}/>}
        {baseRoute === 'memory' && <BMemoryPage data={data}/>}
        {baseRoute === 'permissions' && <BPermsPage data={data}/>}
        {baseRoute === 'audit' && <BAuditPage data={data}/>}
        {baseRoute === 'settings' && <BSettingsPage data={data}/>}
      </div>
    </div>
  </div>;
}

window.BCalmOrchestrator = BCalmOrchestrator;
window.BCalmOrchestratorAt = BCalmOrchestrator;

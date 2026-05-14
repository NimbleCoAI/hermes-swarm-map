/* Direction A · Admin screens (surfaces, tools, keys, memory, perms, settings, audit)
   Each is a single panel-driven page. Dense, scannable, mono-leaning. */

const { useState: aAdminState } = React;

// ─── Surfaces (chat-platform admin) ────────────────────
function ASurfacesPage({ data }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader
        title="surfaces"
        subtitle="Chat-platform adapters. Each surface is a way harnesses speak to humans. Adding new platforms = new adapter cards, no IA changes."
        action={<ABtn icon="plus">add adapter</ABtn>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
        {data.INTEGRATIONS.map((it) => <ASurfaceCard key={it.id} it={it} data={data}/>)}
      </div>
    </div>
  );
}

function ASurfaceCard({ it, data }) {
  const harnesses = it.harnessIds.map((id) => data.HARNESSES.find((h) => h.id === id)).filter(Boolean);
  const stColor = it.status === 'connected' ? A_TOKENS.good : A_TOKENS.text3;
  return (
    <APanel
      style={{ opacity: it.status === 'planned' ? 0.55 : 1 }}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <APlatformIcon kind={it.kind} size={14}/>
          <span>{it.kind}</span>
        </span>
      }
      right={<ATag color={stColor}>{it.status}</ATag>}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: A_TOKENS.sans, fontSize: 13, color: A_TOKENS.text }}>{it.label}</div>
        <div style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3, marginTop: 2 }}>{it.serverInfo}</div>
      </div>

      {it.kind === 'mattermost' && it.status === 'connected' && (
        <>
        <ARuleList rules={[
          ['DM behavior', it.dmsBlocked ? 'Blocked — no direct messages' : 'Open', it.dmsBlocked ? A_TOKENS.text2 : A_TOKENS.warn],
          ['Channel allowlist', `${it.allowList} channels`, A_TOKENS.text2],
          ['Per team', '1 runtime per team · scope by channel + invoker', A_TOKENS.text2],
        ]}/>
        <AConfigureInApp
          title="configure in mattermost"
          steps={[
            'Open Mattermost → System Console → Integrations → Bot Accounts.',
            'Create or select the bot account this surface uses; copy the access token into Keys.',
            'In Channel Settings, add the bot to channels you want it to speak in (the allowlist mirrors that membership).',
          ]}
          link={{ label: 'open mattermost admin', href: it.serverInfo ? `https://${it.serverInfo.replace(/^.*?\/\//, '')}/admin_console` : '#' }}
        />
        </>
      )}
      {it.kind === 'telegram' && it.status === 'connected' && (
        <>
        <ARuleList rules={[
          ['DM behavior', it.dmsAllowed, A_TOKENS.text2],
          ['Group adds', it.groupAdds, A_TOKENS.text2],
          ['Per bot', '1 harness · invocation triggered (mention or command)', A_TOKENS.text2],
        ]}/>
        <AConfigureInApp
          title="configure in botfather"
          steps={[
            'Open BotFather. /mybots → pick this bot → Bot Settings → Group Privacy → Disable (so it can read group mentions).',
            'Allow groups: Bot Settings → Allow Groups? → On.',
            'Set commands list and description from BotFather; Hermes does not push these for you.',
          ]}
          link={{ label: 'open botfather', href: 'https://t.me/BotFather' }}
        />
        </>
      )}
      {it.status !== 'connected' && (
        <div style={{
          padding: 10, fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text3,
          background: A_TOKENS.surface2, borderRadius: 3, lineHeight: 1.5,
        }}>
          {it.status === 'available' ? 'Adapter ready. Connect to start routing harnesses.' : 'Roadmap. Adapter scaffold compatible with current model.'}
        </div>
      )}

      {harnesses.length > 0 && (
        <>
          <div style={{
            fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
            textTransform: 'uppercase', color: A_TOKENS.text3, margin: '14px 0 6px',
          }}>HARNESSES ON THIS SURFACE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {harnesses.map((h) => (
              <div key={h.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 8px', background: A_TOKENS.surface2,
                border: `1px solid ${A_TOKENS.border}`, borderRadius: 3,
                fontFamily: A_TOKENS.mono, fontSize: 11,
              }}>
                <AStatusDot status={h.status}/>
                <span style={{ color: A_TOKENS.text }}>{h.name}</span>
                <span style={{ color: A_TOKENS.text3, fontSize: 10 }}>{h.channel}</span>
                <span style={{ flex: 1 }}/>
                <ATierChip tier={h.tier} tiers={data.TIERS} compact/>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
        {it.status === 'connected' && <ABtn size="sm">configure</ABtn>}
        {it.status === 'connected' && <ABtn size="sm" kind="ghost">disconnect</ABtn>}
        {it.status === 'available' && <ABtn size="sm" kind="primary">connect</ABtn>}
        {it.status === 'planned' && <ABtn size="sm" kind="ghost">notify when ready</ABtn>}
      </div>
    </APanel>
  );
}

function ARuleList({ rules }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rules.map(([label, value, color], i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', gap: 12,
          padding: '5px 0', fontFamily: A_TOKENS.mono, fontSize: 11,
          borderBottom: i < rules.length - 1 ? `1px dashed ${A_TOKENS.border}` : 'none',
        }}>
          <span style={{ color: A_TOKENS.text3 }}>{label}</span>
          <span style={{ color: color || A_TOKENS.text2, textAlign: 'right' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// Configure-in-app card — for the bits no API surfaces (BotFather, MM admin etc).
function AConfigureInApp({ title, steps, link }) {
  return (
    <div style={{
      marginTop: 14, padding: '10px 12px',
      background: `${A_TOKENS.info || A_TOKENS.accent}10`,
      border: `1px solid ${(A_TOKENS.info || A_TOKENS.accent)}40`,
      borderRadius: 3,
    }}>
      <div style={{
        fontFamily: A_TOKENS.mono, fontSize: 9, letterSpacing: 1.2,
        textTransform: 'uppercase', color: A_TOKENS.info || A_TOKENS.accent,
        marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <AIcon name="link" size={10} color={A_TOKENS.info || A_TOKENS.accent}/>
        {title}
      </div>
      <ol style={{
        margin: 0, padding: '0 0 0 18px',
        fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2,
        lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {link && (
        <a href={link.href} target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          marginTop: 8, padding: '4px 8px', borderRadius: 2,
          fontFamily: A_TOKENS.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
          color: A_TOKENS.info || A_TOKENS.accent, textDecoration: 'none',
          border: `1px solid ${A_TOKENS.info || A_TOKENS.accent}40`,
        }}>
          {link.label} <AIcon name="arrow" size={9}/>
        </a>
      )}
    </div>
  );
}

function APageHeader({ title, subtitle, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 18, paddingBottom: 6,
    }}>
      <div>
        <h1 style={{
          margin: 0, fontFamily: A_TOKENS.mono, fontSize: 22,
          color: A_TOKENS.text, fontWeight: 500, letterSpacing: -0.3,
        }}><span style={{ color: A_TOKENS.accent }}>~/</span>{title}</h1>
        {subtitle && <p style={{
          margin: '6px 0 0', fontFamily: A_TOKENS.sans, fontSize: 12,
          color: A_TOKENS.text3, maxWidth: 720, lineHeight: 1.5,
        }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Tools (registry + tier matrix) ────────────────────
function AToolsPage({ data }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader
        title="tools"
        subtitle="Tool registry. Risk level + tier ceiling. Web access and deletes are always the highest risk; clamps tighten as habitat opens up."
        action={<ABtn icon="plus">register tool</ABtn>}
      />
      <APanel padding={false} title="risk × habitat ceiling">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
          <thead>
            <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
              <th style={aTh}>tool</th>
              <th style={aTh}>source</th>
              <th style={aTh}>risk</th>
              {data.TIERS.map((t) => (
                <th key={t.id} style={{ ...aTh, color: t.color, textAlign: 'center' }}>T{t.rank}</th>
              ))}
              <th style={aTh}>bound</th>
            </tr>
          </thead>
          <tbody>
            {data.TOOLS.map((t) => {
              const bound = data.HARNESSES.filter((h) => h.tools.some((tn) => t.name.startsWith(tn) || t.category === tn)).length;
              return (
                <tr key={t.id} style={{
                  borderBottom: `1px solid ${A_TOKENS.border}`,
                  background: t.reviewed === false ? `${A_TOKENS.warn}08` : 'transparent',
                }}>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>{t.name}</span>
                      {t.reviewed === false && (
                        <span title="User-added — risk + tier ceiling not confirmed by an admin"
                          style={{
                            padding: '1px 5px', fontSize: 9, borderRadius: 2,
                            border: `1px solid ${A_TOKENS.warn}60`, color: A_TOKENS.warn,
                            background: `${A_TOKENS.warn}14`, textTransform: 'uppercase', letterSpacing: 0.5,
                          }}>needs review</span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: A_TOKENS.text3, marginTop: 2 }}>{t.desc}</div>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span title={t.source === 'builtin' ? 'Ships with Hermes; hand-classified by maintainers.' :
                                 t.source === 'mcp' ? 'Imported from an MCP server. Hand-classified once by an admin.' :
                                 'User-added. No vendor classification — admin sets risk + ceiling.'}
                      style={{
                        padding: '1px 6px', fontSize: 9, borderRadius: 2,
                        border: `1px solid ${A_TOKENS.border}`,
                        color: t.source === 'builtin' ? A_TOKENS.good : t.source === 'mcp' ? A_TOKENS.text2 : A_TOKENS.warn,
                        background: A_TOKENS.surface2, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>{t.source === 'builtin' ? '✓ built-in' : t.source === 'mcp' ? 'mcp' : 'custom'}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}><ARiskBar level={t.risk}/></td>
                  {data.TIERS.map((tier) => {
                    const ok = t.allowedTiers.includes(tier.id);
                    return (
                      <td key={tier.id} style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {ok ? (
                          <span style={{ color: tier.color, fontSize: 13 }}>●</span>
                        ) : (
                          <span style={{ color: A_TOKENS.border2, fontSize: 13 }}>○</span>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{bound}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </APanel>
    </div>
  );
}

const aTh = {
  textAlign: 'left', padding: '8px 12px', fontSize: 9, fontWeight: 500,
  letterSpacing: 1.2, textTransform: 'uppercase',
  borderBottom: `1px solid ${A_TOKENS.border}`,
};

// ─── Keys (flat vault) ────────────────────────────────
function AKeysPage({ data }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader
        title="keys"
        subtitle="Single vault. Bind to harnesses. One key, many harnesses. Sortable later — for now, flat is fine."
        action={<ABtn icon="plus">add key</ABtn>}
      />
      <APanel padding={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
          <thead>
            <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
              {['', 'label', 'provider', 'value', 'bindings', 'used in tiers', 'budget', 'health', ''].map((h, i) => (
                <th key={i} style={aTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.KEYS.map((k) => {
              const boundHarnesses = k.assignedTo.map((id) => data.HARNESSES.find((h) => h.id === id)).filter(Boolean);
              const tierIdsUsed = Array.from(new Set(boundHarnesses.map((h) => h.tier)));
              return (
              <tr key={k.id} style={{ borderBottom: `1px solid ${A_TOKENS.border}` }}>
                <td style={{ padding: '8px 12px', width: 18 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: k.health === 'expired' ? A_TOKENS.bad : k.health === 'ok' ? A_TOKENS.good : A_TOKENS.text3,
                    display: 'inline-block',
                  }}/>
                </td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>{k.label}</td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{k.provider}</td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{k.masked}</td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {boundHarnesses.length === 0 ? (
                      <span style={{ color: A_TOKENS.text3, fontSize: 10 }}>unbound</span>
                    ) : boundHarnesses.slice(0, 3).map((h) => (
                      <ATag key={h.id}>{h.name}</ATag>
                    ))}
                    {boundHarnesses.length > 3 && <ATag>+{boundHarnesses.length - 3}</ATag>}
                  </div>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <ATierMix tierIds={tierIdsUsed} tiers={data.TIERS}/>
                </td>
                <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>
                  {k.budgetUsd ? `$${k.spentUsd.toFixed(2)}/$${k.budgetUsd}` : '—'}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <ATag color={k.health === 'expired' ? A_TOKENS.bad : k.health === 'ok' ? A_TOKENS.good : A_TOKENS.text3}>
                    {k.health}
                  </ATag>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <button style={{
                    background: 'transparent', border: 'none', color: A_TOKENS.text3, cursor: 'pointer',
                    fontFamily: A_TOKENS.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>edit</button>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </APanel>
      <div style={{
        padding: '10px 12px', fontFamily: A_TOKENS.sans, fontSize: 11,
        color: A_TOKENS.text3, lineHeight: 1.5,
        background: A_TOKENS.surface, border: `1px solid ${A_TOKENS.border}`, borderRadius: 3,
      }}>
        Keys are vault entries — they don't have a tier of their own. Use of a key inherits the calling habitat's clamp. The "used in tiers" column shows the tier mix of the harnesses currently bound, so you can spot a single key spanning sanctum and public habitats.
      </div>
    </div>
  );
}

function ATierMix({ tierIds, tiers }) {
  if (!tierIds.length) return <span style={{ color: A_TOKENS.text3, fontSize: 10 }}>—</span>;
  const ordered = tiers.filter((t) => tierIds.includes(t.id));
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {ordered.map((t) => (
        <span key={t.id} title={t.label}
          style={{
            width: 10, height: 10, borderRadius: 2, background: t.color,
            border: `1px solid ${t.color}`, display: 'inline-block',
          }}/>
      ))}
    </span>
  );
}

// ─── Memory ────────────────────────────────────────────
function AMemoryPage({ data }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader
        title="memory"
        subtitle="Memory scopes inherit habitat tier. Strategy — siloed runtime (full isolation) vs tag-gated (SQL with row-level scopes) — depends on risk."
        action={<ABtn icon="plus">new scope</ABtn>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {data.MEMORY_SCOPES.map((m) => {
          const tier = data.TIERS.find((t) => t.id === m.tier);
          const harnesses = data.HARNESSES.filter((h) => h.tier === m.tier);
          return (
            <APanel key={m.id} title={m.name}
              right={<ATierChip tier={m.tier} tiers={data.TIERS} compact/>}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <ATag>{m.strategy}</ATag>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3 }}>{m.size}</span>
              </div>
              <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2, lineHeight: 1.5, marginBottom: 12 }}>
                {m.notes}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text3 }}>
                <span>{m.members} members</span>
                <span>{harnesses.length} harnesses</span>
              </div>
            </APanel>
          );
        })}
      </div>
    </div>
  );
}

// ─── Permissions ────────────────────────────────────────
function APermsPage({ data }) {
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader
        title="permissions"
        subtitle="Who can do what. Roles map to tiers. Budget caps for non-admins. Per-harness overrides if you need them."
        action={<ABtn icon="plus">invite</ABtn>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <APanel title="people" padding={false}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
            <thead>
              <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
                {['', 'name', 'handle', 'role', 'tier access', 'last active', ''].map((h, i) => <th key={i} style={aTh}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.PEOPLE.map((p) => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${A_TOKENS.border}` }}>
                  <td style={{ padding: '8px 12px', width: 28 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: A_TOKENS.surface2, border: `1px solid ${A_TOKENS.border}`,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: A_TOKENS.text2,
                    }}>{p.name[0]}</span>
                  </td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>{p.name}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.accent }}>{p.handle}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <ATag color={p.role === 'owner' ? A_TOKENS.accent : A_TOKENS.text2}>{p.role}</ATag>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {data.TIERS.map((t) => (
                        <div key={t.id} title={t.label}
                          style={{
                            width: 14, height: 6, borderRadius: 1,
                            background: p.tierAccess.includes(t.id) ? t.color : A_TOKENS.border,
                          }}/>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3, fontSize: 10 }}>
                    {Math.round((data.now - p.lastActive) / 60000)}m ago
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <button style={{
                      background: 'transparent', border: 'none', color: A_TOKENS.text3, cursor: 'pointer',
                      fontFamily: A_TOKENS.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </APanel>

        <APanel title="role definitions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { role: 'owner', desc: 'You. Everything. No budget cap.', color: A_TOKENS.accent },
              { role: 'admin', desc: 'All harnesses. All tiers. Manage perms. No cap.', color: A_TOKENS.text2 },
              { role: 'operator', desc: 'Run + duplicate harnesses at granted tiers. Daily budget cap.', color: A_TOKENS.text2 },
              { role: 'viewer', desc: 'Read-only. Can invoke public-tier harnesses only.', color: A_TOKENS.text3 },
            ].map((r) => (
              <div key={r.role} style={{ paddingBottom: 8, borderBottom: `1px solid ${A_TOKENS.border}` }}>
                <div style={{ fontFamily: A_TOKENS.mono, fontSize: 11, color: r.color, marginBottom: 2 }}>{r.role}</div>
                <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2, lineHeight: 1.5 }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </APanel>
      </div>
    </div>
  );
}

// ─── Audit ─────────────────────────────────────────────
function AAuditPage({ data }) {
  const audit = [
    { ts: data.now - 120000,  who: '@juni',   what: 'rotated key', target: 'k_anth', meta: 'Anthropic — primary' },
    { ts: data.now - 380000,  who: '@audrey', what: 'attached tool', target: 'h_audrey', meta: 'notion.search' },
    { ts: data.now - 720000,  who: '@max',    what: 'restarted',   target: 'h_review', meta: 'after key swap' },
    { ts: data.now - 1480000, who: '@juni',   what: 'created harness', target: 'h_egregore', meta: 'tier=orgpublic' },
    { ts: data.now - 2200000, who: '@juni',   what: 'enabled',     target: 'local-api', meta: 'Hermes localhost:8400' },
    { ts: data.now - 4800000, who: '@audrey', what: 'invited',     target: '@rin', meta: 'role=operator' },
    { ts: data.now - 9600000, who: '@juni',   what: 'rebuilt',     target: 'h_cryptid', meta: 'Dockerfile changed' },
  ];
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader
        title="audit"
        subtitle="Append-only. Every privileged action. Filter by who/what/target. Exports to JSONL."
        action={<ABtn icon="copy">export</ABtn>}
      />
      <APanel padding={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
          <thead>
            <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
              {['ts', 'who', 'action', 'target', 'meta'].map((h, i) => <th key={i} style={aTh}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {audit.map((a, i) => {
              const t = new Date(a.ts);
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${A_TOKENS.border}` }}>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{t.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.accent }}>{a.who}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>{a.what}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{a.target}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{a.meta}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </APanel>
    </div>
  );
}

// ─── Settings ──────────────────────────────────────────
function ASettingsPage({ data }) {
  const [localApi, setLocalApi] = aAdminState(true);
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader title="settings" subtitle="Global config. Lean. Add as needed."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <APanel title="local api · for claude code">
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: 12, background: A_TOKENS.surface2,
            borderRadius: 3, border: `1px solid ${A_TOKENS.border}`,
          }}>
            <button onClick={() => setLocalApi(!localApi)}
              style={{
                width: 36, height: 20, borderRadius: 10, padding: 2,
                background: localApi ? A_TOKENS.accent : A_TOKENS.border,
                border: 'none', cursor: 'pointer', flexShrink: 0,
                position: 'relative', transition: 'background 0.15s',
              }}>
              <span style={{
                width: 16, height: 16, borderRadius: '50%',
                background: '#fff', display: 'block',
                transform: `translateX(${localApi ? 16 : 0}px)`,
                transition: 'transform 0.15s',
              }}/>
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: A_TOKENS.sans, fontSize: 12, color: A_TOKENS.text, marginBottom: 4 }}>
                Expose harnesses on local API
              </div>
              <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text3, lineHeight: 1.5 }}>
                Lets a local Claude Code instance hit Hermes directly. No bearer tokens to manage — replaces the old swarm-bearer system.
              </div>
              {localApi && (
                <div style={{
                  marginTop: 8, padding: '6px 8px',
                  background: A_TOKENS.surface, borderRadius: 2,
                  fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.accent,
                }}>http://localhost:8400/v1</div>
              )}
            </div>
          </div>
        </APanel>

        <APanel title="defaults">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ASettingRow label="default tier for new harnesses" value="individual"/>
            <ASettingRow label="default model" value="claude-sonnet-4.5"/>
            <ASettingRow label="default daily budget" value="$5.00"/>
            <ASettingRow label="restart strategy" value="quick (auto-rebuild on Dockerfile change)"/>
          </div>
        </APanel>

        <APanel title="model gating · who can burn what" style={{ gridColumn: 'span 2' }}>
          <div style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text3, marginBottom: 10, lineHeight: 1.5 }}>
            Mark a model <span style={{ color: A_TOKENS.warn }}>◆ admin-only</span> to gate it from non-admin invokers in any tier above individual.
            Open models can be used by anyone the harness habitat allows. Local models are always open.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
            <thead>
              <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
                {['model', 'vendor', 'cost', 'access', 'used by', 'notes'].map((h, i) => <th key={i} style={aTh}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(data.MODELS || []).map((m) => {
                const usedBy = data.HARNESSES.filter((h) => (h.models || [h.model]).includes(m.id)).length;
                const adminOnly = m.accessTier === 'admin';
                return (
                  <tr key={m.id} style={{ borderBottom: `1px solid ${A_TOKENS.border}` }}>
                    <td style={{ padding: '8px 12px', color: A_TOKENS.text }}>{m.id}</td>
                    <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{m.vendor}</td>
                    <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{m.costClass}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        padding: '2px 6px', borderRadius: 2, fontSize: 9,
                        border: `1px solid ${adminOnly ? A_TOKENS.warn + '60' : A_TOKENS.border}`,
                        color: adminOnly ? A_TOKENS.warn : A_TOKENS.text2,
                        background: adminOnly ? A_TOKENS.warn + '12' : 'transparent',
                      }}>{adminOnly ? '◆ admin only' : 'open'}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{usedBy} {usedBy === 1 ? 'harness' : 'harnesses'}</td>
                    <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{m.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </APanel>

        <APanel title="hermes runtime" style={{ gridColumn: 'span 2' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <AStat label="VERSION" value="v0.4.2"/>
            <AStat label="UPTIME" value="14d"/>
            <AStat label="DOCKER" value="24.0.7"/>
            <AStat label="LAYER CACHE" value="2.4GB" sub="across 8 harnesses"/>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
            <ABtn size="sm" icon="refresh">restart hermes</ABtn>
            <ABtn size="sm" kind="ghost">purge build cache</ABtn>
            <ABtn size="sm" kind="ghost">view logs</ABtn>
          </div>
        </APanel>
      </div>
    </div>
  );
}

function ASettingRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: `1px dashed ${A_TOKENS.border}`,
    }}>
      <span style={{ fontFamily: A_TOKENS.sans, fontSize: 11, color: A_TOKENS.text2 }}>{label}</span>
      <span style={{ fontFamily: A_TOKENS.mono, fontSize: 10, color: A_TOKENS.text }}>{value}</span>
    </div>
  );
}

// ─── Harnesses page (alias to dashboard or full list) ──
function AHarnessesPage({ data, setRoute }) {
  const runningCount = data.HARNESSES.filter((h) => h.status === 'running').length;
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <APageHeader title="harnesses" subtitle="The whole fleet. Click to drill in. Hover a row for inline controls."
        action={<div style={{ display: 'flex', gap: 6 }}>
          <ABtn icon="refresh" title={`Restart all ${runningCount} running harnesses`}>restart running ({runningCount})</ABtn>
          <ABtn icon="copy">import</ABtn>
          <ABtn icon="plus" kind="primary">new harness</ABtn>
        </div>}/>
      <APanel padding={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: A_TOKENS.mono, fontSize: 11 }}>
          <thead>
            <tr style={{ background: A_TOKENS.surface2, color: A_TOKENS.text3 }}>
              {['', 'name', 'tier', 'surface', 'model', 'tools', 'spend', 'calls', 'last', '', ''].map((h, i) => <th key={i} style={aTh}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.HARNESSES.map((h) => {
              const last = Math.round((data.now - h.lastSeen) / 60000);
              const models = h.models || [h.model];
              const isRunning = h.status === 'running' || h.status === 'idle';
              return (
                <tr key={h.id} onClick={() => setRoute('harnesses/' + h.id)}
                  className="a-row"
                  style={{ cursor: 'pointer', borderBottom: `1px solid ${A_TOKENS.border}` }}
                  onMouseEnter={(e) => e.currentTarget.style.background = A_TOKENS.surface2}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '8px 12px', width: 18 }}><AStatusDot status={h.status}/></td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text }}><span style={{ color: A_TOKENS.accent }}>~/</span>{h.name}</td>
                  <td style={{ padding: '8px 12px' }}><ATierChip tier={h.tier} tiers={data.TIERS} compact/></td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <APlatformIcon kind={h.platform} size={11}/>{h.channel}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3, fontSize: 10, whiteSpace: 'nowrap' }}>
                    {models[0]}
                    {models.length > 1 && <span title={`fallbacks: ${models.slice(1).join(', ')}`}
                      style={{ marginLeft: 6, padding: '1px 5px', border: `1px solid ${A_TOKENS.border}`, borderRadius: 2, color: A_TOKENS.text3, fontSize: 9 }}>
                      +{models.length - 1}
                    </span>}
                  </td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3 }}>{h.tools.length}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>${h.costToday.toFixed(2)}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text2 }}>{h.invocations}</td>
                  <td style={{ padding: '8px 12px', color: A_TOKENS.text3, fontSize: 10 }}>
                    {last < 1 ? 'now' : last < 60 ? `${last}m` : `${Math.round(last/60)}h`}
                  </td>
                  <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {isRunning
                      ? <ARowAction icon="refresh" title="Restart" />
                      : <ARowAction icon="play" title="Start" />}
                    {isRunning && <ARowAction icon="stop" title="Stop" />}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <AIcon name="chev" size={11} color={A_TOKENS.text3}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </APanel>
    </div>
  );
}

function ARowAction({ icon, title, onClick }) {
  return <button onClick={onClick} title={title}
    style={{
      background: 'transparent', border: `1px solid ${A_TOKENS.border}`,
      color: A_TOKENS.text3, padding: '3px 5px', borderRadius: 2,
      cursor: 'pointer', marginRight: 4, lineHeight: 0,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.color = A_TOKENS.text; e.currentTarget.style.borderColor = A_TOKENS.text2; }}
    onMouseLeave={(e) => { e.currentTarget.style.color = A_TOKENS.text3; e.currentTarget.style.borderColor = A_TOKENS.border; }}>
    <AIcon name={icon} size={10} />
  </button>;
}

Object.assign(window, {
  ASurfacesPage, AToolsPage, AKeysPage, AMemoryPage, APermsPage, AAuditPage, ASettingsPage, AHarnessesPage,
});

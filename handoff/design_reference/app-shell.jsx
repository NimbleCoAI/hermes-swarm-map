/* SwarmMapApp — unified shell that toggles between Calm (default) and Operator views.
   Both directions stay in feature parity. The toggle is a control, not a fork. */

const { useState: smAppState } = React;

function SwarmMapApp({ data, themeA, themeB, setThemeA, setThemeB, density, setDensity, initialRoute, initialView }) {
  const [view, setView] = smAppState(initialView || 'calm');
  const [route, setRoute] = smAppState(initialRoute || 'dashboard');

  // Inject a view-switcher control into the topbar of whichever direction renders.
  // We render the direction's own shell, then float the toggle on top of the topbar.
  const ViewToggle = (
    <div style={{
      display: 'inline-flex', alignItems: 'center', padding: 2,
      borderRadius: 7, background: view === 'operator' ? '#1a1f26' : '#f4f1ec',
      border: `1px solid ${view === 'operator' ? '#2a3038' : '#e5dfd4'}`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      fontSize: 11, fontWeight: 500,
    }}>
      {[
        { id: 'calm', label: 'Calm', hint: 'Default' },
        { id: 'operator', label: 'Operator', hint: 'Advanced' },
      ].map((v) => {
        const active = view === v.id;
        return <button key={v.id} onClick={() => setView(v.id)}
          title={`${v.label} mode — ${v.hint}`}
          style={{
            padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
            background: active ? (view === 'operator' ? '#2a3038' : '#fff') : 'transparent',
            color: active ? (view === 'operator' ? '#e5dfd4' : '#2a251f') : (view === 'operator' ? '#7a8294' : '#7a6f5f'),
            boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
          }}>
          {v.label}
        </button>;
      })}
    </div>
  );

  // Pass route + setter into the direction so navigation is shared.
  const sharedProps = { data, route, setRoute, viewToggle: ViewToggle };

  if (view === 'operator') {
    return <AOperatorConsole {...sharedProps} theme={themeA} setTheme={setThemeA} density={density} setDensity={setDensity}/>;
  }
  return <BCalmOrchestrator {...sharedProps} theme={themeB} setTheme={setThemeB}/>;
}

window.SwarmMapApp = SwarmMapApp;

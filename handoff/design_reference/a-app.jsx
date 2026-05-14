/* Direction A · App shell — routes between dashboard / detail / admin pages */

const { useState: aAppState } = React;

function AOperatorConsole({ data, theme, setTheme, density, setDensity, initialRoute, route: extRoute, setRoute: extSetRoute, viewToggle }) {
  const [innerRoute, innerSetRoute] = aAppState(initialRoute || 'dashboard');
  const route = extRoute != null ? extRoute : innerRoute;
  const setRoute = extSetRoute || innerSetRoute;

  const baseRoute = route.split('/')[0];
  const harnessId = route.startsWith('harnesses/') ? route.split('/')[1] : null;
  const breadcrumb = harnessId
    ? ['harnesses', data.HARNESSES.find((h) => h.id === harnessId)?.name || harnessId]
    : [baseRoute];

  return (
    <div data-direction="a" data-theme={theme} className="sm-root"
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'row',
        background: A_TOKENS.bg,
        color: A_TOKENS.text,
        fontFamily: A_TOKENS.sans,
        overflow: 'hidden',
      }}>
      <ASidebar route={route} setRoute={setRoute} density={density}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ATopBar route={route} setRoute={setRoute} breadcrumb={breadcrumb} theme={theme} setTheme={setTheme} viewToggle={viewToggle}/>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {harnessId       && <AHarnessDetail data={data} harnessId={harnessId} setRoute={setRoute}/>}
          {!harnessId && baseRoute === 'dashboard'   && <ADashboard data={data} setRoute={setRoute}/>}
          {!harnessId && baseRoute === 'harnesses'   && <AHarnessesPage data={data} setRoute={setRoute}/>}
          {baseRoute === 'surfaces'    && <ASurfacesPage data={data}/>}
          {baseRoute === 'tools'       && <AToolsPage data={data}/>}
          {baseRoute === 'keys'        && <AKeysPage data={data}/>}
          {baseRoute === 'memory'      && <AMemoryPage data={data}/>}
          {baseRoute === 'permissions' && <APermsPage data={data}/>}
          {baseRoute === 'audit'       && <AAuditPage data={data}/>}
          {baseRoute === 'settings'    && <ASettingsPage data={data}/>}
        </div>
      </div>
    </div>
  );
}

window.AOperatorConsole = AOperatorConsole;
window.AOperatorConsoleAt = AOperatorConsole;

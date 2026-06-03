// HSM's own callback port — the port the HSM server listens on, used to build the
// HSM_URL / SWARM_MAP_POLICY_URL that agents call back into. Distinct from the
// per-agent API_SERVER_PORT (which is dynamically allocated). HSM runs on 3000
// (see ecosystem.config.js); default to 3000 so the two install paths can't drift.
export function hsmPort(): string {
  return process.env.PORT || '3000'
}

export function hsmBaseUrl(): string {
  return `http://host.docker.internal:${hsmPort()}`
}

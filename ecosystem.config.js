module.exports = {
  apps: [
    {
      name: 'hermes-swarm-map',
      // Point at Next's real JS entry, not node_modules/.bin/next: under pnpm
      // the .bin entry is a /bin/sh shim, which crashes when pm2 runs it through
      // the node interpreter ("SyntaxError: missing ) after argument list").
      // dist/bin/next has a `#!/usr/bin/env node` shebang and is layout-agnostic.
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};

FROM bbernhard/signal-cli-rest-api:0.199-dev

# Override bbernhard's default REST API entrypoint to run
# signal-cli in native HTTP daemon mode (SSE + JSON-RPC).
# This gives us real-time message delivery and full feature support
# while using bbernhard's image which bundles libsignal-client correctly.

COPY healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

# Healthcheck verifies JSON-RPC is responsive (not just HTTP up).
# When the websocket reconnect loop starts, the daemon becomes
# unresponsive to RPC calls, triggering unhealthy → auto-restart.
HEALTHCHECK --interval=30s --timeout=10s --retries=2 --start-period=30s \
    CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["signal-cli", "--config", "/home/.local/share/signal-cli", "daemon", "--http", "0.0.0.0:8080"]

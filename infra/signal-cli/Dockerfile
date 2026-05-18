FROM bbernhard/signal-cli-rest-api:0.199-dev

# Override bbernhard's default REST API entrypoint to run
# signal-cli in native HTTP daemon mode (SSE + JSON-RPC).
# This gives us real-time message delivery and full feature support
# while using bbernhard's image which bundles libsignal-client correctly.

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8080/api/v1/check || exit 1

ENTRYPOINT ["signal-cli", "--config", "/home/.local/share/signal-cli", "daemon", "--http", "0.0.0.0:8080"]

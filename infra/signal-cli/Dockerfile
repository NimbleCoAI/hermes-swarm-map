FROM eclipse-temurin:17-jre-jammy

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

ARG SIGNAL_CLI_VERSION=0.14.1
RUN curl -L "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz" \
    | tar -xz -C /opt \
    && ln -s /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/local/bin/signal-cli

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8080/api/v1/check || exit 1

ENTRYPOINT ["signal-cli", "--config", "/data", "daemon", "--http", "0.0.0.0:8080"]

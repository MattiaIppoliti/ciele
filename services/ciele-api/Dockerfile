# ciele-api for the self-host stack (deploy/docker-compose.rust.yml, #1134).
# The build context is the repository root: the binary embeds the MCP tool
# list recorded under packages/mcp/golden (#1135). Nothing else is read.
FROM rust:1-slim-bookworm AS build
WORKDIR /src
COPY packages/mcp/golden packages/mcp/golden
COPY services/ciele-api/Cargo.toml services/ciele-api/Cargo.lock services/ciele-api/
COPY services/ciele-api/src services/ciele-api/src
RUN cargo build --release --locked --manifest-path services/ciele-api/Cargo.toml

# TLS to Postgres is rustls with bundled roots, so the runtime image needs no
# CA package and no shell tooling beyond what the base ships.
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --no-create-home ciele
COPY --from=build /src/services/ciele-api/target/release/ciele-api /usr/local/bin/ciele-api
USER ciele
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["ciele-api"]

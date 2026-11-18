FROM rust:1.100-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY static ./static
RUN cargo build --release --locked

FROM debian:trixie-slim AS runtime
RUN useradd --create-home --uid 10001 nimbus
COPY --from=builder /app/target/release/nimbus-weather /usr/local/bin/nimbus-weather
USER nimbus
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["nimbus-weather"]

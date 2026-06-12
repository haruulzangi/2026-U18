FROM rust:1.95-bookworm@sha256:adab7941580c74513aa3347f2d2a1f975498280743d29ec62978ba12e3540d3a AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim@sha256:f9c6a2fd2ddbc23e336b6257a5245e31f996953ef06cd13a59fa0a1df2d5c252
WORKDIR /app
COPY --from=builder /app/target/release/my-vault-server /usr/local/bin/my-vault-server
ENV BIND_ADDR=0.0.0.0:3000
EXPOSE 3000
USER 65532:65532
ENTRYPOINT ["my-vault-server"]

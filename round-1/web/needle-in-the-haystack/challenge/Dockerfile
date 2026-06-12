FROM rust:1.85-slim AS builder
WORKDIR /app
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM node:22-slim AS minifier
WORKDIR /app
RUN npm i -g html-minifier-terser
COPY static ./static
RUN html-minifier-terser \
    --collapse-whitespace \
    --remove-comments \
    --minify-css true \
    --minify-js true \
    static/index.html -o static/index.html

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 app
WORKDIR /app
COPY --from=builder /app/target/release/needle-in-the-haystack .
COPY --from=minifier /app/static ./static
RUN chown -R app:app /app
USER app
EXPOSE 3000
CMD ["./needle-in-the-haystack"]

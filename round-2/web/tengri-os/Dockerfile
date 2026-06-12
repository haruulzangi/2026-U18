### Stage 1: Build (obfuscate JS) ###
FROM node:18 AS builder
WORKDIR /build
COPY package.json .
RUN npm install
COPY build.js .
COPY public/ public/
RUN DOCKER_BUILD=1 node build.js

### Stage 2: Runtime ###
FROM node:18-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation fonts-noto-cjk iputils-ping && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Only production deps (no obfuscator needed at runtime)
COPY package.json .
RUN npm install --production --ignore-scripts 2>/dev/null; \
    npm rebuild better-sqlite3 2>/dev/null; \
    npm rebuild 2>/dev/null; exit 0
RUN npm install --production

# Copy obfuscated public files from builder
COPY --from=builder /build/public/ public/

# Copy server files
COPY server.js bot.js ./

# Flag file for command injection
RUN echo 'HZU18{cmd_1nj3ct_kh4n_t3ngr1_0rd0n}' > /app/flag3.txt

EXPOSE 3000
CMD ["node", "server.js"]

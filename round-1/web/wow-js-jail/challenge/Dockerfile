FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.ts sandbox.ts ./
COPY public ./public

RUN pnpm exec esbuild index.ts \
      --bundle --platform=node --format=cjs --packages=bundle \
      --outfile=dist/index.js \
 && pnpm exec esbuild sandbox.ts \
      --bundle --platform=node --format=esm --packages=bundle \
      --outfile=dist/sandbox.mjs

RUN sed -i 's|"./sandbox.ts"|"./sandbox.mjs"|g' dist/index.js


FROM node:24-alpine AS runner

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/dist/index.js /app/dist/sandbox.mjs ./
COPY --from=builder /app/public ./public

USER app

EXPOSE 3000

CMD ["node", "index.js"]

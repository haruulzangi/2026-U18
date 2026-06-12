# syntax=docker/dockerfile:1.6
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5174

COPY package.json package-lock.json* tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci --omit=optional --no-audit --no-fund

COPY shared ./shared
COPY server ./server

EXPOSE 5174
CMD ["npm", "-w", "server", "run", "start"]

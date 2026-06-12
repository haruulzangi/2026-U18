FROM node:18-alpine
WORKDIR /app
COPY app/package*.json ./
RUN npm install --only=production
COPY app/ .
RUN mkdir -p /tmp/uploads && chmod 777 /tmp/uploads
EXPOSE 3000
CMD ["node", "server.js"]
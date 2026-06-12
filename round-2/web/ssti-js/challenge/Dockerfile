FROM node:18-alpine

RUN adduser -D -h /app ctfuser

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

# Flag is readable by the app
RUN chmod 444 /app/flag.txt

USER ctfuser

EXPOSE 3000

CMD ["node", "app.js"]

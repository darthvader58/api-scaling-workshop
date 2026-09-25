FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts/smoke-test.js ./scripts/smoke-test.js
EXPOSE 3000
CMD ["node", "src/server.js"]

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY loadtest ./loadtest
ENTRYPOINT ["node", "loadtest/run.js"]

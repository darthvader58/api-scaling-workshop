FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY loadtest ./loadtest
EXPOSE 3000
CMD ["node", "src/server.js"]

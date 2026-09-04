FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY server ./server
COPY scripts/rotate-apple-secret.mjs ./scripts/rotate-apple-secret.mjs
CMD ["node", "server/index.js"]

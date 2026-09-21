FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070
WORKDIR /app
ARG NOVEL_TRACKER_COMMIT=unknown
ENV NODE_ENV=production
ENV NOVEL_TRACKER_COMMIT=${NOVEL_TRACKER_COMMIT}
COPY --chown=node:node package.json package-lock.json ./
RUN apk upgrade --no-cache \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /root/.npm /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --chown=node:node src ./src
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/rotate-apple-secret.mjs ./scripts/rotate-apple-secret.mjs
USER node
CMD ["node", "server/index.js"]

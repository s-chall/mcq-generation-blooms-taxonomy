FROM node:24.11.0-bookworm-slim

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node services/api/package.json services/api/package.json
COPY --chown=node:node services/web/package.json services/web/package.json
RUN npm ci

COPY --chown=node:node services/api services/api
RUN npm run build --workspace @blooms/api \
    && npm prune --omit=dev

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "services/api/dist/src/server.js"]

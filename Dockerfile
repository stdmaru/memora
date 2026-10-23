FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS api

ENV NODE_ENV=production \
    MANAGER_API_HOST=0.0.0.0 \
    MANAGER_API_PORT=4174 \
    MANAGER_DB_PATH=/app/data/ai-memory-manager.sqlite

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node server ./server
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4174/api/manager/setup/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.mjs"]

FROM nginxinc/nginx-unprivileged:alpine AS web

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
ENTRYPOINT ["/usr/sbin/nginx"]
CMD ["-g", "daemon off;"]

FROM node:24.11.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY services/web/package.json services/web/package.json
RUN npm ci

COPY services/web services/web
RUN npm run build --workspace @blooms/web

FROM nginxinc/nginx-unprivileged:1.29.5-alpine

ENV API_UPSTREAM=api:3000
COPY --from=build /app/services/web/dist /usr/share/nginx/html
COPY services/web/nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

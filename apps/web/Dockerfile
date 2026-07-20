# Build the static Next export once, then let Nginx own the same-origin edge.
# TLS terminates at the platform ingress; this container is private to it.
FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages/shared packages/shared
COPY packages/config packages/config
COPY packages/ui packages/ui
COPY scripts scripts

RUN pnpm --filter @lovart.dofe/shared build \
  && pnpm --filter @lovart.dofe/web build

FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx/lovart-runtime.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/out /usr/share/nginx/html

EXPOSE 8080

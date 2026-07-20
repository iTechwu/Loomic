# Build the static Next export once, then let Nginx own the same-origin edge.
# TLS terminates at the platform ingress; this container is private to it.
# CI can replace both image registries and the package registry without editing
# the Dockerfile when a runner cannot reach a developer-oriented mirror.
ARG NODE_BASE_IMAGE=node:22-alpine
ARG NGINX_BASE_IMAGE=nginx:1.27-alpine
FROM ${NODE_BASE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app
RUN corepack enable \
  && corepack prepare pnpm@10.26.2 --activate \
  && pnpm config set registry ${NPM_REGISTRY}

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

FROM ${NGINX_BASE_IMAGE} AS runtime

COPY deploy/nginx/lovart-runtime.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/out /usr/share/nginx/html

EXPOSE 8080

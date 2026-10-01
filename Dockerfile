# syntax=docker/dockerfile:1

# Image names are fully qualified on purpose: Docker resolves short names to
# Docker Hub silently, Podman asks which registry you meant. Spelling it out
# keeps one Dockerfile working on both.

# --------------------------------------------------------------------- build
# The app is a static SPA. This stage needs the whole dev toolchain (Vite,
# TypeScript) but none of it ships in the final image.
FROM docker.io/library/node:24-alpine AS build

WORKDIR /app

# Manifests first, so npm only re-runs when dependencies actually change
# instead of on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `npm run build` is `tsc -b && vite build`, so a type error fails the image
# build rather than quietly shipping stale or broken output.
RUN npm run build

# ----------------------------------------------------------------------- api
# The Jira adapter. A browser cannot call Jira directly — the REST API sends no
# CORS headers for our origin, and the API token must never ship in a bundle
# nginx serves to the world — so this holds the credential and speaks to Jira
# server-to-server, where origin policy does not apply.
#
# `vite build --ssr` bundles the server to a single file whose only import is
# `node:http`, so there is deliberately no `npm ci` here and no node_modules in
# the image: nothing to install, nothing to audit, nothing to go stale.
FROM docker.io/library/node:24-alpine AS api

WORKDIR /app
COPY --from=build /app/dist-server ./dist-server

# Reached only through nginx's /api/ proxy; docker-compose.yml publishes no host
# port for this service, so the token is never behind an open port.
EXPOSE 8081

CMD ["node", "dist-server/main.js"]

# --------------------------------------------------------------------- serve
FROM docker.io/library/nginx:1-alpine AS serve

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# The health check lives in docker-compose.yml, not here: Podman builds
# OCI-format images and drops a Dockerfile HEALTHCHECK with a warning, so
# putting it here would mean it silently only existed under Docker. Compose
# honours it on both.

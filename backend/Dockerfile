# Node 24 to match CI (.github/workflows/ci.yml). Base images are pinned by
# digest; bump the tag and digest together.

# --- Build stage: install deps (incl. native better-sqlite3 build), compile TS,
# then drop dev dependencies so node_modules can be copied as-is ---
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for common platforms, but falls
# back to compiling from source - python3/make/g++ cover that fallback so
# `npm ci` doesn't fail on an architecture without a prebuild. Only this
# stage has the toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

# --- Runtime stage: prod node_modules + compiled JS, no toolchain, not root ---
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The SQLite volume mounts here; a new volume takes this directory's owner.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 4000
CMD ["node", "dist/index.js"]

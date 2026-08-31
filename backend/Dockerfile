# --- Build stage: install deps (incl. native better-sqlite3 build) and compile TS ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for common platforms, but falls
# back to compiling from source - python3/make/g++ cover that fallback so
# `npm ci` doesn't fail on an architecture without a prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: prod deps only + compiled JS ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY src/schema.sql ./dist/schema.sql

EXPOSE 4000
CMD ["node", "dist/index.js"]

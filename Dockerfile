# Base image pinned by tag AND multi-arch index digest, so rebuilds can't pick
# up a silently re-pushed tag. The digest wins; the tag is for humans/Dependabot.
# To bump (e.g. a Node 22.x security release), replace both on this one line.
# Get the index digest with any of:
#   docker buildx imagetools inspect node:22.X.Y-slim      # "Digest:" line
#   crane digest node:22.X.Y-slim
#   curl -s https://hub.docker.com/v2/repositories/library/node/tags/22.X.Y-slim | jq -r .digest
FROM node:22.23.4-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS base

ENV TZ=UTC
RUN apt-get update -qq && apt-get install -y -qq ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/*

FROM base AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS dev

WORKDIR /app

FROM deps AS build

COPY . .
RUN npm run build && npx tsc -p server/tsconfig.build.json

FROM base AS runtime

ARG GIT_COMMIT=unknown
ARG GIT_TAG=unknown
ARG BUILD_DATE=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_TAG=${GIT_TAG}
ENV BUILD_DATE=${BUILD_DATE}

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY migrations ./migrations

RUN addgroup --system app && adduser --system --ingroup app app \
 && mkdir -p /app/data && chown app:app /app/data
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1
CMD ["node", "--dns-result-order=ipv4first", "dist-server/server/index.js"]

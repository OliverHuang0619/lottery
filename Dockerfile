FROM node:24-bookworm-slim AS frontend
WORKDIR /build/dashboard
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY dashboard/package.json dashboard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY dashboard/ ./
# The live container serves data only through authenticated backend routes.
RUN rm -f public/dashboard.json && pnpm exec tsc -b && pnpm exec vite build

FROM node:24-bookworm-slim
ARG CODEX_VERSION=0.155.1
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION}
WORKDIR /app
COPY --from=frontend /build/dashboard/dist ./dashboard/dist
COPY dashboard/server.mjs ./dashboard/server.mjs
COPY dashboard/backend ./dashboard/backend
COPY skill ./seed/skill
COPY data/current ./seed/data/current
COPY predictions ./seed/predictions
COPY reviews ./seed/reviews
COPY scripts/container-entrypoint.mjs ./scripts/container-entrypoint.mjs
RUN mkdir -p /workspace /state /home/node/.codex && chown -R node:node /workspace /state /home/node/.codex
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 WORKSPACE_DIR=/workspace STATE_DIR=/state CODEX_HOME=/home/node/.codex
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/scripts/container-entrypoint.mjs"]

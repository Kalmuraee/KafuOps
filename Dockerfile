# KafuOps multi-stage Dockerfile.
# Stage 1: build TypeScript into dist/.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY bin ./bin
RUN npm install --omit=optional --no-audit --no-fund && npm run build && npm prune --omit=dev

# Stage 2: runtime image.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# git is required for sandbox apply + push.
RUN apt-get update && apt-get install -y --no-install-recommends git rsync ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin
ENV PATH="/app/bin:$PATH"
RUN chmod +x /app/bin/kafuops.js
USER node
ENTRYPOINT ["node", "/app/bin/kafuops.js"]
CMD ["--help"]

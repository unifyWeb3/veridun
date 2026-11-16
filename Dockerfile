FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.api.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build && npm run circuit:prepare

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/artifacts ./artifacts
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs

USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/api/server.js"]

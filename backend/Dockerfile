# syntax=docker/dockerfile:1
# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
# pg_dump/pg_restore дерекқор серверімен бірдей нұсқада болуы керек (PostgreSQL 16).
RUN apk add --no-cache openssl tini postgresql16-client tzdata \
  && addgroup -S ustaz && adduser -S ustaz -G ustaz \
  && mkdir -p /backups && chown ustaz:ustaz /backups
ENV NODE_ENV=production TZ=Asia/Almaty BACKUP_DIR=/backups PORT=3000
COPY --from=build --chown=ustaz:ustaz /app/node_modules ./node_modules
COPY --from=build --chown=ustaz:ustaz /app/dist ./dist
COPY --from=build --chown=ustaz:ustaz /app/prisma ./prisma
COPY --chown=ustaz:ustaz package.json ./
COPY --chown=ustaz:ustaz docker-entrypoint.sh ./
USER ustaz
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "sh", "./docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]

# ---- Build: Svelte-Frontend bauen ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.mjs ./
COPY web ./web
RUN npm run build

# ---- Laufzeit: nur Server + gebautes Frontend ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]

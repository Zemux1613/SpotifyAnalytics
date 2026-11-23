# ---------- stage 1: dependencies (gemeinsame Basis für dev und build) ----------
FROM node:25-alpine AS deps

ENV NG_CLI_ANALYTICS=false

WORKDIR /app
RUN chown node:node /app
USER node

# erst nur die package-files kopieren -> layer-cache bleibt, solange sich die deps nicht ändern
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci


# ---------- dev: ng serve mit hotreload ----------
FROM deps AS dev

COPY --chown=node:node . .

EXPOSE 4200

# --poll: file-events kommen durch bind-mounts unter windows/macOS nicht zuverlässig an
# (unter linux kann der parameter weg)
CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--poll", "1000"]


# ---------- stage 2: produktions-build ----------
FROM deps AS build

COPY --chown=node:node . .
RUN npx ng build --configuration production


# ---------- stage 3 (prod): statische dateien über nginx ----------
FROM nginx:stable-alpine AS prod

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:4200/ || exit 1

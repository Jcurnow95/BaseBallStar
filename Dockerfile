# Baseball Star is a pure client-side Vite app — no backend, no database. This
# builds the web bundle and serves it as static files, which is all the browser
# build needs. The Capacitor and Electron targets are unaffected by any of this.
#
# Debian slim rather than Alpine on purpose: rollup and esbuild ship separate
# glibc and musl binaries as optional dependencies, and package-lock.json pins
# the glibc ones. On Alpine npm has to resolve the musl variants instead, which
# is a needless way to lose a build.

# ---- build ----------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# electron and electron-builder are devDependencies needed only for the desktop
# target, but `npm ci` still runs electron's postinstall, which pulls a ~150 MB
# prebuilt binary this image will never launch.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

WORKDIR /app

# Copy the manifests alone first so `npm ci` is cached against dependency
# changes rather than every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# tsc --noEmit && vite build. A type error fails the deploy here rather than
# shipping a broken bundle.
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Only what `serve` needs. --ignore-scripts because nothing here has a install
# step worth running, and no devDependencies means no toolchain in the image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

# Railway injects PORT and routes to it. The default matches `npm start` so the
# image behaves the same when run by hand.
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]

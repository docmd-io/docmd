# --------------------------------------------------------------------
# docmd : the minimalist, zero-config documentation generator.
#
# @package     @docmd/core (and ecosystem)
# @website     https://docmd.io
# @repository  https://github.com/docmd-io/docmd
# @license     MIT
# @copyright   Copyright (c) 2025-present docmd.io
#
# [docmd-source] - Please do not remove this header.
# --------------------------------------------------------------------
#
# Multi-stage Dockerfile for docmd
# Creates a minimal production image with docmd CLI pre-installed
#
# Usage:
#   Quick Start (with demo site, served in production mode):
#     docker run -p 3000:3000 docmd:latest
#
#   Initialize new project in current directory:
#     docker run -v $(pwd):/workspace docmd:latest init
#
#   Serve your docs (default command: `serve --host 0.0.0.0`):
#     docker run -v $(pwd)/my-docs:/docs -p 3000:3000 docmd:latest
#
#   Run the dev server instead (live reload, for writing docs):
#     docker run -v $(pwd)/my-docs:/docs -p 3000:3000 docmd:latest dev --host 0.0.0.0
#
#   Build static site:
#     docker run -v $(pwd)/docs:/docs -v $(pwd)/site:/site docmd:latest build
#
# --------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Stage 1: Build stage - compiles TypeScript and prepares the application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl

# Install pnpm directly — avoids corepack version resolution issues in CI.
# Bump the pinned version here whenever the monorepo's packageManager field changes.
RUN npm install -g pnpm@10.33.2

WORKDIR /app

# Copy everything (excluding files via .dockerignore)
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stub out packages that can't build in Docker before running the full build:
#   - engine-rust-binaries: requires cargo; pre-built .node files are in the repo
#   - _playground: dev sandbox, not part of the production image
RUN sh tools/docker-prebuild.sh

# Build all packages
RUN pnpm -r run build

# Resolve workspace:* deps to real version numbers for standalone use
RUN node tools/resolve-ws-deps.js

# Pack all packages into tarballs (mimics npm publish)
RUN pnpm -r pack --pack-destination /tarballs

# Generate a package.json listing every external (non-@docmd) runtime dep of
# @docmd/core's transitive tree. The production stage installs from this file
# instead of a hand-rolled list in the Dockerfile, so adding a dep to any
# @docmd/* package automatically propagates to the Docker image.
RUN node tools/print-okf-runtime-deps.js --emit-pkg=/tarballs/runtime-deps.json

# -----------------------------------------------------------------------------
# Stage 2: Production stage - minimal image with only runtime dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash \
    su-exec

# Create non-root user for security
RUN addgroup -g 1001 -S docmd && \
    adduser -S -D -H -u 1001 -h /app -s /bin/bash -G docmd -g docmd docmd

WORKDIR /app

# Copy packed tarballs from builder
COPY --from=builder /tarballs /tarballs

# Install only @docmd/* packages (the transitive deps of @docmd/core).
# We extract each docmd-*.tgz tarball into /usr/local/lib/node_modules/@docmd/<name>.
# This bypasses npm/pnpm registry lookups (packages aren't published yet at
# build time). Legacy wrappers (doc.md, @mgks/docmd) and the monorepo root
# tarball are excluded by only matching the docmd-* prefix.
RUN mkdir -p /usr/local/lib/node_modules && \
    for tarball in /tarballs/docmd-*.tgz; do \
      fname=$(basename "$tarball" .tgz) && \
      pkg="${fname%-*}" && \
      scoped="@docmd/${pkg#docmd-}" && \
      mkdir -p "/usr/local/lib/node_modules/$scoped" && \
      tar -xzf "$tarball" -C "/usr/local/lib/node_modules/$scoped" --strip-components=1; \
    done

# Install external deps from the auto-generated runtime-deps.json produced by
# the builder stage. We extract the dep list with node and pass it straight to
# `npm install -g`, which puts packages into /usr/local/lib/node_modules —
# exactly where Node's global resolution path looks. No hand-rolled list in the
# Dockerfile: adding a dep to any @docmd/* package propagates automatically on
# the next build because the builder stage regenerates runtime-deps.json fresh.
RUN node -e "\
  const p=JSON.parse(require('fs').readFileSync('/tarballs/runtime-deps.json','utf8')); \
  const args=Object.entries(p.dependencies).map(([k,v])=>k+'@'+v); \
  const {execFileSync}=require('child_process'); \
  execFileSync('npm',['install','-g','--omit=dev','--no-audit','--no-fund',...args],{stdio:'inherit'}); \
"

# Symlink the docmd CLI onto PATH (chmod +x on the script too — some
# base images strip the executable bit during COPY).
RUN ln -sf /usr/local/lib/node_modules/@docmd/core/dist/bin/docmd.js /usr/local/bin/docmd \
 && chmod +x /usr/local/bin/docmd /usr/local/lib/node_modules/@docmd/core/dist/bin/docmd.js

# Clean up tarballs to reduce image size
RUN rm -rf /tarballs

# Create directories for user content
RUN mkdir -p /docs /site && chown -R docmd:docmd /docs /site

# Seed the default template by running docmd init non-interactively.
# This ensures the image ships exactly what a real `docmd init` produces.
#
# Build does NOT fail on init failure: the image still publishes (so users
# who mount their own /docs are unaffected), but the demo experience is
# degraded and a clear warning is printed. Full stderr from `docmd init`
# is in the build log above this block for diagnosis.
RUN mkdir -p /template && \
    cd /template && \
    if docmd init --yes; then \
      if [ ! -f /template/docmd.config.json ]; then \
        printf '\n[docmd-docker] WARNING: docmd init exited 0 but /template/docmd.config.json is missing.\n' >&2; \
        printf '[docmd-docker] Demo seeding will not work. Mount your own /docs.\n' >&2; \
      fi; \
    else \
      printf '\n[docmd-docker] WARNING: docmd init failed during image build.\n' >&2; \
      printf '[docmd-docker] The `docker run` demo experience will not work. Mount your own /docs.\n' >&2; \
      printf '[docmd-docker] Full error from docmd init is in the build log above this block.\n' >&2; \
    fi

# Install entrypoint + healthcheck scripts (see docker/docker-entrypoint.sh
# and docker/docker-healthcheck.sh). The entrypoint seeds /docs from
# /template when /docs is empty, so `docker run` with no volume mount
# still works out of the box. The healthcheck asks `docmd serve` for
# GET /healthz on ${PORT:-3000}; for `dev` it falls back to probing ports.
COPY docker/docker-entrypoint.sh /usr/local/bin/docmd-entrypoint.sh
COPY docker/docker-healthcheck.sh /usr/local/bin/docmd-healthcheck.sh
RUN chmod +x /usr/local/bin/docmd-entrypoint.sh /usr/local/bin/docmd-healthcheck.sh

# Set environment variables
ENV NODE_ENV=production
ENV DOCMD_CONTAINER=true

# Run as root so the entrypoint can inspect /docs ownership and use
# su-exec to re-exec as the correct uid:gid. The entrypoint never stays
# as root — it always drops to the detected uid before exec-ing docmd.
# This is the same pattern used by postgres, redis, and other official images.

# Set working directory to docs (where user content will be mounted)
WORKDIR /docs

# Expose default port (`docmd serve` binds exactly PORT, default 3000)
EXPOSE 3000

# Health check — GET /healthz on ${PORT:-3000} (see docker-healthcheck.sh)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD ["/usr/local/bin/docmd-healthcheck.sh"]

# Default command — entrypoint detects /docs uid, drops privileges, then
# seeds /docs if empty and execs the supplied command.
ENTRYPOINT ["/usr/local/bin/docmd-entrypoint.sh"]
CMD ["serve", "--host", "0.0.0.0"]
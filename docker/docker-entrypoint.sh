#!/bin/sh
# docmd Docker entrypoint
#
# Handles two cases:
#
#   1. No volume / empty /docs  → seeds the demo template so `docmd serve`
#      works out of the box with no arguments.
#
#   2. Host-mounted volume      → detects the uid:gid that owns /docs and
#      re-execs as that identity (via su-exec), so file writes from any
#      subcommand — including `docmd init` — land with the correct host
#      ownership without needing `-u $(id -u):$(id -g)` from the caller.
#
# This mirrors the pattern used by official images (postgres, redis, etc.).
set -e

FIRST_ARG="${1:-}"

# ── uid remapping ────────────────────────────────────────────────────────────
# If we are currently running as root (the entrypoint is exec'd as root so it
# can inspect /docs ownership), detect the uid:gid of /docs and re-exec as
# that user. This lets `docmd init` and `docmd dev` write to host-mounted
# volumes without permission errors regardless of the host user's uid.
if [ "$(id -u)" = "0" ] && [ -d /docs ]; then
  DOCS_UID=$(stat -c '%u' /docs 2>/dev/null || echo "1001")
  DOCS_GID=$(stat -c '%g' /docs 2>/dev/null || echo "1001")

  # If /docs is owned by root (uid 0) on the host, fall back to the docmd
  # user — writing as root inside the container is a security anti-pattern.
  if [ "$DOCS_UID" = "0" ]; then
    DOCS_UID="1001"
    DOCS_GID="1001"
  fi

  # ── writability check (N-18) ───────────────────────────────────────────
  # Catch read-only volume mounts early with a clear message instead of
  # letting docmd crash mid-build with a cryptic EROFS / EACCES error.
  # Only applies to write commands — `serve`, `dev`, `build`, `init`
  # (`serve` writes the built site under /docs).
  # Read-only mounts are valid for `validate`, `mcp`, etc.
  case "$FIRST_ARG" in
    serve|dev|build|init)
      if ! touch /docs/.docmd_write_test 2>/dev/null; then
        printf '\n[docmd] ERROR: /docs is read-only (or not writable by uid %s).\n' "$DOCS_UID" >&2
        printf '[docmd] Mount a writable directory:\n' >&2
        printf '[docmd]   docker run -v $(pwd)/docs:/docs ghcr.io/docmd-io/docmd\n' >&2
        printf '[docmd] Or check directory permissions on the host.\n' >&2
        exit 1
      fi
      rm -f /docs/.docmd_write_test
      ;;
  esac

  # Seed demo template before dropping privileges (root can always write).
  if [ "$FIRST_ARG" != "init" ] && \
     [ -z "$(ls -A /docs 2>/dev/null)" ] && \
     [ -d /template ]; then
    echo "[docmd] /docs is empty — seeding demo template from /template"
    cp -r /template/. /docs/
    chown -R "$DOCS_UID:$DOCS_GID" /docs 2>/dev/null || true
  fi

  # Re-exec as the detected uid:gid so all subsequent writes are correctly owned.
  exec su-exec "$DOCS_UID:$DOCS_GID" "$0" "$@"
fi

# ── already the right user (re-exec path lands here) ────────────────────────
exec docmd "$@"
#!/bin/sh
# docmd Docker healthcheck
#
# `docmd serve` (the image's default command) listens on exactly one port,
# PORT (default 3000), and answers GET /healthz with 200 once the site is
# built (503 while the first build runs).
if curl -fs --connect-timeout 2 "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null 2>&1; then
  exit 0
fi

# Overridden command `dev`: it has no /healthz and may auto-increment its
# port (3000, 3001, ...) if the default port is in use, so probe a small
# range. Returns 0 as soon as any port responds.
for port in 3000 3001 3002 3003 3004 3005; do
  if curl -fs --connect-timeout 2 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
    exit 0
  fi
done
exit 1

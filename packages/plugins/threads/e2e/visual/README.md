# Visual and contrast suite

Screenshots and `@axe-core/playwright` colour-contrast checks of the threads UI: the default template with no theme
and with the retro, ruby and sky themes, and the summer template, each in light and dark mode (10 looks; an inline
card and the open panel per look, so 20 pictures, plus 10 contrast checks).

It is not part of the default `pnpm test:e2e` run. The `visual` project exists only when `THREADS_E2E_VISUAL=1`; it
starts one dev server per look (ports 4180 to 4184) next to the usual one.

```sh
THREADS_E2E_VISUAL=1 pnpm exec playwright test --project visual
```

## Baselines

The pictures in `__screenshots__` were made by Chromium on Linux (the official Playwright image), and only match
there: fonts and anti-aliasing differ on other systems, so do not commit pictures made on macOS or Windows. Run the
suite in CI on Linux, or refresh the baselines with a browser from the image (keep its version equal to
`@playwright/test`):

```sh
docker run -d --rm --name threads-pw --add-host=host.docker.internal:host-gateway -p 3000:3000 \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  /bin/sh -c "cd /tmp && npx -y playwright@1.65.1 run-server --port 3000 --host 0.0.0.0"
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3000/ THREADS_E2E_VISUAL=1 THREADS_E2E_VISUAL_HOST=host.docker.internal \
  pnpm exec playwright test --project visual --update-snapshots -g "card|panel"
```

The tests run on your machine and only the browser runs in the container, so the servers are the workspace build. If
the container runs on another machine, forward the servers' ports to it and run the container with `--network host`
instead (then `THREADS_E2E_VISUAL_HOST` is not needed).

The fonts are not fetched (every request that is not to the servers is aborted), the clock is fixed and animations
are off. The page is the e2e fixture with its three seeded threads, and nothing is written, so a picture changes
only when the UI does.

/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * @package     @docmd/core (and ecosystem)
 * @website     https://docmd.io
 * @repository  https://github.com/docmd-io/docmd
 * @license     MIT
 * @copyright   Copyright (c) 2025-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

import { execSync } from 'child_process';
import { TUI } from '@docmd/api';

// M-11: how long to wait after SIGTERM before escalating to SIGKILL.
// Docmd's dev server installs a graceful-shutdown handler on SIGTERM
// (closes watchers, the http server, the WebSocket server, and the
// worker pool). `docmd stop` waits this long for the process to exit
// on its own before sending the uncatchable SIGKILL.
const SIGTERM_GRACE_MS = 5000;

/**
 * Poll `pid` until it has exited or `timeoutMs` has elapsed.
 * Returns `true` if the process exited within the window, `false`
 * if it was still alive at the timeout (caller should escalate to
 * SIGKILL). Polls every 100ms to keep the perceived latency low.
 */
export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // signal 0 = existence check; throws ESRCH if the pid is gone
      process.kill(pid, 0);
    } catch (err: any) {
      if (err && err.code === 'ESRCH') return true;
      // EPERM means the process exists but we can't signal it — treat
      // as still alive and let the outer catch handle escalation.
      return false;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Whether a `ps` command line belongs to a docmd dev, serve or live process.
 * Matches `docmd dev|live|serve`, direct `bin/docmd.js` invocations and the
 * dev-script forms.
 */
export function isDocmdCommand(command: string): boolean {
    return command.includes('docmd dev') ||
        command.includes('docmd serve') ||
        command.includes('docmd live') ||
        command.includes('docmd-live') ||
        command.includes('bin/docmd.js') ||
        command.includes('bin/docmd-live.js') ||
        command.includes('dev.js live') ||
        command.includes('dev.js dev');
}

/**
 * find and kill running docmd processes
 * If port is provided, only kill the process listening on that port.
 * If force is true, also kill serve processes on common docmd ports.
 */
export async function stopServer(port: any, force: boolean = false) {
    // Common ports used by docmd dev server
    const commonPorts = [3000, 3001, 8080, 8081];

    if (port) {
        TUI.section(`Stopping port ${port}`);
        try {
            // Try lsof first
            let pid = '';
            try {
                pid = execSync(`lsof -t -i:${port}`).toString().trim();
            } catch {
                // Fallback to fuser if lsof fails
                try {
                    pid = execSync(`fuser -k ${port}/tcp 2>/dev/null`).toString().trim();
                } catch {
                    // Fallback to netstat
                    const netstat = execSync(`netstat -anp tcp 2>/dev/null | grep LISTEN | grep ${port}`).toString();
                    const match = netstat.match(/(\d+)\/\w+/);
                    if (match) pid = match[1];
                }
            }
            if (pid) {
                TUI.step(`Found process ${pid} on port ${port}`, 'WAIT');
                const pidNum = Number(pid);
                // M-11: send SIGTERM first, wait up to SIGTERM_GRACE_MS for the
                // process to exit on its own (the dev server installs a
                // graceful shutdown handler), and only then escalate to SIGKILL.
                try {
                    process.kill(pidNum, 'SIGTERM');
                } catch (err: any) {
                    TUI.step(`Failed to send SIGTERM to PID ${pid}: ${err.message}`, 'FAIL', TUI.red);
                }
                if (await waitForExit(pidNum, SIGTERM_GRACE_MS)) {
                    TUI.footer();
                    TUI.success(`Docmd instance on port ${port} stopped gracefully.`);
                    return;
                }
                try {
                    process.kill(pidNum, 'SIGKILL');
                } catch (err: any) {
                    TUI.step(`Failed to send SIGKILL to PID ${pid}: ${err.message}`, 'FAIL', TUI.red);
                }
                TUI.footer();
                TUI.success(`Docmd instance on port ${port} has been stopped.`);
                return;
            }
        } catch {
            // No process found
        }
        TUI.step(`No instance found on port ${port}`, 'SKIP');
        TUI.footer();
        return;
    }

    TUI.section('Stopping all instances');

    try {
        // Get all processes with PIDs and full command lines
        // We filter for docmd but exclude the grep itself and the current process
        const currentPid = process.pid;

        // Use ps to list processes. -ax to see all, -o pid,command for details.
        const output = execSync('ps -ax -o pid,command').toString();
        const lines = output.split('\n');

        const targets = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const [pidStr, ...cmdParts] = trimmed.split(/\s+/);
            const pid = parseInt(pidStr, 10);
            const command = cmdParts.join(' ');

            // Check if it's a docmd process (dev or live) but not the current one
            // We look for 'docmd dev', 'docmd live', or direct bin/docmd.js execution
            const isDocmd = isDocmdCommand(command);

            // With --force, also detect 'serve' processes on common docmd ports
            let isServe = false;
            if (force) {
                isServe = (command.includes('serve ') || command.includes('serve -p')) &&
                    commonPorts.some(p => command.includes(`-p ${p}`) || command.includes(`--port ${p}`));
            }

            const isNotCurrent = pid !== currentPid && command.indexOf('stop') === -1;

            if ((isDocmd || isServe) && isNotCurrent) {
                targets.push({ pid, command, type: isServe ? 'serve' : 'docmd' });
            }
        }

        if (targets.length === 0) {
            TUI.step('No running docmd instances found', 'SKIP');
            TUI.footer();
            return;
        }

        for (const target of targets) {
            try {
                TUI.step(`Stopping ${target.type} PID ${target.pid} (SIGTERM)`, 'WAIT');
                process.kill(target.pid, 'SIGTERM');
            } catch {
                // If SIGTERM fails, skip the graceful wait
            }
            // M-11: give the graceful-shutdown handler time to run before
            // escalating to SIGKILL.
            if (!(await waitForExit(target.pid, SIGTERM_GRACE_MS))) {
                try {
                    process.kill(target.pid, 'SIGKILL');
                    TUI.step(`Killed ${target.type} PID ${target.pid} (SIGKILL after grace)`, 'DONE');
                } catch (err2: any) {
                    TUI.step(`Failed to kill PID ${target.pid}: ${err2.message}`, 'FAIL', TUI.red);
                }
            } else {
                TUI.step(`Stopped ${target.type} PID ${target.pid} gracefully`, 'DONE');
            }
        }

        TUI.footer();
        TUI.success('All docmd instances have been stopped.');

    } catch (error: any) {
        TUI.error('Error during stop', error.message);
    }
}
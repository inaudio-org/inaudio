// `npm start`: runs `electron-forge start`, passing any extra arguments through.
//
// Two Linux-only additions, for this dev run only (packaged builds decide for themselves):
// - Inside a Flatpak (e.g. the Flathub build of VS Code) Chromium cannot sandbox itself:
//   Flatpak blocks nested user namespaces and setuid, so Electron falls back to the SUID
//   `chrome-sandbox` helper and aborts. There, pass `--no-sandbox`.
// - On a Wayland session with XWayland running, start on X11 (`--ozone-platform=x11`) unless
//   Settings › Overlay › "Use XWayland for floating windows" is off. Chromium picks its display
//   backend before app code runs, and a packaged app relaunches itself for this, which cannot
//   work under Forge's dev server.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const forge = require.resolve('@electron-forge/cli/dist/electron-forge.js');

const linux = process.platform === 'linux';
const passthrough = process.argv.slice(2);
const has = (flag) => passthrough.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

/** The saved XWayland choice; on when there is no settings file yet. */
function xwaylandWanted() {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  try {
    const settings = JSON.parse(readFileSync(path.join(config, 'Inaudio', 'settings.json'), 'utf8'));
    return settings?.system?.linuxXWayland !== false;
  } catch {
    return true;
  }
}

const appArgs = [];
if (linux && existsSync('/.flatpak-info') && !has('--no-sandbox')) {
  appArgs.push('--no-sandbox');
  console.warn('Running inside Flatpak: starting Electron with --no-sandbox (dev only).');
}
const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
if (linux && wayland && process.env.DISPLAY && !has('--ozone-platform') && xwaylandWanted()) {
  appArgs.push('--ozone-platform=x11');
  console.warn('Wayland session: starting through XWayland so the floating windows can be placed (dev only).');
}

const args = [forge, 'start', ...passthrough];
if (appArgs.length) args.push(...(passthrough.includes('--') ? [] : ['--']), ...appArgs);

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

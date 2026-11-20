import { app } from 'electron';
import os from 'node:os';
import type { SystemAudioSupport } from '@shared/domain/capture';
import type { LinuxDisplay, OverlaySupport } from '@shared/domain/system';

const WINDOWS = process.platform === 'win32';
const MACOS = process.platform === 'darwin';
const LINUX = process.platform === 'linux';

/** The desktop session is Wayland, whether or not this process talks to it directly. */
function waylandSession(): boolean {
  return LINUX && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
}

/** This process was started on X11 (XWayland inside a Wayland session). Fixed at launch. */
function onX11(): boolean {
  return LINUX && app.commandLine.getSwitchValue('ozone-platform') === 'x11';
}

/** XWayland is running, so an X11 client can be started. */
function xwaylandAvailable(): boolean {
  return LINUX && !!process.env.DISPLAY;
}

/**
 * True when this process is a native Wayland client: the compositor places its windows,
 * ignores stay-on-top, and never reports the pointer. Under XWayland none of that applies.
 */
export function isWayland(): boolean {
  return waylandSession() && !onX11();
}

/** How this Linux process reaches the display, for Settings. Null elsewhere. */
export function linuxDisplay(): LinuxDisplay | null {
  if (!LINUX) return null;
  return {
    session: waylandSession() ? 'wayland' : 'x11',
    xwayland: waylandSession() && onX11(),
    xwaylandAvailable: xwaylandAvailable(),
    desktop: (process.env.XDG_CURRENT_DESKTOP ?? '').split(':')[0]?.slice(0, 40) ?? '',
  };
}

/** Set on the relaunched process so a failed switch can never loop. */
const RELAUNCH_MARK = 'INAUDIO_XWAYLAND_RELAUNCH';

/**
 * Chromium picks its display backend before any app code runs (an appended switch is too
 * late), so moving to XWayland means starting again with `--ozone-platform=x11`. Returns
 * whether this process should relaunch: a packaged app on a Wayland session with XWayland
 * running, the setting on, and not already relaunched once.
 */
export function relaunchUnderXWayland(wanted: () => boolean): boolean {
  if (!app.isPackaged || !waylandSession() || onX11() || !xwaylandAvailable()) return false;
  if (process.env[RELAUNCH_MARK] || !wanted()) return false;
  process.env[RELAUNCH_MARK] = '1';
  app.relaunch(relaunchOptions(true));
  return true;
}

/**
 * How to start this app again: the same arguments, on XWayland only when `xwayland` is wanted
 * and the session has it, so a changed setting takes effect on restart.
 */
export function relaunchOptions(xwayland: boolean): Electron.RelaunchOptions {
  const args = process.argv.slice(1).filter((arg) => !arg.startsWith('--ozone-platform'));
  if (xwayland && waylandSession() && xwaylandAvailable()) args.push('--ozone-platform=x11');
  // An AppImage's own binary lives in a mount that goes away when this process exits.
  return { execPath: process.env.APPIMAGE || process.execPath, args };
}

/**
 * What the running platform allows the overlay to do. Each flag mirrors a documented
 * Electron limitation, so the UI can say what is unavailable instead of failing quietly.
 */
export function overlaySupport(): OverlaySupport {
  const wayland = isWayland();
  return {
    // setAlwaysOnTop is ignored on Wayland; an unfocusable window stays on top instead.
    alwaysOnTop: !wayland,
    // setOpacity does nothing on Linux.
    opacity: WINDOWS || MACOS,
    // IgnoreMouseEventsOptions.forward is macOS and Windows only, so hovering to arm
    // the controls cannot work anywhere else.
    hover: WINDOWS || MACOS,
    // screen.getCursorScreenPoint is not supported on Wayland.
    cursor: !wayland,
    // Wayland compositors ignore a client's window positions, so nothing can be dragged.
    place: !wayland,
  };
}

/** The Chromium feature that turns on PulseAudio loopback for screen share; off by default in M152. */
export const LINUX_LOOPBACK_FEATURE = 'PulseaudioLoopbackForScreenShare';

/**
 * What Chromium 152 can do with system audio here. Mirrors `IsSystemLoopbackCaptureSupported`
 * and `IsRestrictOwnAudioSupported` in media/base/media_switches.cc, so the UI says what is
 * missing before a capture comes back with a dead track.
 */
export function systemAudioSupport(): SystemAudioSupport {
  if (WINDOWS) {
    // Process loopback, which filters our own playback, starts with Windows 11 (build 22000).
    const build = Number(os.release().split('.')[2] ?? 0);
    return { available: true, mode: 'loopback', ownAudioFiltered: build >= 22_000, reason: '' };
  }
  if (MACOS) {
    // A custom picker never starts the CoreAudio tap (electron/electron#52738); the system
    // picker that works around it needs macOS 15.
    const major = Number(process.getSystemVersion().split('.')[0] ?? 0);
    return major >= 15
      ? { available: true, mode: 'system-picker', ownAudioFiltered: true, reason: '' }
      : { available: false, mode: 'none', ownAudioFiltered: false, reason: 'System audio needs macOS 15 or later.' };
  }
  if (LINUX) return { available: true, mode: 'loopback', ownAudioFiltered: false, reason: '' };
  return { available: false, mode: 'none', ownAudioFiltered: false, reason: 'System audio is not supported on this platform.' };
}

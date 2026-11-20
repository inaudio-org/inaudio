import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { CompanionPosition, CompanionSettings } from '@shared/domain/companion';
import { APP_ORIGIN } from '../security/app-protocol';
import type { FocusTarget } from '../services/focus-probe';

export const COMPANION_SIZE = 240;
export const COMPANION_HEIGHT = 180;

export function createCompanionWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: COMPANION_SIZE,
    height: COMPANION_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    roundedCorners: true,
    title: 'Inaudio companion',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !!MAIN_WINDOW_VITE_DEV_SERVER_URL,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(new URL('companion.html', MAIN_WINDOW_VITE_DEV_SERVER_URL).href);
  } else {
    void win.loadURL(`${APP_ORIGIN}/companion.html`);
  }
  return win;
}

/** True when the companion was dragged somewhere and sits there instead of at `position`. */
export function companionIsCustom(companion: Pick<CompanionSettings, 'customX' | 'customY'>): boolean {
  return companion.customX !== null && companion.customY !== null;
}

/** Tall focused fields (a whole document) are no place to perch above; the cursor is used instead. */
const MAX_ANCHOR_FIELD_HEIGHT = 160;

/** The horizontal point and vertical span "Above active area" sits against. */
function activeArea(focus: FocusTarget | null | undefined): { x: number; top: number; bottom: number } {
  if (focus?.kind === 'caret') return { x: focus.x, top: focus.y, bottom: focus.y + focus.height };
  if (focus?.kind === 'element' && focus.height <= MAX_ANCHOR_FIELD_HEIGHT) {
    return { x: focus.x + Math.round(focus.width / 2), top: focus.y, bottom: focus.y + focus.height };
  }
  const cursor = screen.getCursorScreenPoint();
  return { x: cursor.x, top: cursor.y, bottom: cursor.y };
}

export function placeCompanion(
  win: BrowserWindow,
  position: CompanionPosition,
  scale: number,
  options: Pick<CompanionSettings, 'edgeMargin' | 'keepAwayFromText'> & Partial<Pick<CompanionSettings, 'customX' | 'customY'>> = {
    edgeMargin: 56,
    keepAwayFromText: true,
  },
  /** Where the user is typing, when known. Only "Above active area" uses it. */
  focus?: FocusTarget | null,
): void {
  const size = Math.round(128 * scale);
  const windowWidth = Math.max(size + 48, COMPANION_SIZE);
  const windowHeight = Math.max(size + 52, COMPANION_HEIGHT);
  const current = win.getBounds();
  if (options.customX != null && options.customY != null) {
    // Dropped by hand: its centre, as shares of the screen it was left on.
    const here = screen.getDisplayNearestPoint({ x: current.x + Math.round(current.width / 2), y: current.y + Math.round(current.height / 2) }).workArea;
    const nextX = Math.round(Math.max(here.x, Math.min(here.x + options.customX * here.width - windowWidth / 2, here.x + here.width - windowWidth)));
    const nextY = Math.round(Math.max(here.y, Math.min(here.y + options.customY * here.height - windowHeight / 2, here.y + here.height - windowHeight)));
    if (current.x === nextX && current.y === nextY && current.width === windowWidth && current.height === windowHeight) return;
    win.setBounds({ x: nextX, y: nextY, width: windowWidth, height: windowHeight }, false);
    return;
  }
  const focusArea = position === 'focus-area';
  const area = focusArea ? activeArea(focus) : null;
  const display = screen.getDisplayNearestPoint(area ? { x: area.x, y: area.top } : screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const margin = Math.min(options.edgeMargin, Math.floor(Math.min(width, height) / 3));
  const left = position.endsWith('left') ? x + margin : x + width - windowWidth - margin;
  const top = position.startsWith('top') ? y + margin : y + height - windowHeight - margin;
  const nearMicrophone = position === 'near-microphone';
  const focusGap = options.keepAwayFromText ? 72 : 36;
  const unclampedX = area
    ? area.x - Math.round(windowWidth / 2)
    : nearMicrophone
      ? x + Math.round(width / 2) - Math.round(windowWidth / 2)
      : left;
  const focusY = !area
    ? 0
    : area.top - windowHeight - focusGap >= y + margin
      ? area.top - windowHeight - focusGap
      : area.bottom + focusGap;
  const unclampedY = area
    ? focusY
    : nearMicrophone
      ? y + margin
      : top;
  const nextX = Math.max(x + margin, Math.min(unclampedX, x + width - windowWidth - margin));
  const nextY = Math.max(y + margin, Math.min(unclampedY, y + height - windowHeight - margin));
  // Focus tracking calls this four times a second; an unmoved window is left alone.
  if (current.x === nextX && current.y === nextY && current.width === windowWidth && current.height === windowHeight) return;
  win.setBounds({ x: nextX, y: nextY, width: windowWidth, height: windowHeight }, false);
}

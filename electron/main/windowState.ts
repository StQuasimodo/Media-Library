import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserWindow, Rectangle } from 'electron';

export interface SavedWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const DEFAULT_STATE: SavedWindowState = { width: 1440, height: 900, maximized: false };
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 680;

function overlaps(a: Rectangle, b: Rectangle): boolean {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap > 80 && yOverlap > 60;
}

/** Reads the saved window geometry, discarding it when it no longer fits a display. */
export function loadWindowState(file: string, workAreas: Rectangle[]): SavedWindowState {
  if (!existsSync(file)) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SavedWindowState>;
    const width = Math.max(MIN_WIDTH, Math.round(Number(parsed.width) || DEFAULT_STATE.width));
    const height = Math.max(MIN_HEIGHT, Math.round(Number(parsed.height) || DEFAULT_STATE.height));
    const maximized = parsed.maximized === true;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      const rect: Rectangle = { x: Math.round(parsed.x), y: Math.round(parsed.y), width, height };
      if (workAreas.some((area) => overlaps(rect, area))) {
        return { width, height, x: rect.x, y: rect.y, maximized };
      }
    }
    return { width, height, maximized };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveWindowState(file: string, window: BrowserWindow): void {
  try {
    const maximized = window.isMaximized();
    const bounds = maximized ? window.getNormalBounds() : window.getBounds();
    const state: SavedWindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch {
    // Window geometry is a convenience; never block shutdown on it.
  }
}

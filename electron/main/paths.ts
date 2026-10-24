import { join } from 'node:path';

export interface AppPaths {
  userData: string;
  /** Root the user sees in Settings → "数据目录". */
  dataDirectory: string;
  dbFile: string;
  imagesDir: string;
  backupsDir: string;
  logsDir: string;
  logFile: string;
  credentialsFile: string;
  windowStateFile: string;
  exportsDir: string;
}

/**
 * All mutable state lives under Electron's per-user `userData` directory, which
 * survives app upgrades. Uninstalling does not silently delete it.
 */
export function resolveAppPaths(userData: string): AppPaths {
  return {
    userData,
    dataDirectory: userData,
    dbFile: join(userData, 'library.db'),
    imagesDir: join(userData, 'images'),
    backupsDir: join(userData, 'backups'),
    logsDir: join(userData, 'logs'),
    logFile: join(userData, 'logs', 'app.log'),
    credentialsFile: join(userData, 'credentials.json'),
    windowStateFile: join(userData, 'window-state.json'),
    exportsDir: join(userData, 'exports'),
  };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppInfo } from '@shared/api';
import type { AppSettings } from '@shared/types';
import type { LibraryRefreshStatus } from '@shared/libraryRefresh';
import { api, describeError } from './api';

interface AppStateValue {
  info: AppInfo | null;
  settings: AppSettings;
  loading: boolean;
  error: string | null;
  /** Bumped after every mutation so dependent screens refetch. */
  version: number;
  invalidate: () => void;
  applySettings: (settings: AppSettings) => void;
  refreshInfo: () => Promise<void>;
  libraryRefresh: LibraryRefreshStatus | null;
  refreshPollingError: string | null;
  startLibraryRefresh: () => Promise<void>;
  cancelLibraryRefresh: () => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  metadataLanguage: 'zh-CN',
  defaultSort: 'collected_desc',
  posterDensity: 'comfortable',
  motionPreference: 'system',
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [libraryRefresh, setLibraryRefresh] = useState<LibraryRefreshStatus | null>(null);
  const [refreshPollingError, setRefreshPollingError] = useState<string | null>(null);
  const refreshRef = useRef<LibraryRefreshStatus | null>(null);
  const lastFinished = useRef(0);
  const invalidate = useCallback(() => setVersion(current => current + 1), []);
  const observeRefresh = useCallback((next: LibraryRefreshStatus) => {
    const previous = refreshRef.current;
    if (previous && (next.id < previous.id || next.id === previous.id && previous.finishedAt && !next.finishedAt)) return;
    refreshRef.current = next; setLibraryRefresh(next); setRefreshPollingError(null);
    if (next.id > lastFinished.current && next.finishedAt) { lastFinished.current = next.id; invalidate(); }
  }, [invalidate]);
  const startLibraryRefresh = useCallback(async () => { observeRefresh(await api.library.refreshAll()); }, [observeRefresh]);
  const cancelLibraryRefresh = useCallback(async () => { observeRefresh(await api.library.cancelRefresh()); }, [observeRefresh]);

  // The process owns the task; polling here keeps other routes up to date too.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.library.refreshStatus();
        if (!live) return;
        observeRefresh(next);
        if (next.busy) timer = setTimeout(() => void poll(), 800);
      } catch (cause) {
        if (live) { setRefreshPollingError(describeError(cause)); timer = setTimeout(() => void poll(), 2000); }
      }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [libraryRefresh?.busy, observeRefresh]);

  const refreshInfo = useCallback(async () => {
    try {
      const next = await api.app.info();
      setInfo(next);
      setSettings(next.settings);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo]);

  // Motion preference and poster density are applied at the document level so
  // every screen (and CSS) reacts without prop drilling.
  useEffect(() => {
    document.documentElement.dataset.motion =
      settings.motionPreference === 'reduce'
        ? 'reduce'
        : settings.motionPreference === 'full'
          ? 'full'
          : 'system';
    document.documentElement.dataset.density = settings.posterDensity;
  }, [settings.motionPreference, settings.posterDensity]);

  const value = useMemo<AppStateValue>(
    () => ({
      info,
      settings,
      loading,
      error,
      version,
      invalidate,
      libraryRefresh, refreshPollingError, startLibraryRefresh, cancelLibraryRefresh,
      applySettings: (next) => {
        setSettings(next);
        setVersion((current) => current + 1);
      },
      refreshInfo,
    }),
    [info, settings, loading, error, version, refreshInfo, invalidate, libraryRefresh, refreshPollingError, startLibraryRefresh, cancelLibraryRefresh],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState must be used inside AppStateProvider');
  return context;
}

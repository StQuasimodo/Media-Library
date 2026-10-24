import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AppInfo } from '@shared/api';
import type { AppSettings } from '@shared/types';
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
      invalidate: () => setVersion((current) => current + 1),
      applySettings: (next) => {
        setSettings(next);
        setVersion((current) => current + 1);
      },
      refreshInfo,
    }),
    [info, settings, loading, error, version, refreshInfo],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState must be used inside AppStateProvider');
  return context;
}

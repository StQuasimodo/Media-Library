export interface LibraryRefreshStatus {
  id: number;
  busy: boolean;
  phase: 'idle' | 'quark' | 'metadata';
  cancelRequested: boolean;
  cancelled: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  completed: number;
  updated: number;
  failed: number;
  skipped: number;
  imageWarnings: number;
  imageWarningDetails: Array<{ filmId: string; title: string; message: string }>;
  currentTitle: string | null;
  message: string | null;
  quark: { state: 'pending' | 'running' | 'updated' | 'partial' | 'failed' | 'skipped'; message: string | null };
  errors: Array<{ filmId: string; title: string; message: string }>;
}

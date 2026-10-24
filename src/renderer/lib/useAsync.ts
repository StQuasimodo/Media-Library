import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Small async data hook: keeps the previous value visible while reloading so
 * the UI never flashes an empty layout on every mutation.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (cancelled || id !== requestId.current) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setError(describeError(cause));
      })
      .finally(() => {
        if (cancelled || id !== requestId.current) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

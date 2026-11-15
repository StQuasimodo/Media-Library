import { useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocation } from 'react-router-dom';
import { browseMemory } from './browseMemory';
/** Keep browsing filters per history entry without changing the database. */
export function useBrowseState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { key } = useLocation();
  const read = (): T => { const saved = browseMemory.read(key)?.values[name]; return saved !== undefined ? saved as T : typeof initial === 'function' ? (initial as () => T)() : initial; };
  const [state, setState] = useState(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  if (state.key !== key) setState({ key, value });
  useLayoutEffect(() => { browseMemory.value(key, name, value); }, [key, name, value]);
  return [value, next => setState(current => ({ key, value: typeof next === 'function' ? (next as (previous: T) => T)(current.key === key ? current.value : value) : next }))];
}

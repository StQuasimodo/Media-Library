import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/icons';

type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, kind, message }]);
    const timer = window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, kind === 'error' ? 7000 : 3800);
    timers.current.push(timer);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message: string) => push(message, 'success'),
      error: (message: string) => push(message, 'error'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast${item.kind === 'error' ? ' is-error' : ''}${
              item.kind === 'success' ? ' is-success' : ''
            }`}
          >
            <span className="toast-icon">
              <Icon
                name={item.kind === 'error' ? 'alert' : item.kind === 'success' ? 'check' : 'info'}
                size={16}
              />
            </span>
            <span className="toast-message">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

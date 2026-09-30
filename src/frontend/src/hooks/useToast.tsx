import { useState, useCallback } from 'react';

import type { Toast } from '../types';

let lastToastId = 0;

// Toasts shown together (several books queued in one status update) need distinct
// ids: a shared id is a duplicate React key, and React can leave one of those toasts
// on screen after its timer removes it.
export const nextToastId = (): string => {
  lastToastId += 1;
  return `toast-${lastToastId}`;
};

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback(
    (
      message: string,
      type: 'info' | 'success' | 'error' = 'info',
      persistent: boolean = false,
    ): string => {
      const id = nextToastId();
      setToasts((prev) => [...prev, { id, message, type }]);

      if (!persistent) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
      }

      return id;
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, removeToast };
};

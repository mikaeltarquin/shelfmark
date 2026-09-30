// Library browser view choices (sort, layout), remembered per browser as a convenience.
// Storage can be blocked or cleared, so reading falls back to nothing and writing may fail.

export const loadStoredPrefs = (key: string): object | null => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
};

export const saveStoredPrefs = (key: string, value: object): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered, which is fine.
  }
};

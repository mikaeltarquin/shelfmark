import { useState } from 'react';

import { getStoredThemePreference, setThemePreference } from '../../utils/themePreference';

const ORDER = ['light', 'dark', 'auto'] as const;
type Theme = (typeof ORDER)[number];

const LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  auto: 'Auto (System)',
};

// Heroicons: sun, moon, computer.
const ICONS: Record<Theme, string> = {
  light:
    'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  dark: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
  auto: 'M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25',
};

const readTheme = (): Theme => {
  const stored = getStoredThemePreference();
  return ORDER.find((theme) => theme === stored) ?? 'auto';
};

/** One click through Light, Dark and Auto; the same preference as Settings > Theme. */
export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(next);
        setTheme(next);
      }}
      className="hover-action rounded-full p-2 text-gray-900 transition-colors dark:text-gray-100"
      title={`Theme: ${LABELS[theme]} (click for ${LABELS[next]})`}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}`}
    >
      <svg
        className="h-5 w-5"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[theme]} />
      </svg>
    </button>
  );
};

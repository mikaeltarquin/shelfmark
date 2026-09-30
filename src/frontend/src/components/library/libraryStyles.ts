export const inputClass =
  'rounded-lg border border-(--border-muted) bg-(--bg-soft) px-3 py-2 text-sm focus:border-sky-500 focus:outline-hidden';

export const segmentClass = (selected: boolean): string =>
  `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    selected
      ? 'bg-emerald-600 text-white'
      : 'border border-(--border-muted) bg-(--bg-soft) hover:bg-(--hover-surface)'
  }`;

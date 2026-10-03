/** Narrator names from a release or a library copy: a list, or one string naming several. */
export const narratorNames = (raw: unknown): string[] => {
  let names: string[] = [];
  if (Array.isArray(raw)) {
    names = raw.filter((name): name is string => typeof name === 'string');
  } else if (typeof raw === 'string') {
    names = raw.split(/\s*[,;&]\s*/);
  }
  return names.map((name) => name.trim()).filter(Boolean);
};

/** A badge's worth of narrators: the first, and how many more ("Andrew Scott +9"). */
export const shortNarrators = (names: readonly string[]): string =>
  names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? '');

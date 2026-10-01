import type { SuggestionKind } from '../services/api';

const LABELS: Record<SuggestionKind, string> = {
  book: 'Book',
  series: 'Series',
  author: 'Author',
};

// Outline icons (24px grid) for what a search suggestion is: a book, a series, an author.
const PATHS: Record<SuggestionKind, string> = {
  book: 'M12 6.04A8.97 8.97 0 0 0 6 3.75c-1.05 0-2.06.18-3 .51v14.25A8.99 8.99 0 0 1 6 18c2.3 0 4.4.87 6 2.29m0-14.25a8.97 8.97 0 0 1 6-2.29c1.05 0 2.06.18 3 .51v14.25A8.99 8.99 0 0 0 18 18a8.97 8.97 0 0 0-6 2.29m0-14.25v14.25',
  series:
    'M6 6.88V5.25A2.25 2.25 0 0 1 8.25 3h7.5A2.25 2.25 0 0 1 18 5.25v1.63M6 6.88c.24-.08.49-.13.75-.13h10.5c.26 0 .51.05.75.13M6 6.88A2.25 2.25 0 0 0 4.5 9v.13M18 6.88A2.25 2.25 0 0 1 19.5 9v.13m-15 0c.24-.08.49-.13.75-.13h13.5c.26 0 .51.05.75.13m-15 0A2.25 2.25 0 0 0 3 11.25v6.5A2.25 2.25 0 0 0 5.25 20h13.5A2.25 2.25 0 0 0 21 17.75v-6.5a2.25 2.25 0 0 0-1.5-2.12',
  author:
    'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.12a7.5 7.5 0 0 1 15 0A17.93 17.93 0 0 1 12 21.75c-2.68 0-5.22-.58-7.5-1.63Z',
};

/** The icon for a suggestion's kind, labelled for screen readers. */
export const SuggestionKindIcon = ({ kind }: { kind: SuggestionKind }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    className="h-5 w-5 shrink-0 opacity-60"
    role="img"
    aria-label={LABELS[kind]}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={PATHS[kind]} />
  </svg>
);

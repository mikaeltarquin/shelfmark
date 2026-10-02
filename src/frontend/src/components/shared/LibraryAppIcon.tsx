/**
 * "Open in your library app" (Audiobookshelf, Calibre-Web): books on a shelf with an
 * arrow leaving it. Used wherever Shelfmark links out to a library, so it reads apart
 * from the Library browser (a building) and from links to a release's source page.
 */
export const LibraryAppIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 21h14.5" />
    <path d="M3 21V6.5h3.75V21" />
    <path d="M7.75 21V9.5h3.75V21" />
    <path d="m12.6 10.6 3.3-.9 3 11.1" />
    <path d="M16.5 2.75h4.75V7.5" />
    <path d="m21.25 2.75-5 5" />
  </svg>
);

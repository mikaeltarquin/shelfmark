/** A mouse, for MyAnonamouse (outline, 24px grid like the other header icons). */
export const MouseIcon = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth="1.5"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 17.5c0-4.4 3.6-8 8-8 3.2 0 6 1.9 7.3 4.6l2.4 1.2a1.5 1.5 0 0 1-.7 2.8H3.6a.6.6 0 0 1-.6-.6Z" />
    <circle cx="9.25" cy="7.25" r="3.25" />
    <circle cx="15.5" cy="13.25" r=".9" fill="currentColor" stroke="none" />
    <path d="M3.2 18c-1.4.5-1.9 2-.9 2.9.9.8 2.6.6 4.7.6" />
  </svg>
);

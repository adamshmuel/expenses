// Small inline SVG icons. Drawn rather than imported so they scale and take
// their colour from the surrounding text.

/** The wordmark's shekel tile. A currency sign says "money app" faster than
 *  any icon of a wallet does. */
export const Mark = () => (
  <span className="mark" aria-hidden="true">
    &#8362;
  </span>
)

export const AlertIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </svg>
)

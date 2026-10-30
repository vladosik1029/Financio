/** Набор линейных иконок 24×24, цвет берётся из currentColor */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  trade: "M4 19V5M4 19h16M8 15l3-4 3 2 5-6",
  portfolio: "M4 7h16v12H4zM9 7V5h6v2M4 12h16",
  rating: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  chevron: "M6 9l6 6 6-6",
  check: "M5 12l5 5 9-10",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  close: "M6 6l12 12M18 6 6 18",
  admin: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6zM9 12l2 2 4-4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

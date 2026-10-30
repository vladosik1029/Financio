/** Знак iZZi: молния в круге с фирменным градиентом */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="izzi-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a3c" />
          <stop offset="1" stopColor="#ff387d" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#izzi-grad)" />
      <path d="M13.6 5 8 13.2l3.3.7-1 4.9 5.7-8.1-3.2-.7z" fill="#fff" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

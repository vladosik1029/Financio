export function formatPrice(value: number, precision: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(fraction: number, digits = 4): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

/** Ошибку API превращаем в ключ перевода */
export function errorKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "internal";
  return `errors.${code}`;
}

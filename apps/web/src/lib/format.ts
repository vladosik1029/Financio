export function formatPrice(value: number, precision: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(fraction: number, digits = 4): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

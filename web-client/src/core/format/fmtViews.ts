// Compact view/count formatting like Telegram: 9200 → "9.2K", 1_500_000 → "1.5M".
// Whole thousands/millions drop the decimal (5000 → "5K", 2_000_000 → "2M").
export function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(n)
}

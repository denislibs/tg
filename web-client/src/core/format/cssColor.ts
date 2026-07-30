// src/core/cssColor.ts
//
// CSS-нативная замена MUI `alpha(color, frac)`: `alpha()` парсит цвет в JS
// (decomposeColor) и падает на `var(--tg-*)`-строках. `color-mix()` делает то же
// в самом CSS и принимает любой валидный цвет, включая CSS-переменные. Для
// непрозрачного исходного цвета `color-mix(in srgb, C p%, transparent)` даёт
// ровно `rgba(C, p/100)` — поведенчески эквивалентно `alpha(C, p/100)`.
export function withAlpha(color: string, frac: number): string {
  const pct = +(frac * 100).toFixed(4)
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

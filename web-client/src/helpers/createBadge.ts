// Порт tweb `src/helpers/createBadge.ts` (812502980) — 1:1. Пустой бейдж
// (`is-badge-empty`) разметки `_badge.scss`: число в него кладёт владелец.
export default function createBadge(tag: 'span' | 'div', size: number, color: string) {
  const badge = document.createElement(tag)
  badge.className = `badge badge-${size} badge-${color} is-badge-empty`
  return badge
}

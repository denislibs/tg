// Порт tweb `src/helpers/setBadgeContent.ts` (812502980) — 1:1.
import replaceContent from '@helpers/dom/replaceContent'

export default function setBadgeContent(badge: HTMLElement, content: Parameters<typeof replaceContent>[1]) {
  replaceContent(badge, content)
  badge.classList.toggle('is-badge-empty', !content)
}

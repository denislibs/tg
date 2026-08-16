// Ванильный аналог tweb `components/icon.ts` поверх нашей карты глифов
// (`@core/tgico-icons`). React-версия того же — `components/TgIcon.tsx`.
// Отличие от tweb: нет ветки RTL-отражения (`IconsReverse` не портирован).
import { glyph, type IconName } from '@core/tgico-icons'

export default function icon(name: IconName, ...classes: string[]) {
  const span = document.createElement('span')
  span.classList.add('tgico', ...classes)
  span.textContent = glyph(name)
  return span
}

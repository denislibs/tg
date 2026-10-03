/**
 * Порт tweb `components/icon.ts` — `span.tgico` с глифом шрифта tgico. Один
 * модуль на всех ванильных потребителей, как в оригинале: медиавьювер
 * (`mediaViewer/base.ts` — `btnIcon`/`replaceButtonIcon` строятся поверх),
 * плеер (`lib/mediaPlayer`), враппер видео (`wrappers/video.ts`, ванильный бабл)
 * и rich-text (`lib/richtext/wrapRichText.ts`). До выноса тот же порт лежал
 * тремя локальными копиями (base.ts, video.ts, lib/richtext/icon.ts) — и
 * расходился: враппер не мог импортировать копию из `base.ts`, потому что тот
 * тянет react/react-dom.
 *
 * Карта имя → PUA-кодпоинт живёт в `@core/tgico-icons` (порт tweb `src/icons.ts`).
 * React-версия того же — `components/TgIcon.tsx` (там глиф ставит React, узел
 * строить не надо).
 *
 * Не портирована ветка RTL-отражения (`I18n.getIsRTL() && IconsReverse.has(icon)`
 * → класс `icon-reflect`): карта `IconsReverse` не портирована. Флаг
 * `I18n.getIsRTL()` есть (его ставит старт только для `ar`, которого нет в
 * списке языков сервера) — ветка ждёт порта RTL-интерфейса целиком.
 */
import { glyph, type IconName } from '@core/tgico-icons'

/** tweb `helpers/tgico.ts::TGICO_CLASS` — класс-носитель шрифта. */
const TGICO_CLASS = 'tgico'

// tweb icon.ts:6-8. У нас та же формула лежит в карте глифов (`glyph`) — её
// читает и React-версия (`TgIcon.tsx`), поэтому здесь имя оригинала, а не второй
// расчёт кодпоинта.
export const getIconContent = glyph

type IconWithClass = {
  icon: IconName
  className?: string
}

/**
 * tweb icon.ts:15-26 — иконка с наложенной поверх «плавающей» иконкой. Первый
 * вызывающий — `components/autoDeleteIcon.ts` (подменю автоудаления в меню ⋮ шапки
 * чата), CSS `.overlayed-icon` — выдержка `styles/tweb/_overlayedIcon.scss`.
 * Поведенческий тест — `icon.test.ts`.
 */
export function OverlayedIcon(icons: (IconName | IconWithClass)[], className?: string) {
  const span = document.createElement('span')
  span.classList.add('overlayed-icon', ...(className ? [className] : []))

  const getIcon = (icon: IconName | IconWithClass) => icon instanceof Object ? icon.icon : icon
  // `!` — под наш strict: в tweb `className` опционален и уходит в `classList.add`
  // как есть (строкой "undefined"); поведение не меняем, только тип.
  const getClasses = (icon: IconName | IconWithClass) => icon instanceof Object ? [icon.className!] : []

  span.append(Icon(getIcon(icons[0]), ...getClasses(icons[0])))
  span.append(...icons.slice(1).map((icon) => Icon(getIcon(icon), 'overlayed-icon__floating-icon', ...getClasses(icon))))

  return span
}

/** tweb icon.ts:28-37. */
export default function Icon(icon: IconName, ...classes: string[]) {
  const span = document.createElement('span')
  span.classList.add(TGICO_CLASS, ...classes)
  span.textContent = getIconContent(icon)
  return span
}

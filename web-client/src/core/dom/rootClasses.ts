// Классы окружения на <html> — порт tweb `src/index.ts:235-320` (setRootClasses).
// Портированные партиалы tweb (styles/tweb/*) на них опираются: миксин hover
// селектит `html.no-touch &:hover`, эмодзи-рендер — `html.native-emoji`,
// платформенные обходы — `is-mac`/`is-ios`/`is-safari`/`is-firefox`.
//
// Класс `night` ставит themeController (core/theme/themeController.ts) — как в tweb.
//
// Скролл-классы (`native-scroll`/`overlay-scroll`/`custom-scroll`) — порт
// index.ts:242-255. Партиал `_scrollable.scss` их уже читает (`html.overlay-scroll`/
// `html.custom-scroll`), но до Задачи 4 (`components/scrollable.ts`) ставить их
// было некому. Отличие от tweb: там это `createEffect` (solid), потому что
// `IS_OVERLAY_SCROLL_SUPPORTED()` зависит от `scrollbarWidth()`, а она живая
// (пересчитывается на `ResizeObserver`, см. шапку `helpers/dom/scrollbarWidth.ts`) —
// смена режима скроллбаров в macOS System Settings посреди открытой вкладки должна
// была бы перевесить класс. Здесь — плоский вызов один раз при загрузке (тот же
// компромисс, что уже принят для остальных классов этой функции и для
// `helpers/mediaSizes.ts`/`helpers/solid/readValue.ts` — решение координатора по
// блокеру Задачи 2, see `task-2-report.md`): без solid в зависимостях эту
// реактивность класса на `<html>` пришлось бы городить отдельным подписчиком ради
// одного крайне редкого события, непропорционально объёму задачи.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import IS_EMOJI_SUPPORTED from '@environment/emojiSupport'
import {
  IS_ANDROID,
  IS_APPLE,
  IS_APPLE_MOBILE,
  IS_FIREFOX,
  IS_MOBILE,
  IS_SAFARI,
} from '@environment/userAgent'
import { IS_OVERLAY_SCROLL_SUPPORTED, USE_CUSTOM_SCROLL, USE_NATIVE_SCROLL } from '@environment/overlayScrollSupport'

export function setRootClasses(): void {
  const add: string[] = []

  if (IS_EMOJI_SUPPORTED) add.push('native-emoji')

  if (USE_NATIVE_SCROLL) {
    add.push('native-scroll')
  } else if (IS_OVERLAY_SCROLL_SUPPORTED()) {
    add.push('overlay-scroll')
  } else if (USE_CUSTOM_SCROLL()) {
    add.push('custom-scroll')
  }

  // tweb добавляет no-backdrop вместе с is-firefox: у FF backdrop-filter за флагом.
  if (IS_FIREFOX) add.push('is-firefox', 'no-backdrop')

  if (IS_MOBILE) add.push('is-mobile')

  if (IS_APPLE) {
    if (IS_SAFARI) add.push('is-safari')
    add.push(IS_APPLE_MOBILE ? 'is-ios' : 'is-mac')
  } else if (IS_ANDROID) {
    add.push('is-android')
  }

  add.push(IS_TOUCH_SUPPORTED ? 'is-touch' : 'no-touch')

  document.documentElement.classList.add(...add)
}

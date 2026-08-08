// Классы окружения на <html> — порт tweb `src/index.ts:235-320` (setRootClasses).
// Портированные партиалы tweb (styles/tweb/*) на них опираются: миксин hover
// селектит `html.no-touch &:hover`, эмодзи-рендер — `html.native-emoji`,
// платформенные обходы — `is-mac`/`is-ios`/`is-safari`/`is-firefox`.
//
// Класс `night` ставит themeController (core/theme/themeController.ts) — как в tweb.
// Скролл-классы (`native-scroll`/`overlay-scroll`/`custom-scroll`) не портированы:
// их читает только партиал `_scrollable.scss`, который придёт вместе с фазой 4.
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

export function setRootClasses(): void {
  const add: string[] = []

  if (IS_EMOJI_SUPPORTED) add.push('native-emoji')

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

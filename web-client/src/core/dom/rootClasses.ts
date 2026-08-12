// Классы окружения на <html> — порт tweb `src/index.ts:235-320` (setRootClasses).
// Портированные партиалы tweb (styles/tweb/*) на них опираются: миксин hover
// селектит `html.no-touch &:hover`, эмодзи-рендер — `html.native-emoji`,
// платформенные обходы — `is-mac`/`is-ios`/`is-safari`/`is-firefox`.
//
// Класс `night` ставит themeController (core/theme/themeController.ts) — как в tweb.
//
// Скролл-классы — порт index.ts:242-255, но НЕ целиком: ставим только
// `native-scroll` — ни `overlay-scroll`, ни `custom-scroll` (см. TODO ниже).
// Партиал `_scrollable.scss` все три уже читает (`html.overlay-scroll`/
// `html.custom-scroll`), `native-scroll` там ни на что не влияет (нет ни
// одного `html.native-scroll` селектора — оставлен только потому, что
// безвреден и совпадает с tweb). Отличие от tweb: там это `createEffect`
// (solid), потому что `IS_OVERLAY_SCROLL_SUPPORTED()` зависит от
// `scrollbarWidth()`, а она живая (пересчитывается на `ResizeObserver`, см.
// шапку `helpers/dom/scrollbarWidth.ts`) — смена режима скроллбаров в macOS
// System Settings посреди открытой вкладки должна была бы перевесить класс.
// Здесь — плоский вызов один раз при загрузке (тот же компромисс, что уже
// принят для остальных классов этой функции и для
// `helpers/mediaSizes.ts`/`helpers/solid/readValue.ts` — решение координатора
// по блокеру Задачи 2, see `task-2-report.md`): без solid в зависимостях эту
// реактивность класса на `<html>` пришлось бы городить отдельным подписчиком
// ради одного крайне редкого события, непропорционально объёму задачи.
//
// TODO(scroll-parity): НИ `custom-scroll`, НИ `overlay-scroll` не ставятся —
// весь переключатель отложен до задачи «Scrollable для остальных скроллеров».
// Причина едина для обоих классов: `Scrollable` инстанцирован только в одном
// месте (`useChatScroll.ts`, лента чата) — класс `.scrollable` без своего
// инстанса висит ещё примерно на 15 других скроллерах (`ChatList`,
// `EmojiDropdown`/`EmoticonsTab`/`StickersTab`/`GifsTab`, `MentionsHelper`,
// `StickersHelper`, `InlineResultsHelper`, `CountryInput`, медиавьювер,
// `TopbarSearch`, `StoriesRow`, `Tabs`, …).
//   • `custom-scroll` (Задача 4, ревью-блокер Б-2): в tweb безопасен, потому
//     что КАЖДЫЙ `.scrollable`-узел рождён конструктором `Scrollable` и у
//     каждого поэтому есть свой JS-палец — `html.custom-scroll .scrollable
//     ::-webkit-scrollbar { width:0 }` глушит нативный скроллбар БЕЗУСЛОВНО
//     по всему документу, а взамен всегда есть чем его заменить. У нас — нет,
//     регрессия на Windows/Linux Chrome и на macOS с «Show scroll bars:
//     Always».
//   • `overlay-scroll` (финальное ревью ветки, раунд после Задачи 5, I-4):
//     «не глушит `::-webkit-scrollbar` безусловно, только оформляет» было
//     неточно — `_scrollable.scss`'s `html.overlay-scroll
//     .scrollable::-webkit-scrollbar { width:.375rem; opacity:0 }` САМА
//     стилизует `::-webkit-scrollbar`, а в Chromium стилизация этого
//     псевдоэлемента выключает overlay-режим для совпавших скроллеров
//     (полоса начинает занимать место в layout) — реальный, но узкий по
//     охвату риск: по `environment/overlayScrollSupport.ts`'s
//     `STATIC_OVERLAY_SCROLL` класс НЕ ставился на Chromium 113-144 (условие
//     там ложно), затронут только Chromium <113 или >=145.
//     Практический эффект отката для БОЛЬШИНСТВА — другой. Формула
//     `STATIC_OVERLAY_SCROLL` истинна на десктопном Firefox
//     (`!IS_CHROMIUM && !IS_SAFARI`) и на любой мобильной платформе
//     (`IS_MOBILE`), но ЛОЖНА на десктопном Safari (`IS_SAFARI &&
//     !IS_MOBILE_SAFARI` делает `!IS_SAFARI || IS_MOBILE_SAFARI` ложным —
//     проверено прогоном формулы, не по памяти). Значит основной
//     пострадавший от отката — десктопный Firefox: `html.overlay-scroll`'s
//     `.scrollable-y { scrollbar-width: thin }` + hover-цвет скроллбара
//     просто перестают применяться (Firefox `::-webkit-scrollbar` целиком
//     игнорирует — там этот блок и раньше давал ТОЛЬКО `scrollbar-width:
//     thin` + hover-цвет, конфликта с overlay-режимом там нет и не было).
//     Т.е. фактическая цена отката — десктопный Firefox и мобильные
//     платформы теряют тонкий hover-скроллбар на ~13 нелентовых
//     `.scrollable-y`-элементах, а не Chrome-регрессия из первой версии
//     этого TODO.
// Снять TODO целиком, когда у остальных скроллеров тоже будут свои
// `Scrollable`-инстансы (отдельная задача, «порт инстансов вслед за портом
// класса») — тогда оба класса становятся безопасны одновременно.
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
import { USE_NATIVE_SCROLL } from '@environment/overlayScrollSupport'

export function setRootClasses(): void {
  const add: string[] = []

  if (IS_EMOJI_SUPPORTED) add.push('native-emoji')

  if (USE_NATIVE_SCROLL) add.push('native-scroll')
  // else: и overlay-scroll (IS_OVERLAY_SCROLL_SUPPORTED()), и
  // USE_CUSTOM_SCROLL() — намеренно не ставим, см. TODO выше.

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

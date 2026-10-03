/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/chatTips/appearanceCard.tsx` (812502980) — карточка «Оформление»
 * пустой колонки (Б-13 бэклога волны 7).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *  1. (О-38) Содержимого нет: у tweb это карусель облачных тем `<ChatThemesPicker>`
 *     (`:91-97`) под заголовком `ColorTheme` и её `onReady` → `markReady`. Карусели у нас нет
 *     ни во «Общих» (расхождение 1 шапки `sidebarLeft/tabs/generalSettings.solid.tsx`), ни
 *     здесь: облачных тем нет ни в модели, ни на бэкенде. Без карусели снят и её заголовок, а
 *     карточка готова сразу.
 *  2. Тема — наш `ThemeChoice` (`theme.ts`, те же пять значений, что `settings.theme` tweb);
 *     «тёмная ли» — по применённому пресету (`getCurrentPreset`, как `isNight` бургера
 *     `sidebarLeft/index.ts`), а не `themeController.isNight()`. Пересчёт — на `theme_changed`,
 *     как у оригинала.
 *  3. `settings.lastThemeNames` нет: «Тёмная»/«Светлая» берут запасную пару оригинала
 *     night/day (`appSettings.lastThemeNames?.dark ?? 'night'`, `:74`, `:79`); переход —
 *     наш `switchTheme(name, coordinates)` (`core/theme/themeTransition.ts`).
 */
import { createSignal } from 'solid-js'
import anchorCallback from '@helpers/dom/anchorCallback'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import { i18n } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { useAppSettings } from '@stores/appSettings.solid'
import { getCurrentPreset } from '@core/theme/themeController'
import { switchTheme } from '@core/theme/themeTransition'
import { PRESET_MODE, resolvePreset, type ThemeChoice } from '@/theme'
import appSidebarLeft from '@components/sidebarLeft'
import { AppGeneralSettingsTab } from '@components/solidJsTabs/tabs'
import TipCard, { openSettingsTab, useTipReady, type TipCardButton } from './tipCard.solid'

/** Расхождение 2: `themeController.isNight()` — по применённому пресету. */
function isNightTheme() {
  const [appSettings] = useAppSettings()
  return PRESET_MODE[getCurrentPreset() ?? resolvePreset(appSettings.theme)] === 'dark'
}

/**
 * Appearance tip — macOS' `WidgetAppearanceController`: System / Dark / Light in the button row,
 * live theme thumbnails as the content, and a line pointing at the full Appearance screen.
 */
export default function AppearanceTipCard() {
  const [appSettings] = useAppSettings()
  // Расхождение 1: содержимого, которое надо дождаться, нет.
  useTipReady()()

  // Which of the three buttons reads as active. Mirrors macOS: System wins outright, otherwise
  // it is whatever the applied theme actually resolves to. `settings.theme` is reactive through
  // the store; the resolved brightness only moves on `theme_changed`.
  const [isNight, setIsNight] = createSignal(isNightTheme())
  subscribeOn(rootScope)('theme_changed', () => setIsNight(isNightTheme()))

  const isSystem = () => appSettings.theme === 'system'
  const isDark = () => !isSystem() && isNight()

  // Go through `switchTheme` so a side lands on the variant the user last picked there — Dark on
  // Night or Dark, Light on Classic or Day — falling back to the night/day defaults exactly like
  // the burger menu's Dark Mode toggle (расхождение 3). The coordinates give the same circular
  // reveal the menu toggle animates from.
  const apply = (name: ThemeChoice, e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    switchTheme(name, {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
  }

  const buttons = (): TipCardButton[] => [{
    icon: 'sputnik_filled',
    text: i18n('ChatTips.Appearance.System'),
    selected: isSystem(),
    onClick: (e) => apply('system', e),
  }, {
    icon: 'darkmode_filled',
    text: i18n('ChatTips.Appearance.Dark'),
    selected: isDark(),
    onClick: (e) => apply('night', e),
  }, {
    icon: 'brightness',
    text: i18n('ChatTips.Appearance.Light'),
    selected: !isSystem() && !isDark(),
    onClick: (e) => apply('day', e),
  }]

  return (
    <TipCard
      title={i18n('ChatTips.Appearance')}
      buttons={buttons()}
      description={i18n('ChatTips.Appearance.Description', [
        anchorCallback(() => openSettingsTab(appSidebarLeft, AppGeneralSettingsTab)),
      ])}
    />
  )
}

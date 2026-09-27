/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/generalSettings.tsx:1-359 (812502980) —
 * вкладка «Общие» (`AppGeneralSettingsTab`, `solidJsTabs/tabs.ts`), задача 13 плана
 * волны 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 *
 * Секции — как у оригинала: `Settings` (ползунок размера текста 12–20, строки
 * «Обои» → `AppChatBackgroundTab` и «Энергосбережение» → `AppPowerSavingTab` с
 * живым статусом `liteMode.all` справа), `ColorTheme` (пять радио
 * `settings.theme`), `General.TimeFormat` (радио h12/h23, в подписи — текущее
 * время, обновляется раз в минуту). Настройки пишутся сразу, как у tweb
 * (`stateKey` полей и `setAppSettings` ползунка), — через мост `useAppSettings`.
 *
 * ── Модель темы: tweb ↔ у нас ──────────────────────────────────────────────
 * | tweb (`StateSettings`)                         | у нас                                    |
 * |------------------------------------------------|------------------------------------------|
 * | `settings.theme`: day/night/light/tinted/system | zustand `themeChoice` (`theme.ts::ThemeChoice`) — те же пять значений; `day` = Classic (`baseThemeClassic`), `light` = Day (`baseThemeDay`), `tinted` = Dark (`config/themePresets.ts:207-212`) |
 * | побочка: `settings_updated` → `theme_change` → `themeController.setTheme` (`:139-143`) | подписчик самого `themeChoice` (`core/hooks/useThemeToggle.ts` в `App.tsx` → `core/theme/themeController.ts::setTheme`) — вкладка только пишет настройку |
 * | `settings.themes[]` — `AppTheme` на каждое имя: облачная тема или акцент-пресет (`accent_color`, `message_colors`, `wallpaper`) | НЕТ: тема = пресет `presetToColorMap` + одни обои на все темы (О-11); облачных тем нет ни на бэкенде (`account.getThemes`), ни в модели |
 * | темы чата (`account.getThemes`, `pFlags.default`) | `chatThemes.ts::CHAT_THEMES` — клиентский набор для `messages.setChatTheme` ОДНОГО чата (попап `components/ChatThemesPicker.tsx`), глобально не применяется |
 * | `settings.messagesTextSize` 12–20              | zustand `textSize` (прежний React-экран пускал до 24 — значения выше 20 прижимаются на чтении, `settings.tsx::load`) |
 * | `settings.timeFormat` 'h12' / 'h23'            | zustand `timeFormat` '12h' / '24h' (`codec` моста) |
 * | `settings.increaseContrast`                    | НЕТ (О-37) |
 * | `settings.distanceUnit`                        | НЕТ, и не нужен: секция не рисуется и у tweb |
 *
 * Расхождения с оригиналом:
 *  1. (О-38) Карусели тем `ChatThemesPicker` (`:158-163`, `components/chatThemesPicker.tsx`)
 *     и ряда акцентов `AccentPickerRow` под `GrowHeightReveal` (`:174-176`, `:194-267`)
 *     нет. Выбор плитки у tweb — `themeController.applyNewTheme`: запись облачной
 *     темы в `settings.themes[]` для текущей базы (акцент, цвета исходящих, обои
 *     темы через `AppBackgroundTab.setBackgroundDocument`), акцент — то же через
 *     `applyAccentPreset`/`resetActiveTheme` и пресеты `getAccentPresetsForBase`.
 *     У нас нет ни списка облачных тем (`account.getThemes` на бэкенде нет), ни
 *     модели «тема приложения = облачная тема по базе», ни пресетов акцента, ни
 *     глобальной акцент-деривации (`deriveChatThemeVars` применяется только к
 *     колонке чата с темой). Плитке некуда писать выбор. Прежние четыре карточки
 *     React-экрана (по пресету на карточку) — наше отступление, не tweb: плитки у
 *     оригинала — облачные темы, а выбор базы — радио ниже; они не переносятся.
 *  2. Отступ формы радио (`style={{'margin-top': '.5rem'}}`, `:164`) снят: он
 *     отделяет форму от карусели (п. 1), без карусели это пустая полоса над
 *     первой строкой. Вернуть вместе с каруселью.
 *  3. (О-37) Тумблера «Increase Contrast» (`:69-75`) нет: настройка
 *     `increaseContrast` у tweb — часть a11y-коммита 472e3e76b
 *     (`themeController.ts:228-231`, `:332` — класс `html.high-contrast`,
 *     `:576-599` — прижатие контраста `primary`/`secondary-text`/`danger`/`link`/
 *     `green` и заливки `*-button-color`; `scss/partials/_accessibility.scss`), а
 *     этой деривации у нас нет. Тумблер без неё ничего бы не менял.
 *  4. `DistanceUnitsSection` (`:273-294`) не портирован: у tweb
 *     `IS_GEOLOCATION_SUPPORTED = … && false` (`environment/geolocationSupport.ts:1`)
 *     — секция не рисуется никогда, и `distanceUnit` не читает никто, кроме неё.
 *  5. `ChatBackgroundStore.preloadWallPapers` в `onMount` (`:46-51`) нет: он
 *     прогревает список серверных обоев и их превью, а их у нас нет (О-11) —
 *     сетка «Обоев» из клиентских пресетов готова сразу.
 *  6. Радио — `checked`/`onChange` через мост, а не `stateKey` (у нашего
 *     `RadioField` его нет, `radioFieldTsx.solid.tsx`); статус «Энергосбережения»
 *     — эффект по `appSettings.liteMode.all`, а не подписка на `settings_updated`
 *     (`:52`): у моста настройки реактивны сами (О-2), событие не нужно.
 *  7. Закомментированный у tweb тумблер `EnableAnimations` (`:76-91`) не переносится.
 *  8. Подпись формата времени — `new Intl.DateTimeFormat('en-us-u-hc-' + format, …)
 *     .format(date)`, а не `date.toLocaleTimeString('en-us-u-hc-' + format, …)`
 *     (`:315-318`): вывод тот же (локаль зафиксирована, как у оригинала), но
 *     `toLocale*String` в продукте запрещён сканом `i18n/noBrowserLocaleDates.test.ts`.
 *  9. Списки радио — `For` вместо `.map` (`:165`, `:330`): массивы статичны,
 *     результат тот же; `.map` в JSX красит линтер (`react/jsx-key`).
 */
import { createEffect, createSignal, For, onCleanup } from 'solid-js'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import eachMinute from '@helpers/eachMinute'
import type { ThemeChoice } from '@/theme'
import Section from '@components/section.solid'
import Row from '@components/rowTsx.solid'
import RangeSettingSelector from '@components/rangeSettingSelector.solid'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import type SidebarSlider from '@components/slider'
import { useAppSettings } from '@stores/appSettings.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { AppChatBackgroundTab, AppPowerSavingTab } from '@components/solidJsTabs/tabs'

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — text size, chat background, lite mode entry
// ─────────────────────────────────────────────────────────────────────────────

const SettingsSection = () => {
  const [tab] = useSuperTab()
  const [appSettings, setAppSettings] = useAppSettings()
  const slider = () => tab.slider as SidebarSlider

  const liteModeStatus = (): LangPackKey =>
    appSettings.liteMode.all ? 'Checkbox.Enabled' : 'Checkbox.Disabled'

  const liteModeStatusEl = new I18n.IntlElement()

  // tweb :42-52 — `onUpdate` на монтировании и по `settings_updated` (расхождение 6)
  createEffect(() => {
    liteModeStatusEl.compareAndUpdate({ key: liteModeStatus() })
  })

  // О-37: тумблер Increase Contrast (tweb :69-75) — расхождение 3 шапки.
  return (
    <Section name="Settings">
      <RangeSettingSelector
        textLeft={i18n('TextSize')}
        textRight={(value) => '' + value}
        step={1}
        value={appSettings.messagesTextSize}
        minValue={12}
        maxValue={20}
        onChange={(value) => void setAppSettings('messagesTextSize', value)}
      />
      <Row clickable={() => void slider().createTab(AppChatBackgroundTab).open()}>
        <Row.Icon icon="appearance_filled" />
        <Row.Title>{i18n('ChatBackground')}</Row.Title>
      </Row>
      <Row clickable={() => void slider().createTab(AppPowerSavingTab).open()}>
        <Row.Icon icon="sputnik_filled" />
        <Row.Title titleRight={liteModeStatusEl.element} titleRightSecondary>
          {i18n('LiteMode.EnableText')}
        </Row.Title>
      </Row>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — color theme variant radios
// ─────────────────────────────────────────────────────────────────────────────

const THEME_VARIANTS: [ThemeChoice, LangPackKey][] = [
  ['day', 'ThemeDay'],
  ['night', 'ThemeNight'],
  ['light', 'ThemeLight'],
  ['tinted', 'ThemeTinted'],
  ['system', 'AutoNightSystemDefault'],
]

const ThemeSection = () => {
  const [appSettings, setAppSettings] = useAppSettings()

  // О-38: карусель тем и ряд акцентов (tweb :158-163, :174-176) — расхождение 1.
  return (
    <Section name="ColorTheme">
      <form>
        <For each={THEME_VARIANTS}>{([value, langKey]) => (
          <Row>
            <Row.RadioField>
              <RadioFieldTsx
                name="theme"
                value={value}
                checked={appSettings.theme === value}
                onChange={(checked) => {
                  if(checked) void setAppSettings('theme', value)
                }}
              />
            </Row.RadioField>
            <Row.Title>{i18n(langKey)}</Row.Title>
          </Row>
        )}</For>
      </form>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — time format (h12 / h23) with a live "current time" subtitle
// ─────────────────────────────────────────────────────────────────────────────

const TimeFormatSection = () => {
  const [appSettings, setAppSettings] = useAppSettings()
  const formats: ['h12' | 'h23', LangPackKey][] = [
    ['h12', 'General.TimeFormat.h12'],
    ['h23', 'General.TimeFormat.h23'],
  ]

  const items = formats.map(([format, langKey]) => {
    const [subtitle, setSubtitle] = createSignal<string>('')
    return { format, langKey, subtitle, setSubtitle }
  })

  const updateAll = () => {
    const date = new Date()
    items.forEach(({ format, setSubtitle }) => {
      // расхождение 8: форматтер вместо `date.toLocaleTimeString(…)` (`:315-318`)
      const str = new Intl.DateTimeFormat('en-us-u-hc-' + format, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
      setSubtitle(str)
    })
  }

  updateAll()
  const cancel = eachMinute(updateAll)
  onCleanup(cancel)

  return (
    <Section name="General.TimeFormat">
      <form>
        <For each={items}>{({ format, langKey, subtitle }) => (
          <Row>
            <Row.RadioField>
              <RadioFieldTsx
                name="time-format"
                value={format}
                checked={appSettings.timeFormat === format}
                onChange={(checked) => {
                  if(checked) void setAppSettings('timeFormat', format)
                }}
              />
            </Row.RadioField>
            <Row.Title>{i18n(langKey)}</Row.Title>
            <Row.Subtitle>{subtitle()}</Row.Subtitle>
          </Row>
        )}</For>
      </form>
    </Section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab root
// ─────────────────────────────────────────────────────────────────────────────

const GeneralSettings = () => {
  // tweb :348-357 — без `DistanceUnitsSection` (расхождение 4).
  return (
    <>
      <SettingsSection />
      <ThemeSection />
      <TimeFormatSection />
    </>
  )
}

export default GeneralSettings

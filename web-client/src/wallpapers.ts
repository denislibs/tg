// Модель обоев чата и её адаптер к форме tweb.
//
// У tweb обои — `WallPaper` сервера в настройках КАЖДОЙ темы
// (`themeController.getThemeSettings(theme).wallpaper`, `settings.themes[]`),
// и фон чата (`chat/bubbles/chatBackground.solid.tsx`, порт
// `chatBackground.tsx`) читает именно их. У нас ни серверных обоев (О-11), ни
// `settings.themes[]` (О-38): обои — одна настройка на все темы в zustand
// (`settings.tsx`: `wallpaper` + своё фото `customWallpaperMediaId`/
// `customWallpaperBlur`). Этот модуль переводит нашу настройку в `WallPaper`
// из `@layer`, чтобы фон оставался дословным портом, — данных, которых у нас
// нет, он не выдумывает:
//  • умолчание темы — дословно `DEFAULT_THEME` tweb (`config/state.ts:305-422`);
//  • пресет сетки — узор `pattern` с цветами пресета и интенсивностью умолчания
//    текущей темы (у серверных обоев она своя; у наших пресетов её нет);
//  • сплошной цвет — `wallPaperNoFile` с `background_color`;
//  • своё фото — `wallPaper` без узора со slug `media-<id>` (файл даёт медиа-
//    конвейер, `core/chat/chatBackgroundStore.ts`), флаг `blur` — из
//    `customWallpaperBlur`.
// Все функции возвращают ОДИН И ТОТ ЖЕ объект на одни входы: фон сравнивает
// обои по ссылке (`chatBackground.tsx:466`, `:690`), и новый объект на каждый
// вызов перерисовывал бы его зря.
import type { WallPaper } from '@layer'
import type { ChatTheme } from './chatThemes'
import type { ThemePresetName } from './config/themePresets'
import { PRESET_MODE } from './theme'

export interface WallpaperPreset {
  id: string
  colors: [string, string, string, string]
}

// Сетка вкладки «Обои» — клиентский набор вместо `account.getWallPapers` (О-11).
export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: 'day', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'] },
  { id: 'sunset', colors: ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'] },
  { id: 'amber', colors: ['#f0c07a', '#e8a268', '#f5d29b', '#e0b070'] },
  { id: 'ice', colors: ['#9bbbd6', '#a8c5e0', '#cdd9ec', '#b6cae3'] },
  { id: 'lime', colors: ['#c9e29b', '#9fd17a', '#dbe8a0', '#a7d77f'] },
  { id: 'violet', colors: ['#8ea2e0', '#b39ddb', '#c6a8e0', '#9b8ad6'] },
  { id: 'rose', colors: ['#f2b9c4', '#e89bb0', '#f5cdd6', '#eaa9bd'] },
  { id: 'matrix', colors: ['#7a9ec2', '#5b7fa6', '#8fb0cf', '#6b8eb3'] },
  { id: 'sky', colors: ['#aac8ea', '#cfe0f2', '#c2d9ee', '#b3d0ea'] },
  { id: 'candy', colors: ['#f3c4e3', '#d9b8ec', '#f0cdee', '#e3bce8'] },
  { id: 'mint', colors: ['#a8e0d0', '#bfeae0', '#cdeee6', '#b3e6da'] },
  { id: 'dusk', colors: ['#b3a8e0', '#c6bced', '#a89ad6', '#bcb0e8'] },
]

// Наша настройка обоев (`settings.tsx`).
export type Wallpaper =
  | { kind: 'default' }
  | { kind: 'preset'; colors: string[] }
  | { kind: 'color'; color: string }

export type WallPaperSettingsState = {
  wallpaper: Wallpaper
  customWallpaperMediaId?: number
  customWallpaperBlur?: boolean
}

/** tweb `DEFAULT_BACKGROUND_SLUG` (`config/app.ts:12`) — встроенный узор `pattern.svg`. */
export const DEFAULT_BACKGROUND_SLUG = 'pattern'

/**
 * Тема приложения в той форме, какую фон tweb читает у `AppTheme`
 * (`config/state.ts:48`): только имя. Остального `AppTheme` (облачная тема,
 * `settings[]` на базу) у нас нет — О-38.
 */
export type AppTheme = { name: ThemePresetName }

/**
 * Тема ОДНОГО чата (tweb — облачная `Theme` из `appState.accountThemes`,
 * `chat.ts:517-523`). У нас это встроенная `ChatTheme` (`chatThemes.ts`) — О-39.
 * Как и у оригинала, объект стабилен между днём и ночью: вариант выбирается
 * при разрешении по текущей теме (`getThemeSettings`).
 */
export type ChatThemeBackground = { chatTheme: ChatTheme }

const chatThemeBackgrounds = new WeakMap<ChatTheme, ChatThemeBackground>()
/** Стабильный объект темы чата: владение фоном у tweb сверяется по ссылке (`chatBackground.tsx:661`). */
export function getChatThemeBackground(chatTheme: ChatTheme): ChatThemeBackground {
  let background = chatThemeBackgrounds.get(chatTheme)
  if(!background) chatThemeBackgrounds.set(chatTheme, background = { chatTheme })
  return background
}

/** tweb `ChatBackgroundTheme = AppTheme | Theme` (`chatBackground.tsx:41`). */
export type ChatBackgroundTheme = AppTheme | ChatThemeBackground

const APP_THEMES: Record<ThemePresetName, AppTheme> = {
  day: { name: 'day' },
  night: { name: 'night' },
  light: { name: 'light' },
  tinted: { name: 'tinted' },
}

/** tweb `themeController.getTheme(name)` (`themeController.ts:503-507`) — стабильный объект темы. */
export const getAppTheme = (name: ThemePresetName): AppTheme => APP_THEMES[name]

const hexToTelegramColor = (hex: string) => parseInt(hex.slice(1), 16)

// `document` у встроенных обоев tweb — `undefined` (`config/state.ts:321`), а
// в строгой `@layer` поле обязательно: собираем без него и приводим один раз.
type WallPaperWithoutDocument = Omit<WallPaper.wallPaper, 'document'>
const asWallPaper = (wallPaper: WallPaperWithoutDocument) => wallPaper as WallPaper.wallPaper

const makePatternWallPaper = (intensity: number, colors: number[], dark?: boolean) => asWallPaper({
  _: 'wallPaper',
  pFlags: { default: true, pattern: true, ...(dark ? { dark: true } : {}) },
  access_hash: '',
  id: '',
  slug: DEFAULT_BACKGROUND_SLUG,
  settings: {
    _: 'wallPaperSettings',
    pFlags: {},
    intensity,
    background_color: colors[0],
    second_background_color: colors[1],
    third_background_color: colors[2],
    fourth_background_color: colors[3],
  },
})

/**
 * Обои умолчания по теме — tweb `DEFAULT_THEME.settings[].wallpaper`
 * (`config/state.ts:305-422`), разложенные по имени темы через
 * `themeNameToBaseTheme` (`themeController.ts:191-196`): day → Classic,
 * night → Night, light → Day, tinted → Tinted.
 */
export const DEFAULT_WALLPAPERS: Record<ThemePresetName, WallPaper.wallPaper> = {
  day: makePatternWallPaper(50, [0xdbddbb, 0x6ba587, 0xd5d88d, 0x88b884]),
  night: makePatternWallPaper(-50, [0xfec496, 0xdd6cb9, 0x962fbf, 0x4f5bd5], true),
  tinted: makePatternWallPaper(-40, [0x1e3557, 0x182036, 0x1c4352, 0x16263a], true),
  light: makePatternWallPaper(50, [0xb1e0fa, 0x82b0d8, 0xa0d8e8, 0xe5f0f8]),
}

/**
 * Обои с узором из наших цветов (пресет сетки, вариант темы чата). Интенсивность
 * — умолчания темы `themeName`: своей у наших пресетов нет (шапка модуля).
 */
export function makePresetWallPaper(colors: readonly string[], themeName: ThemePresetName): WallPaper.wallPaper {
  const base = DEFAULT_WALLPAPERS[themeName]
  return makePatternWallPaper(base.settings!.intensity!, colors.map(hexToTelegramColor), base.pFlags.dark)
}

const makeColorWallPaper = (hex: string): WallPaper.wallPaperNoFile => ({
  _: 'wallPaperNoFile',
  id: '',
  pFlags: {},
  settings: { _: 'wallPaperSettings', pFlags: {}, background_color: hexToTelegramColor(hex) },
})

const MEDIA_SLUG_PREFIX = 'media-'
const UPLOAD_SLUG_PREFIX = 'upload-'

/** slug своего фото: по нему файл отдаёт `ChatBackgroundStore.getBackground`. */
export const getMediaWallPaperSlug = (mediaId: number) => MEDIA_SLUG_PREFIX + mediaId
/** slug фото, которое ещё отгружается (tweb `prepareWallPaperUpload`, `background.tsx:404`). */
export const getUploadWallPaperSlug = (uploadId: number) => UPLOAD_SLUG_PREFIX + uploadId
/** id медиа своего фото по slug; `undefined` — обои не из медиа-конвейера. */
export function getMediaIdFromWallPaperSlug(slug: string): number | undefined {
  return slug.startsWith(MEDIA_SLUG_PREFIX) ? Number(slug.slice(MEDIA_SLUG_PREFIX.length)) : undefined
}

/** Обои-картинка без узора (у tweb — загруженные `wallPaper` без `pattern`). */
export function makeImageWallPaper(slug: string, blur?: boolean): WallPaper.wallPaper {
  return asWallPaper({
    _: 'wallPaper',
    pFlags: {},
    access_hash: '',
    id: slug,
    slug,
    settings: { _: 'wallPaperSettings', pFlags: blur ? { blur: true } : {} },
  })
}

// Кэши ссылок (шапка модуля). Ключ настройки — сам объект `wallpaper` стора:
// zustand меняет его только на записи, и тянуть протухшие объекты `WeakMap`
// не будет (ползунок цвета пишет новый на каждом кадре).
const bySetting = new WeakMap<Wallpaper, Map<ThemePresetName, WallPaper>>()
const byChatTheme = new WeakMap<ChatTheme, Map<ThemePresetName, WallPaper>>()
const byImage = new Map<string, WallPaper>()

const memo = <K extends object>(cache: WeakMap<K, Map<ThemePresetName, WallPaper>>, key: K, themeName: ThemePresetName, make: () => WallPaper) => {
  let map = cache.get(key)
  if(!map) cache.set(key, map = new Map())
  let wallPaper = map.get(themeName)
  if(!wallPaper) map.set(themeName, wallPaper = make())
  return wallPaper
}

/** Наша настройка → `WallPaper` темы `themeName` (своё фото — поверх остального). */
export function getWallPaperFromSettings(state: WallPaperSettingsState, themeName: ThemePresetName): WallPaper {
  if(state.customWallpaperMediaId != null) {
    const slug = getMediaWallPaperSlug(state.customWallpaperMediaId)
    const blur = !!state.customWallpaperBlur
    const key = slug + (blur ? '?blur' : '')
    let wallPaper = byImage.get(key)
    if(!wallPaper) byImage.set(key, wallPaper = makeImageWallPaper(slug, blur))
    return wallPaper
  }

  const { wallpaper } = state
  switch(wallpaper.kind) {
    case 'preset': return memo(bySetting, wallpaper, themeName, () => makePresetWallPaper(wallpaper.colors, themeName))
    case 'color': return memo(bySetting, wallpaper, themeName, () => makeColorWallPaper(wallpaper.color))
    default: return DEFAULT_WALLPAPERS[themeName]
  }
}

/**
 * tweb `themeController.getThemeSettings(theme).wallpaper` (`themeController.ts:734-743`):
 * обои темы. Тема приложения — наша настройка обоев (одна на все темы, О-11);
 * тема чата — вариант её режима под текущую тему приложения (как у tweb база
 * выбирается по имени активной темы, `getThemeName`, `:509-513`).
 */
export function getThemeWallPaper(
  theme: ChatBackgroundTheme,
  state: WallPaperSettingsState,
  currentThemeName: ThemePresetName,
): WallPaper {
  if('chatTheme' in theme) {
    const { chatTheme } = theme
    return memo(byChatTheme, chatTheme, currentThemeName, () => {
      return makePresetWallPaper(chatTheme[PRESET_MODE[currentThemeName]].gradient, currentThemeName)
    })
  }

  return getWallPaperFromSettings(state, theme.name)
}

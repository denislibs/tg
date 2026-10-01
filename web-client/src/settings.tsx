import { create } from 'zustand'
import I18n from '@lib/langPack'
import type { ThemeChoice } from './theme'
import type { Wallpaper } from './wallpapers'
import type { LiteModeKey } from '@helpers/liteMode'
import type { ContactsSortMode } from '@core/peers/sortContacts'
// tweb `config/state.ts:8` — тип клавиш сочетания блокировки живёт у ShortcutBuilder.
import type { ShortcutKey as PasscodeLockShortcutKey } from '@components/sidebarLeft/tabs/passcodeLock/shortcutBuilder.solid'

export type TimeFormat = '12h' | '24h'

// What the chat wallpaper currently shows (тип живёт в ./wallpapers вместе с
// чистой логикой выбора активного фона).
export type { Wallpaper }

export interface Settings {
  themeChoice: ThemeChoice
  textSize: number // message bubble font size (px)
  timeFormat: TimeFormat
  wallpaper: Wallpaper
  // Свои обои чата, загруженные фото (tweb background upload): media_id
  // выбранного изображения. Приоритет над пресетом/цветом (wallpaper) — пока
  // задан, фон рисуется этим фото. customWallpaperBlur — размытие поверх (toggle).
  // Размытия пресета/цвета нет: у tweb размывается только обои-картинка без
  // узора (`needBlur` в sidebarLeft/tabs/background.tsx:41-44).
  customWallpaperMediaId?: number
  customWallpaperBlur?: boolean
  // Устройства для звонков (Настройки → Динамики и камера; tweb
  // `appSettings.callDevices`, мост `stores/appSettings.solid.ts`); '' =
  // системное по умолчанию. deviceId из enumerateDevices, читаются при старте
  // звонка. «Принимать звонки» (`acceptCalls`) снят задачей 26 плана 2D: у tweb
  // это флаг авторизации на сервере (О-8), локально его не читал никто.
  speakerId: string
  micId: string
  cameraId: string
  // Тип записи кнопкой в композере (tweb recordingMediaType): голос или кружок
  recordingMediaType: 'voice' | 'round'
  // tweb `config/state.ts:199-201` — порядок вкладки контактов, помнится между визитами, как на
  // Android и iOS (tdesktop всякий раз открывает контакты по «был(а) в сети»)
  contactsSortMode: ContactsSortMode
  // Уведомления (tweb appSettings.notifications; дефолты из SETTINGS_INIT):
  // desktop — показывать браузерные уведомления; push — offline-уведомления
  // (web push); sound + volume — звук уведомления; sentMessageSound — звук
  // отправленного сообщения.
  notifyDesktop: boolean
  notifyPush: boolean
  notifySound: boolean
  notifyVolume: number // 0..1
  sentMessageSound: boolean
  // Папки слева от чатов (tweb settings.tabsInSidebar): true — вертикальный
  // folders-sidebar, false — горизонтальные табы над списком.
  tabsInSidebar: boolean
  // Код-пароль (tweb settings.passcode): включён ли; автолок в минутах
  // (0 — выключен). Запись кода — в IndexedDB (lib/passcode/actions.ts).
  passcodeEnabled: boolean
  passcodeAutoLockMins: number
  // Сочетание блокировки (tweb settings.passcode.lockShortcutEnabled/lockShortcut,
  // `config/state.ts:151-152`): модификаторы + L, слушатель —
  // `core/hooks/useLockScreenShortcut.ts`.
  passcodeLockShortcutEnabled: boolean
  passcodeLockShortcut: PasscodeLockShortcutKey[]
  // tweb settings.passcode.canAttemptAgainOn (`passcodeLockScreen.tsx:136-149`):
  // до какого момента экран блокировки не сверяет код после шести неудач.
  passcodeCanAttemptAgainOn: number | null
  // Автозагрузка медиа (tweb autoDownload/autoDownloadNew): общий выключатель,
  // по типам чатов для фото/видео/файлов, лимит размера файла (байты).
  autoDownloadEnabled: boolean
  autoDownloadPhoto: AutoDownloadPeerTypes
  autoDownloadVideo: AutoDownloadPeerTypes
  autoDownloadFile: AutoDownloadPeerTypes
  autoDownloadFileSizeMax: number
  // Медиакэш (tweb cacheTTL/cacheSize): очищать старше N секунд; лимит размера
  // в байтах (0 = Авто, без лимита).
  cacheTTL: number
  cacheSize: number
  // Энергосбережение (tweb StateSettings.liteMode, config/state.ts:127): своя
  // галочка на каждый класс анимаций, `all` — режим целиком. true = анимация
  // ВЫКЛЮЧЕНА (`liteMode.isAvailable(key) = !all && !liteMode[key]`). Пишут
  // вкладка «Энергосбережение» и пункт меню «Ещё» (animations); побочки —
  // подписчик `client/liteModeSettings.ts`.
  liteMode: Record<LiteModeKey, boolean>
  // Перевод сообщений (tweb translations): показывать ли пункт «Перевести» в
  // контекстном меню; translateTo — целевой язык (ISO-код), '' = язык интерфейса.
  showTranslateButton: boolean
  translateTo: string
  // Зацикливать анимированные стикеры в чате (tweb settings.stickers.loop).
  loopStickers: boolean
  // Скорость воспроизведения видео в медиа-вьюере (tweb appMediaPlaybackController
  // .playbackRate): восстанавливается при открытии следующего видео. Дефолт 1.
  videoRate: number
  // Скорость плеера ОТДЕЛЬНО на тип медиа (tweb playbackRates: Record<PlaybackMediaType,
  // number>, appMediaPlaybackController.ts:152-156), переживает перезагрузку
  // (tweb appSettings.playbackParams, appDialogsManager.ts:691-698). Голосовое и
  // кружок — один тип 'voice', музыка — 'audio'; видео вьюера живёт в videoRate.
  playbackRates: Record<'voice' | 'audio', number>
  // Пользовательская ширина колонок из ручки ресайза. tweb держит их в
  // localStorage-ключах 'sidebar-left-width' / 'sidebar-right-width'
  // (updateColumnWidths.ts:103-104); у нас всё, что переживает перезагрузку,
  // живёт в этом сторе, поэтому ключи переехали сюда.
  // undefined = «предпочтения нет» → DEFAULT_COLUMN_WIDTH; 0 у левой = свёрнута.
  sidebarLeftWidth?: number
  sidebarRightWidth?: number
  // Подсказку «зажмите Shift» показываем один раз за всё время
  // (tweb appSettings.seenTooltips.sidebarResize, installColumnResize.ts:57).
  seenSidebarResizeTip: boolean
  // Плашка-подсказка «Never miss a message!» отклонена или отработана
  // (tweb appSettings.notifications.suggested, notificationsSuggestion.tsx:14).
  notifySuggested: boolean
}

// Галочки автозагрузки по типам чатов (tweb AutoDownloadPeerTypeSettings).
export interface AutoDownloadPeerTypes {
  contacts: boolean
  private: boolean
  groups: boolean
  channels: boolean
}

const AUTO_DOWNLOAD_ALL: AutoDownloadPeerTypes = { contacts: true, private: true, groups: true, channels: true }

// Экспорт — ради Solid-вкладок, которым нужен дефолт ЛИСТА (у tweb это
// `SETTINGS_INIT` из `config/state.ts`: «Уведомления» возвращают громкость по
// умолчанию при включении звука на нуле, `notifications.tsx:489-495`).
export const DEFAULTS: Settings = {
  themeChoice: 'system',
  textSize: 16,
  timeFormat: '24h',
  wallpaper: { kind: 'default' },
  customWallpaperMediaId: undefined,
  customWallpaperBlur: false,
  speakerId: '',
  micId: '',
  cameraId: '',
  recordingMediaType: 'voice',
  contactsSortMode: 'online', // tweb SETTINGS_INIT.contactsSortMode (`config/state.ts:602`)
  notifyDesktop: true,
  notifyPush: true,
  // tweb стартует с sound: false; у нас звук входящего был всегда включён —
  // сохраняем поведение, дефолт true.
  notifySound: true,
  notifyVolume: 0.5,
  sentMessageSound: true,
  tabsInSidebar: false,
  passcodeEnabled: false,
  passcodeAutoLockMins: 0,
  passcodeLockShortcutEnabled: false, // tweb SETTINGS_INIT.passcode (`config/state.ts:580-581`)
  passcodeLockShortcut: ['Alt'],
  passcodeCanAttemptAgainOn: null,
  autoDownloadEnabled: true,
  autoDownloadPhoto: { ...AUTO_DOWNLOAD_ALL },
  autoDownloadVideo: { ...AUTO_DOWNLOAD_ALL },
  autoDownloadFile: { ...AUTO_DOWNLOAD_ALL },
  autoDownloadFileSizeMax: 3145728, // 3 МБ (tweb autoDownloadNew.file_size_max)
  cacheTTL: 86400 * 7, // неделя (tweb SETTINGS_INIT.cacheTTL)
  cacheSize: 0, // Авто (tweb SETTINGS_INIT.cacheSize)
  // tweb SETTINGS_INIT.liteMode (config/state.ts:525-545) — все false
  liteMode: {
    all: false,
    animations: false,
    blur: false,
    chat: false,
    chat_background: false,
    chat_spoilers: false,
    effects: false,
    effects_premiumstickers: false,
    effects_reactions: false,
    effects_emoji: false,
    emoji: false,
    emoji_appear: false,
    emoji_messages: false,
    emoji_panel: false,
    gif: false,
    stickers: false,
    stickers_chat: false,
    stickers_panel: false,
    video: false,
  },
  showTranslateButton: true,
  translateTo: '',
  loopStickers: true, // tweb stickers.loop default true
  videoRate: 1,
  playbackRates: { voice: 1, audio: 1 },
  sidebarLeftWidth: undefined,
  sidebarRightWidth: undefined,
  seenSidebarResizeTip: false,
  notifySuggested: false,
}

const KEY = 'tg-settings'

// Пресеты, удалённые в ходе cutover на themeController (Task 4): 'classic' и
// 'dark' (старый ThemePreset) больше не существуют — 'classic' → 'day', 'dark' →
// 'night'. 'day'/'night'/'light'/'tinted'/'system' — валидные значения, проходят
// как есть (НЕ мапить 'light': это первоклассная тема, а не legacy-артефакт;
// старый standalone-ключ tg-theme='light' мигрируется отдельно в ветке !raw ниже).
const legacyToPreset: Record<string, ThemeChoice> = {
  classic: 'day',
  dark: 'night',
}

// Срок медиакэша, сохранённый прежним React-экраном «Данных и памяти»: его шкала
// считала месяц 30 днями (1–6 «месяцев» = 30·k дней), у tweb месяц — 31 день
// (`lib/constants.ts:23`, `storageQuota.tsx:158-163`). Без перевода вкладка
// (`sidebarLeft/tabs/dataAndStorage/storageQuota.solid.tsx`) показала бы такое
// значение ближайшим шагом снизу — «3 недели» вместо «1 месяц» — и молча
// записала бы его на закрытии. Переводим на чтении: те же «k месяцев» в мере
// tweb. Записывается нормализованное значение вместе со следующим `update`
// (он пишет весь объект) — отдельной записи не нужно, смысл выбора тот же.
const DAY = 86400
function migrateCacheTTL(ttl: number): number {
  const months = ttl / (30 * DAY)
  return Number.isInteger(months) && months >= 1 && months <= 6 ? months * 31 * DAY : ttl
}

export function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      // migrate the legacy stand-alone theme key, if present
      const legacy = localStorage.getItem('tg-theme')
      if (legacy === 'light') return { ...DEFAULTS, themeChoice: 'day' }
      if (legacy === 'dark') return { ...DEFAULTS, themeChoice: 'night' }
      return DEFAULTS
    }
    const { reduceMotion, ...stored } = JSON.parse(raw) as Partial<Settings> & { reduceMotion?: boolean }
    const s: Settings = {
      ...DEFAULTS,
      ...stored,
      // Недостающие ключи добираются дефолтами. Прежний флаг «Без анимаций»
      // (`reduceMotion`) — это tweb `liteMode.animations` (тумблер меню «Ещё»,
      // sidebarLeft/index.ts:1016-1029): переезжает в него, сам ключ не живёт.
      liteMode: {
        ...DEFAULTS.liteMode,
        ...(reduceMotion ? { animations: true } : {}),
        ...stored.liteMode,
      },
    }
    s.cacheTTL = migrateCacheTTL(s.cacheTTL)
    // Прежний React-экран «Общих» пускал размер текста до 24; у tweb ползунок —
    // 12–20 (`generalSettings.tsx:61-62`), и вкладка задачи 13 плана 2D выше не
    // выберет. Прижимаем на чтении — как срок кэша выше.
    s.textSize = Math.min(s.textSize, 20)
    const mapped = legacyToPreset[s.themeChoice as string]
    return mapped ? { ...s, themeChoice: mapped } : s
  } catch {
    return DEFAULTS
  }
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void
}

// Global settings live in a store (not a React context) — the single source of
// truth, persisted to localStorage on every change inside the action itself.
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch)
    const s = get()
    const toSave: Settings = {
      themeChoice: s.themeChoice,
      textSize: s.textSize,
      timeFormat: s.timeFormat,
      wallpaper: s.wallpaper,
      customWallpaperMediaId: s.customWallpaperMediaId,
      customWallpaperBlur: s.customWallpaperBlur,
      speakerId: s.speakerId,
      micId: s.micId,
      cameraId: s.cameraId,
      recordingMediaType: s.recordingMediaType,
      contactsSortMode: s.contactsSortMode,
      notifyDesktop: s.notifyDesktop,
      notifyPush: s.notifyPush,
      notifySound: s.notifySound,
      notifyVolume: s.notifyVolume,
      sentMessageSound: s.sentMessageSound,
      tabsInSidebar: s.tabsInSidebar,
      passcodeEnabled: s.passcodeEnabled,
      passcodeAutoLockMins: s.passcodeAutoLockMins,
      passcodeLockShortcutEnabled: s.passcodeLockShortcutEnabled,
      passcodeLockShortcut: s.passcodeLockShortcut,
      passcodeCanAttemptAgainOn: s.passcodeCanAttemptAgainOn,
      autoDownloadEnabled: s.autoDownloadEnabled,
      autoDownloadPhoto: s.autoDownloadPhoto,
      autoDownloadVideo: s.autoDownloadVideo,
      autoDownloadFile: s.autoDownloadFile,
      autoDownloadFileSizeMax: s.autoDownloadFileSizeMax,
      cacheTTL: s.cacheTTL,
      cacheSize: s.cacheSize,
      liteMode: s.liteMode,
      showTranslateButton: s.showTranslateButton,
      translateTo: s.translateTo,
      loopStickers: s.loopStickers,
      videoRate: s.videoRate,
      playbackRates: s.playbackRates,
      sidebarLeftWidth: s.sidebarLeftWidth,
      sidebarRightWidth: s.sidebarRightWidth,
      seenSidebarResizeTip: s.seenSidebarResizeTip,
      notifySuggested: s.notifySuggested,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(toSave))
    } catch {
      /* ignore quota / private-mode errors */
    }
  },
}))

/**
 * НАСТРОЙКА «12/24 ЧАСА» → ЯДРО ЛОКАЛИЗАЦИИ.
 *
 * Все метки времени рисует `I18n.IntlDateElement` (`helpers/date.ts`), и часовой
 * цикл он берёт у себя — `I18n.getTimeFormat()`, потому что у `Intl` этой
 * настройки взять неоткуда: он выбирает цикл по ЛОКАЛИ. Настройка у нас есть, у
 * неё есть живой переключатель (`sidebarLeft/tabs/generalSettings.solid.tsx`), — но до задачи 7
 * она СЮДА НЕ ПРИХОДИЛА, и метки времени выбор пользователя игнорировали (дефект
 * был помечен в докблоке `helpers/date.ts`).
 *
 * Подписка, а не разовая установка: `setTimeFormat` не только запоминает цикл, но
 * и ПЕРЕРИСОВЫВАЕТ уже показанные даты (`I18n.setTimeFormat`, порт tweb :149-166) —
 * иначе переключатель менял бы только те метки, что нарисуются после него. Одна
 * подписка покрывает оба пути смены: `update()` и кросс-табовый `storage` ниже.
 */
const hourCycle = (format: TimeFormat) => format === '12h' ? 'h12' : 'h23'
I18n.setTimeFormat(hourCycle(useSettingsStore.getState().timeFormat))
useSettingsStore.subscribe((state, prev) => {
  if(state.timeFormat !== prev.timeFormat) I18n.setTimeFormat(hourCycle(state.timeFormat))
})

// Кросс-таб-синхронизация настроек: localStorage.setItem в одной вкладке рождает
// `storage`-событие во ВСЕХ остальных вкладках — подхватываем и обновляем стор
// напрямую (setState, без обратной записи в localStorage → без петли). Так смена
// темы/формата времени/уведомлений в одной вкладке отражается в других мгновенно.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    try {
      useSettingsStore.setState(JSON.parse(e.newValue) as Partial<Settings>)
    } catch {
      /* битый JSON — игнорируем */
    }
  })
}

// Read settings. Без аргумента — весь объект (+ update), как раньше. С селектором
// — подписка только на выбранный срез (zustand-идиома): горячие мемо-потребители
// (MessageRow) не должны ре-рендериться на смену несвязанного поля, напр. смена
// языка не должна инвалидировать весь фид. Для одного поля Object.is-сравнение
// стора достаточно; для нескольких полей используйте отдельные вызовы селектора
// (иначе object-селектор без useShallow даёт новый объект каждый рендер).
export function useSettings(): SettingsState
export function useSettings<T>(selector: (s: SettingsState) => T): T
export function useSettings<T>(selector?: (s: SettingsState) => T): SettingsState | T {
  return selector ? useSettingsStore(selector) : useSettingsStore()
}

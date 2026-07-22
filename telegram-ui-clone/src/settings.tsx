import { useCallback } from 'react'
import { create } from 'zustand'
import type { ThemeChoice } from './theme'
import type { Wallpaper } from './wallpapers'

export type TimeFormat = '12h' | '24h'

// What the chat wallpaper currently shows (тип живёт в ./wallpapers вместе с
// чистой логикой выбора активного фона).
export type { Wallpaper }

export interface Settings {
  themeChoice: ThemeChoice
  textSize: number // message bubble font size (px)
  timeFormat: TimeFormat
  wallpaper: Wallpaper
  wallpaperBlur: boolean
  // Свои обои чата, загруженные фото (tweb background upload): media_id
  // выбранного изображения. Приоритет над пресетом/цветом (wallpaper) — пока
  // задан, фон рисуется этим фото. customWallpaperBlur — размытие поверх (toggle).
  customWallpaperMediaId?: number
  customWallpaperBlur?: boolean
  // Устройства для звонков (Настройки → Динамики и камера); '' = системное
  // по умолчанию. deviceId из enumerateDevices, читаются при старте звонка.
  speakerId: string
  micId: string
  cameraId: string
  acceptCalls: boolean
  // Тип записи кнопкой в композере (tweb recordingMediaType): голос или кружок
  recordingMediaType: 'voice' | 'round'
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
  // (0 — выключен). Хеш и соль лежат в IndexedDB (core/passcode.ts).
  passcodeEnabled: boolean
  passcodeAutoLockMins: number
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
  // Без анимаций (tweb liteMode.animations): выключает интерфейсные анимации
  // (framer MotionConfig reducedMotion + css-гейт).
  reduceMotion: boolean
  // Перевод сообщений (tweb translations): показывать ли пункт «Перевести» в
  // контекстном меню; translateTo — целевой язык (ISO-код), '' = язык интерфейса.
  showTranslateButton: boolean
  translateTo: string
  // Зацикливать анимированные стикеры в чате (tweb settings.stickers.loop).
  loopStickers: boolean
  // Скорость воспроизведения видео в медиа-вьюере (tweb appMediaPlaybackController
  // .playbackRate): восстанавливается при открытии следующего видео. Дефолт 1.
  videoRate: number
}

// Галочки автозагрузки по типам чатов (tweb AutoDownloadPeerTypeSettings).
export interface AutoDownloadPeerTypes {
  contacts: boolean
  private: boolean
  groups: boolean
  channels: boolean
}

const AUTO_DOWNLOAD_ALL: AutoDownloadPeerTypes = { contacts: true, private: true, groups: true, channels: true }

const DEFAULTS: Settings = {
  themeChoice: 'system',
  textSize: 16,
  timeFormat: '24h',
  wallpaper: { kind: 'default' },
  wallpaperBlur: false,
  customWallpaperMediaId: undefined,
  customWallpaperBlur: false,
  speakerId: '',
  micId: '',
  cameraId: '',
  acceptCalls: true,
  recordingMediaType: 'voice',
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
  autoDownloadEnabled: true,
  autoDownloadPhoto: { ...AUTO_DOWNLOAD_ALL },
  autoDownloadVideo: { ...AUTO_DOWNLOAD_ALL },
  autoDownloadFile: { ...AUTO_DOWNLOAD_ALL },
  autoDownloadFileSizeMax: 3145728, // 3 МБ (tweb autoDownloadNew.file_size_max)
  cacheTTL: 86400 * 7, // неделя (tweb SETTINGS_INIT.cacheTTL)
  cacheSize: 0, // Авто (tweb SETTINGS_INIT.cacheSize)
  reduceMotion: false,
  showTranslateButton: true,
  translateTo: '',
  loopStickers: true, // tweb stickers.loop default true
  videoRate: 1,
}

const KEY = 'tg-settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      // migrate the legacy stand-alone theme key, if present
      const legacy = localStorage.getItem('tg-theme')
      if (legacy === 'light') return { ...DEFAULTS, themeChoice: 'classic' }
      if (legacy === 'dark') return { ...DEFAULTS, themeChoice: 'night' }
      return DEFAULTS
    }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
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
      wallpaperBlur: s.wallpaperBlur,
      customWallpaperMediaId: s.customWallpaperMediaId,
      customWallpaperBlur: s.customWallpaperBlur,
      speakerId: s.speakerId,
      micId: s.micId,
      cameraId: s.cameraId,
      acceptCalls: s.acceptCalls,
      recordingMediaType: s.recordingMediaType,
      notifyDesktop: s.notifyDesktop,
      notifyPush: s.notifyPush,
      notifySound: s.notifySound,
      notifyVolume: s.notifyVolume,
      sentMessageSound: s.sentMessageSound,
      tabsInSidebar: s.tabsInSidebar,
      passcodeEnabled: s.passcodeEnabled,
      passcodeAutoLockMins: s.passcodeAutoLockMins,
      autoDownloadEnabled: s.autoDownloadEnabled,
      autoDownloadPhoto: s.autoDownloadPhoto,
      autoDownloadVideo: s.autoDownloadVideo,
      autoDownloadFile: s.autoDownloadFile,
      autoDownloadFileSizeMax: s.autoDownloadFileSizeMax,
      cacheTTL: s.cacheTTL,
      cacheSize: s.cacheSize,
      reduceMotion: s.reduceMotion,
      showTranslateButton: s.showTranslateButton,
      translateTo: s.translateTo,
      loopStickers: s.loopStickers,
      videoRate: s.videoRate,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(toSave))
    } catch {
      /* ignore quota / private-mode errors */
    }
  },
}))

// Read the whole settings object (+ update) — same shape the old context returned.
export function useSettings(): SettingsState {
  return useSettingsStore()
}

// Convert a stored 24h "HH:MM" string to the user's preferred format.
export function formatTime(hhmm: string, fmt: TimeFormat): string {
  if (fmt === '24h') return hhmm
  const parts = hhmm.match(/^(\d{1,2}):(\d{2})/)
  if (!parts) return hhmm
  let h = parseInt(parts[1], 10)
  const min = parts[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${min} ${ampm}`
}

export function useTimeFormatter(): (hhmm: string | undefined) => string | undefined {
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  return useCallback((hhmm: string | undefined) => (hhmm == null ? hhmm : formatTime(hhmm, timeFormat)), [timeFormat])
}

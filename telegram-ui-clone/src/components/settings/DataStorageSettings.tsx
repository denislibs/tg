// DataStorageSettings — «Данные и память» (tweb sidebarLeft/tabs/dataAndStorage):
// секция «Автозагрузка медиа» (общий чекбокс, ряды Фото/Видео/Файлы с
// под-экранами, сброс с confirm) + секция «Расчётный объём хранения»
// (подсчёт кэша по типам, очистка, слайдеры TTL/лимита).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import Checkbox from '../../shared/ui/Checkbox'
import Slider from '../../shared/ui/Slider'
import TgIcon from '../TgIcon'
import type { IconName } from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import { useSettingsStore, type AutoDownloadPeerTypes, type Settings } from '../../settings'
import { collectCachedFilesSizes, clearCachedFiles, syncCacheSettingsToSW, formatBytes, type CachedFilesSizes } from '../../core/mediaCache'
import { useT } from '../../i18n'
import { EASE } from '../../motion'
import s from './DataStorageSettings.module.scss'

type MediaType = 'photo' | 'video' | 'file'

const SETTING_KEY: Record<MediaType, 'autoDownloadPhoto' | 'autoDownloadVideo' | 'autoDownloadFile'> = {
  photo: 'autoDownloadPhoto',
  video: 'autoDownloadVideo',
  file: 'autoDownloadFile',
}

const PEER_KEYS = ['contacts', 'private', 'groups', 'channels'] as const
// Короткие подписи для перечисления в сабтайтле (tweb AutoDownloadContacts/Pm/…)
const PEER_SHORT: Record<(typeof PEER_KEYS)[number], string> = {
  contacts: 'Contacts', private: 'PM', groups: 'Groups', channels: 'Channels',
}
// Подписи чекбокс-рядов под-экрана (tweb AutodownloadContacts/PrivateChats/…)
const PEER_ROW: Record<(typeof PEER_KEYS)[number], string> = {
  contacts: 'Contacts', private: 'Private Chats', groups: 'Group Chats', channels: 'Channels',
}

const AD_DEFAULTS: AutoDownloadPeerTypes = { contacts: true, private: true, groups: true, channels: true }
const FILE_SIZE_MAX_DEFAULT = 3145728

// Слайдер размера файла (tweb autoDownload/file.tsx): нелинейная шкала value⁴
const FILE_MIN = 512 * 1024
const FILE_MAX = 20 * 1024 * 1024
const FILE_RANGE = FILE_MAX - FILE_MIN

const DAY = 86400
const WEEK = DAY * 7
const MONTH = DAY * 30
// tweb storageQuota cacheTimeOptions: 1–6 дней, 1–3 недели, 1–6 месяцев, год
const CACHE_TIME_OPTIONS: { value: number; label: string }[] = [
  { value: DAY, label: '1 day' }, { value: DAY * 2, label: '2 days' }, { value: DAY * 3, label: '3 days' },
  { value: DAY * 4, label: '4 days' }, { value: DAY * 5, label: '5 days' }, { value: DAY * 6, label: '6 days' },
  { value: WEEK, label: '1 week' }, { value: WEEK * 2, label: '2 weeks' }, { value: WEEK * 3, label: '3 weeks' },
  { value: MONTH, label: '1 month' }, { value: MONTH * 2, label: '2 months' }, { value: MONTH * 3, label: '3 months' },
  { value: MONTH * 4, label: '4 months' }, { value: MONTH * 5, label: '5 months' }, { value: MONTH * 6, label: '6 months' },
  { value: DAY * 365, label: '1 year' },
]

const MB = 1024 * 1024
const GB = MB * 1024
// tweb getCacheSizeOptions: 100–900 МБ, 1–10 ГБ, 0 = Авто (последняя)
const CACHE_SIZE_VALUES = [
  ...Array.from({ length: 9 }, (_, i) => (i + 1) * 100 * MB),
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * GB),
  0,
]

// Индекс ближайшей опции ≤ значения (tweb getInitialCacheTimeIdx/SizeIdx)
function nearestIdx(value: number, values: number[]): number {
  let found = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= value) found = i
  }
  return found
}

// Confirm-диалог (tweb confirmationPopup): заголовок, текст, Отмена/действие.
function ConfirmDialog({ title, text, action, onConfirm, onClose }: {
  title: string
  text: string
  action: string
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={s.confirmCard}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ marginBottom: 8 }}>{title}</Text>
        <Text size={14.5} color="var(--tg-textSecondary)">{text}</Text>
        <div className={s.confirmActions}>
          <div className={s.confirmAction} onClick={onClose}>{t('Cancel')}</div>
          <div className={s.confirmAction} onClick={() => { onConfirm(); onClose() }}>{action}</div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

// Сабтайтл ряда Фото/Видео/Файлы (tweb setAutoDownloadSubtitle):
// «Выключено» / «Включено для всех чатов» / «До 3.0 МБ для всех чатов» /
// «Включено для: Контакты, Группы» / «До 3.0 МБ для: …».
function autoDownloadSubtitle(
  types: AutoDownloadPeerTypes,
  enabled: boolean,
  t: (k: string) => string,
  sizeMax?: number,
): string {
  const enabledKeys = PEER_KEYS.filter((k) => types[k])
  if (!enabled || !enabledKeys.length || sizeMax === 0) return t('Off')
  const isAll = enabledKeys.length === PEER_KEYS.length
  const list = enabledKeys.map((k) => t(PEER_SHORT[k])).join(', ')
  if (sizeMax !== undefined) {
    const size = formatBytes(sizeMax, t)
    return isAll
      ? t('Up to %1$s in all chats').replace('%1$s', size)
      : t('Up to %1$s for %2$s').replace('%1$s', size).replace('%2$s', list)
  }
  return isAll ? t('On in all chats') : t('On for %1$s').replace('%1$s', list)
}

// Под-экран «Автозагрузка фото/видео/файлов»: 4 чекбокса по типам чатов,
// у файлов — слайдер максимального размера (tweb peerTypeSection + file.tsx).
function AutoDownloadTypeScreen({ type, onBack }: { type: MediaType; onBack: () => void }) {
  const t = useT()
  const key = SETTING_KEY[type]
  const types = useSettingsStore((st) => st[key])
  const fileSizeMax = useSettingsStore((st) => st.autoDownloadFileSizeMax)
  const update = useSettingsStore((st) => st.update)

  const title = type === 'photo' ? 'Auto-download photos'
    : type === 'video' ? 'Auto-download videos and GIFs' : 'Auto-download files and music'

  // value⁴-шкала: слайдер держит [0..1], размер = v⁴·range+min (tweb)
  const [sliderVal, setSliderVal] = useState(() => Math.sqrt(Math.sqrt((fileSizeMax - FILE_MIN) / FILE_RANGE)))
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sizeOf = (v: number) => (v ** 4 * FILE_RANGE + FILE_MIN) | 0
  const onSlider = (v: number) => {
    setSliderVal(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => update({ autoDownloadFileSizeMax: sizeOf(v) }), 200)
  }

  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={70}>
      <Section>
        {PEER_KEYS.map((k) => (
          <Row
            key={k}
            icon={<Checkbox checked={types[k]} shape="square" size={20} />}
            label={PEER_ROW[k]}
            onClick={() => update({ [key]: { ...types, [k]: !types[k] } })}
          />
        ))}
        {type === 'file' && (
          <div className={s.range}>
            <div className={s.rangeDetails}>
              <Text size={16} color="var(--tg-textPrimary)">{t('Maximum file size')}</Text>
              <Text size={15} color="var(--tg-textSecondary)">
                {t('up to %1$s').replace('%1$s', formatBytes(sizeOf(sliderVal), t))}
              </Text>
            </div>
            <Slider value={sliderVal} min={0} max={1} step={0.01} onChange={onSlider} className={s.rangeSlider} />
          </div>
        )}
      </Section>
    </SettingsScreen>
  )
}

export default function DataStorageSettings({ onBack }: { onBack: () => void }) {
  const t = useT()
  const settings = useSettingsStore()
  const { update } = settings
  const [sub, setSub] = useState<MediaType | null>(null)
  const [confirm, setConfirm] = useState<'reset' | 'files' | 'all' | null>(null)

  // Подсчёт кэша (tweb collectCachedFilesSizes) — на маунте и после очисток
  const [sizes, setSizes] = useState<CachedFilesSizes | null>(null)
  const recount = () => { void collectCachedFilesSizes().then(setSizes).catch(() => {}) }
  useEffect(() => {
    if (sub === null) recount()
  }, [sub])

  const fmt = (n: number | undefined) => (sizes == null || n == null ? t('Loading') : formatBytes(n, t, 1))

  // Слайдеры TTL/лимита — индексы опций; сохранение сразу + синк в SW
  const [timeIdx, setTimeIdx] = useState(() => nearestIdx(settings.cacheTTL, CACHE_TIME_OPTIONS.map((o) => o.value)))
  const [sizeIdx, setSizeIdx] = useState(() => (settings.cacheSize === 0 ? CACHE_SIZE_VALUES.length - 1 : nearestIdx(settings.cacheSize, CACHE_SIZE_VALUES.slice(0, -1))))
  const applyCacheSettings = (ttl: number, size: number) => {
    update({ cacheTTL: ttl, cacheSize: size })
    syncCacheSettingsToSW(ttl, size)
  }

  const changed = useMemo(() => {
    const same = (a: AutoDownloadPeerTypes, b: AutoDownloadPeerTypes) => PEER_KEYS.every((k) => a[k] === b[k])
    return !settings.autoDownloadEnabled
      || !same(settings.autoDownloadPhoto, AD_DEFAULTS)
      || !same(settings.autoDownloadVideo, AD_DEFAULTS)
      || !same(settings.autoDownloadFile, AD_DEFAULTS)
      || settings.autoDownloadFileSizeMax !== FILE_SIZE_MAX_DEFAULT
  }, [settings])

  const resetAutoDownload = () => {
    const patch: Partial<Settings> = {
      autoDownloadEnabled: true,
      autoDownloadPhoto: { ...AD_DEFAULTS },
      autoDownloadVideo: { ...AD_DEFAULTS },
      autoDownloadFile: { ...AD_DEFAULTS },
      autoDownloadFileSizeMax: FILE_SIZE_MAX_DEFAULT,
    }
    update(patch)
  }

  const clearFiles = () => {
    setSizes({ total: 0, images: 0, videos: 0, stickers: 0, other: 0 })
    void clearCachedFiles().then(recount)
  }

  const disabled = !settings.autoDownloadEnabled

  const quotaIconRow = (icon: IconName, label: string, value: number | undefined) => (
    <div className={s.quotaRow}>
      <div className={s.quotaIcon}><TgIcon name={icon} size={24} /></div>
      <div className={s.quotaBody}>
        <Text size={16} color="var(--tg-textPrimary)">{t(label)}</Text>
        <Text size={13.5} color="var(--tg-textSecondary)">{fmt(value)}</Text>
      </div>
    </div>
  )

  return (
    <SettingsScreen title="Data and Storage" onBack={onBack} zIndex={50}>
      <Section caption="Automatic media download" footer="Voice messages are tiny, so they're always downloaded automatically.">
        <Row
          icon={<Checkbox checked={settings.autoDownloadEnabled} shape="square" size={20} />}
          label="Auto-Download Media"
          onClick={() => update({ autoDownloadEnabled: !settings.autoDownloadEnabled })}
        />
        <div className={disabled ? s.disabled : undefined}>
          <Row
            label="Photos"
            sublabel={autoDownloadSubtitle(settings.autoDownloadPhoto, settings.autoDownloadEnabled, t)}
            onClick={() => setSub('photo')}
          />
          <Row
            label="Videos"
            sublabel={autoDownloadSubtitle(settings.autoDownloadVideo, settings.autoDownloadEnabled, t)}
            onClick={() => setSub('video')}
          />
          <Row
            label="Files"
            sublabel={autoDownloadSubtitle(settings.autoDownloadFile, settings.autoDownloadEnabled, t, settings.autoDownloadFileSizeMax)}
            onClick={() => setSub('file')}
          />
        </div>
        <div className={changed ? undefined : s.disabled}>
          <Row
            icon={<TgIcon name="delete" size={24} />}
            label="Reset Auto-Download Settings"
            accent
            onClick={() => setConfirm('reset')}
          />
        </div>
      </Section>

      <Section caption="Estimated storage quota" footer="Note that cache required for the app to function properly will not be cleared.">
        <div className={s.quotaRow}>
          <div className={s.quotaBody}>
            <Text size={16} color="var(--tg-textPrimary)">{t('Cached files')}</Text>
            <Text size={13.5} color="var(--tg-textSecondary)">{fmt(sizes?.total)}</Text>
          </div>
          <div className={s.clearBtn} onClick={() => setConfirm('files')}>
            <Text size={15} weight={600} color="var(--tg-accent)">{t('Clear')}</Text>
          </div>
        </div>
        {quotaIconRow('image', 'Images', sizes?.images)}
        {quotaIconRow('play', 'Video files', sizes?.videos)}
        {quotaIconRow('stickers_face', 'Stickers and emojis', sizes?.stickers)}
        {quotaIconRow('limit_file', 'Other', sizes?.other)}

        <div className={s.range}>
          <div className={s.rangeDetails}>
            <Text size={16} color="var(--tg-textPrimary)">{t('Clear cache older than')}</Text>
            <Text size={15} color="var(--tg-textSecondary)">{t(CACHE_TIME_OPTIONS[timeIdx].label)}</Text>
          </div>
          <Slider
            value={timeIdx} min={0} max={CACHE_TIME_OPTIONS.length - 1} step={1}
            onChange={(i) => { setTimeIdx(i); applyCacheSettings(CACHE_TIME_OPTIONS[i].value, settings.cacheSize) }}
            className={s.rangeSlider}
          />
        </div>
        <div className={s.range}>
          <div className={s.rangeDetails}>
            <Text size={16} color="var(--tg-textPrimary)">{t('Cache size limit')}</Text>
            <Text size={15} color="var(--tg-textSecondary)">
              {CACHE_SIZE_VALUES[sizeIdx] === 0 ? t('Auto') : formatBytes(CACHE_SIZE_VALUES[sizeIdx], t)}
            </Text>
          </div>
          <Slider
            value={sizeIdx} min={0} max={CACHE_SIZE_VALUES.length - 1} step={1}
            onChange={(i) => { setSizeIdx(i); applyCacheSettings(settings.cacheTTL, CACHE_SIZE_VALUES[i]) }}
            className={s.rangeSlider}
          />
        </div>

        <Row
          icon={<TgIcon name="delete" size={24} />}
          label="Clear All"
          accent
          onClick={() => setConfirm('all')}
        />
      </Section>

      <AnimatePresence>
        {sub && <AutoDownloadTypeScreen type={sub} onBack={() => setSub(null)} />}
      </AnimatePresence>

      {confirm === 'reset' && (
        <ConfirmDialog
          title={t('Reset settings')}
          text={t('Are you sure you want to reset auto-download settings?')}
          action={t('Reset')}
          onConfirm={resetAutoDownload}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'files' && (
        <ConfirmDialog
          title={t('Clear cached files')}
          text={sizes && sizes.total > 0
            ? t('Are you sure you want to clear %s of cached data?').replace('%s', formatBytes(sizes.total, t, 1))
            : t('Are you sure you want to clear the cached data?')}
          action={t('Clear')}
          onConfirm={clearFiles}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'all' && (
        <ConfirmDialog
          title={t('Clear All')}
          text={t('Are you sure you want to clear all cached data?')}
          action={t('Clear')}
          onConfirm={clearFiles}
          onClose={() => setConfirm(null)}
        />
      )}
    </SettingsScreen>
  )
}

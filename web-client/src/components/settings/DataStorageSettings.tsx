// DataStorageSettings — «Данные и память» (tweb sidebarLeft/tabs/dataAndStorage):
// секция «Автозагрузка медиа» (общий чекбокс, ряды Фото/Видео/Файлы с
// под-экранами, сброс с confirm) + секция «Расчётный объём хранения»
// (подсчёт кэша по типам, очистка, слайдеры TTL/лимита).
import type { LangPackKey } from '@/lang'
import { useEffect, useMemo, useRef, useState } from 'react'
import Text from '../../shared/ui/Text'
import Checkbox from '../../shared/ui/Checkbox'
import Slider from '../../shared/ui/Slider'
import TgIcon from '../TgIcon'
import type { IconName } from '../TgIcon'
import { SettingsScreen, Section, Row } from './kit'
import { useSettingsStore, type AutoDownloadPeerTypes, type Settings } from '../../settings'
import { collectCachedFilesSizes, clearCachedFiles, syncCacheSettingsToSW, formatBytes, type CachedFilesSizes } from '../../core/mediaCache'
import { useT } from '../../i18n'
import ConfirmDialog from './ConfirmDialog'
import s from './DataStorageSettings.module.scss'

type MediaType = 'photo' | 'video' | 'file'

const SETTING_KEY: Record<MediaType, 'autoDownloadPhoto' | 'autoDownloadVideo' | 'autoDownloadFile'> = {
  photo: 'autoDownloadPhoto',
  video: 'autoDownloadVideo',
  file: 'autoDownloadFile',
}

const PEER_KEYS = ['contacts', 'private', 'groups', 'channels'] as const
// Короткие подписи для перечисления в сабтайтле (tweb AutoDownloadContacts/Pm/…)
const PEER_SHORT: Record<(typeof PEER_KEYS)[number], LangPackKey> = {
  contacts: 'Contacts', private: 'AutoDownloadPm', groups: 'ChatList.Filter.Groups', channels: 'ChatList.Filter.Channels',
}
// Подписи чекбокс-рядов под-экрана (tweb AutodownloadContacts/PrivateChats/…)
const PEER_ROW: Record<(typeof PEER_KEYS)[number], string> = {
  contacts: 'Contacts', private: 'AutodownloadPrivateChats', groups: 'AutodownloadGroupChats', channels: 'ChatList.Filter.Channels',
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
const CACHE_TIME_OPTIONS: { value: number; label: LangPackKey }[] = [
  { value: DAY, label: 'Duration.Days1' }, { value: DAY * 2, label: 'Duration.Days2' }, { value: DAY * 3, label: 'Duration.Days3' },
  { value: DAY * 4, label: 'Duration.Days4' }, { value: DAY * 5, label: 'Duration.Days5' }, { value: DAY * 6, label: 'Duration.Days6' },
  { value: WEEK, label: 'Duration.Weeks1' }, { value: WEEK * 2, label: 'Duration.Weeks2' }, { value: WEEK * 3, label: 'Duration.Weeks3' },
  { value: MONTH, label: 'Duration.Months1' }, { value: MONTH * 2, label: 'Duration.Months2' }, { value: MONTH * 3, label: 'Duration.Months3' },
  { value: MONTH * 4, label: 'Duration.Months4' }, { value: MONTH * 5, label: 'Duration.Months5' }, { value: MONTH * 6, label: 'Duration.Months6' },
  { value: DAY * 365, label: 'Duration.Years1' },
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

// Сабтайтл ряда Фото/Видео/Файлы (tweb setAutoDownloadSubtitle):
// «Выключено» / «Включено для всех чатов» / «До 3.0 МБ для всех чатов» /
// «Включено для: Контакты, Группы» / «До 3.0 МБ для: …».
function autoDownloadSubtitle(
  types: AutoDownloadPeerTypes,
  enabled: boolean,
  t: (key: LangPackKey) => string,
  sizeMax?: number,
): string {
  const enabledKeys = PEER_KEYS.filter((k) => types[k])
  if (!enabled || !enabledKeys.length || sizeMax === 0) return t('Off')
  const isAll = enabledKeys.length === PEER_KEYS.length
  const list = enabledKeys.map((k) => t(PEER_SHORT[k])).join(', ')
  if (sizeMax !== undefined) {
    const size = formatBytes(sizeMax, t)
    return isAll
      ? t('AutoDownloadUpToOnAllChats').replace('%1$s', size)
      : t('AutoDownloadOnUpToFor').replace('%1$s', size).replace('%2$s', list)
  }
  return isAll ? t('AutoDownloadOnAllChats') : t('AutoDownloadOnFor').replace('%1$s', list)
}

// Под-экран «Автозагрузка фото/видео/файлов»: 4 чекбокса по типам чатов,
// у файлов — слайдер максимального размера (tweb peerTypeSection + file.tsx).
function AutoDownloadTypeScreen({ type, onBack }: { type: MediaType; onBack: () => void }) {
  const t = useT()
  const key = SETTING_KEY[type]
  const types = useSettingsStore((st) => st[key])
  const fileSizeMax = useSettingsStore((st) => st.autoDownloadFileSizeMax)
  const update = useSettingsStore((st) => st.update)

  const title = type === 'photo' ? 'AutoDownloadPhotosTitle'
    : type === 'video' ? 'AutoDownloadVideosTitle' : 'AutoDownloadFilesTitle'

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
              <Text size={16} color="var(--primary-text-color)">{t('AutoDownloadMaxFileSize')}</Text>
              <Text size={15} color="var(--secondary-text-color)">
                {t('AutodownloadSizeLimitUpTo').replace('%1$s', formatBytes(sizeOf(sliderVal), t))}
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

  const quotaIconRow = (icon: IconName, label: LangPackKey, value: number | undefined) => (
    <div className={s.quotaRow}>
      <div className={s.quotaIcon}><TgIcon name={icon} size={24} /></div>
      <div className={s.quotaBody}>
        <Text size={16} color="var(--primary-text-color)">{t(label)}</Text>
        <Text size={13.5} color="var(--secondary-text-color)">{fmt(value)}</Text>
      </div>
    </div>
  )

  return (
    <SettingsScreen
      title="DataSettings"
      onBack={onBack}
      zIndex={50}
      sub={sub ? <AutoDownloadTypeScreen type={sub} onBack={() => setSub(null)} /> : null}
    >
      <Section caption="AutomaticMediaDownload" footer="AutoDownloadAudioInfo">
        <Row
          icon={<Checkbox checked={settings.autoDownloadEnabled} shape="square" size={20} />}
          label="AutoDownloadMedia"
          onClick={() => update({ autoDownloadEnabled: !settings.autoDownloadEnabled })}
        />
        <div className={disabled ? s.disabled : undefined}>
          <Row
            label="AutoDownloadPhotos"
            sublabel={autoDownloadSubtitle(settings.autoDownloadPhoto, settings.autoDownloadEnabled, t)}
            onClick={() => setSub('photo')}
          />
          <Row
            label="AutoDownloadVideos"
            sublabel={autoDownloadSubtitle(settings.autoDownloadVideo, settings.autoDownloadEnabled, t)}
            onClick={() => setSub('video')}
          />
          <Row
            label="SharedFilesTab2"
            sublabel={autoDownloadSubtitle(settings.autoDownloadFile, settings.autoDownloadEnabled, t, settings.autoDownloadFileSizeMax)}
            onClick={() => setSub('file')}
          />
        </div>
        <div className={changed ? undefined : s.disabled}>
          <Row
            icon={<TgIcon name="delete" size={24} />}
            label="ResetAutomaticMediaDownload"
            accent
            onClick={() => setConfirm('reset')}
          />
        </div>
      </Section>

      <Section caption="StorageQuota.Title" footer="StorageQuota.Caption">
        <div className={s.quotaRow}>
          <div className={s.quotaBody}>
            <Text size={16} color="var(--primary-text-color)">{t('StorageQuota.CachedFiles')}</Text>
            <Text size={13.5} color="var(--secondary-text-color)">{fmt(sizes?.total)}</Text>
          </div>
          <div className={s.clearBtn} onClick={() => setConfirm('files')}>
            <Text size={15} weight={600} color="var(--primary-color)">{t('Clear')}</Text>
          </div>
        </div>
        {quotaIconRow('image', 'StorageQuota.Images', sizes?.images)}
        {quotaIconRow('play', 'StorageQuota.VideoFiles', sizes?.videos)}
        {quotaIconRow('stickers_face', 'StorageQuota.StickersEmoji', sizes?.stickers)}
        {quotaIconRow('limit_file', 'Other', sizes?.other)}

        <div className={s.range}>
          <div className={s.rangeDetails}>
            <Text size={16} color="var(--primary-text-color)">{t('StorageQuota.ClearCacheOlderThan')}</Text>
            <Text size={15} color="var(--secondary-text-color)">{t(CACHE_TIME_OPTIONS[timeIdx].label)}</Text>
          </div>
          <Slider
            value={timeIdx} min={0} max={CACHE_TIME_OPTIONS.length - 1} step={1}
            onChange={(i) => { setTimeIdx(i); applyCacheSettings(CACHE_TIME_OPTIONS[i].value, settings.cacheSize) }}
            className={s.rangeSlider}
          />
        </div>
        <div className={s.range}>
          <div className={s.rangeDetails}>
            <Text size={16} color="var(--primary-text-color)">{t('StorageQuota.CacheSizeLimit')}</Text>
            <Text size={15} color="var(--secondary-text-color)">
              {CACHE_SIZE_VALUES[sizeIdx] === 0 ? t('StorageQuota.CacheSizeLimitAuto') : formatBytes(CACHE_SIZE_VALUES[sizeIdx], t)}
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
          label="StorageQuota.ClearAll"
          accent
          onClick={() => setConfirm('all')}
        />
      </Section>

      {confirm === 'reset' && (
        <ConfirmDialog
          title="ResetAutomaticMediaDownloadAlertTitle"
          text="ResetAutomaticMediaDownloadAlert"
          action="Reset"
          onConfirm={resetAutoDownload}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'files' && (
        <ConfirmDialog
          title="StorageQuota.ClearCachedFiles"
          text={sizes && sizes.total > 0 ? 'StorageQuota.ClearConfirmation' : 'StorageQuota.ClearConfirmationUnknown'}
          textArgs={sizes && sizes.total > 0 ? [formatBytes(sizes.total, t, 1)] : undefined}
          action="Clear"
          onConfirm={clearFiles}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'all' && (
        <ConfirmDialog
          title="StorageQuota.ClearAll"
          text="StorageQuota.ClearAllConfirmation"
          action="Clear"
          onConfirm={clearFiles}
          onClose={() => setConfirm(null)}
        />
      )}
    </SettingsScreen>
  )
}

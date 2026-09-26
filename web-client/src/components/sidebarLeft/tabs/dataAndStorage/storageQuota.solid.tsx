/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/dataAndStorage/storageQuota.tsx:1-415
 * (812502980) — секция «Estimated storage quota» вкладки «Данные и память»
 * (`dataAndStorage/index.solid.tsx`). Разметка — дамп
 * `14-left-15-settings-data-storage` (вторая секция).
 *
 * Расхождения с оригиналом:
 *  1. (О-6) Строки «Cached video stream chunks» (`:374-382`) и `Space` перед ней
 *     (`:384`) нет, как и `collectCachedVideoStreamChunksSize`/
 *     `onClearCachedVideoStreamChunks` (`:101-116`, `:305-315`): корзин
 *     потоковых чанков у нас нет — стрим при DNP-ON собирает SW из Noise-канала
 *     без CacheStorage (`public/sw.js`, `/dnp-stream/`), при DNP-OFF видео идёт
 *     токен-URL мимо кэша. Отсюда и «Clear All» (`:317-332`) чистит одну корзину
 *     `cachedFiles` — всё, что у нас есть в `watchedCachedStorageNames` tweb.
 *  2. Подсчёт и очистка — `core/mediaCache.ts` (`collectCachedFilesSizes`,
 *     `clearCachedFiles`), а не `CacheStorageController
 *     .minimalBlockingIterateResponses` и `apiManagerProxy
 *     .clearCacheStoragesByNames` (`:53-87`, `:298`): у нашего контроллера корзин
 *     нет итератора и нет потока, которому поручена очистка. Форма результата —
 *     наша (`{total, images, …}` вместо `{totalSize, collectedSizeByTypes}`);
 *     «стикеры» — lottie-типы (`isLottieMime`), у tweb — `application/json`.
 *  3. Размеры — строкой `formatBytes` из `core/mediaCache.ts` (ключи `Unit.*`),
 *     у tweb `helpers/formatBytes.ts` отдаёт узел `i18n('FileSize.*')`. Второго
 *     `formatBytes` не заводим: им же подписаны документы и аудио.
 *  4. `I18nTsx key=…` → `i18n(key)`: ключи статичны, узел тот же (`IntlElement`).
 *     Кнопка подтверждения — `langKey: 'StorageQuota.Clear'`, а не `text:
 *     i18n(…)` (`:282-284`): наш `PopupButton` берёт ключ отдельным полем.
 *     `useHotReloadGuard` не нужен — HMR-ветки tweb не портированы; `namedPromises`
 *     (`:325-328`) не нужен — считать осталось одно.
 *  5. `oneDayInSeconds`… — локальные константы (у tweb `lib/constants.ts:21-24`,
 *     модуля с ними у нас нет). Месяц — 31 день, как у tweb. Прежний React-экран
 *     считал месяц 30 днями; такие сохранённые значения (30·k дней, k = 1…6)
 *     `settings.tsx::load` читает как те же «k месяцев» tweb (31·k дней), поэтому
 *     вкладка показывает их своим шагом и на закрытии ничего не пишет.
 *  6. Побочка записи `cacheTTL`/`cacheSize` — отдать их SW — не здесь, а у самой
 *     настройки (`core/mediaCache.ts::watchCacheSettings`); у tweb SW читает
 *     настройки из состояния сам (`serviceWorker/clearOldCache.ts:30`, `:81`).
 */
import { createResource, createSignal, Match, Switch, type JSX, type Resource } from 'solid-js'
import I18n, { i18n, type FormatterArgument, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { collectCachedFilesSizes, clearCachedFiles, formatBytes as formatBytesT, type CachedFilesSizes } from '@core/mediaCache'
import { DurationType } from '@helpers/formatDuration'
import { wrapAsyncClickHandler } from '@helpers/wrapAsyncClickHandler'
import { wrapFormattedDuration } from '@components/wrappers/wrapDuration'
import { useAppSettings } from '@stores/appSettings.solid'
import Button from '@components/buttonTsx.solid'
import RangeSettingSelector from '@components/rangeSettingSelector.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import Space from '@components/space.solid'
import { confirmationPopup } from '@components/popups/popupPeer'
import styles from './storageQuota.module.scss'

const oneDayInSeconds = 24 * 60 * 60
const oneWeekInSeconds = oneDayInSeconds * 7
const oneMonthInSeconds = oneDayInSeconds * 31
const oneYearInSeconds = oneDayInSeconds * 365

const formatBytes = (bytes: number, decimals?: number) =>
  formatBytesT(bytes, (key) => I18n.format(key, true), decimals)

const decimalsForFormatBytes = 1

type ConfirmationArgs = {
  titleLangKey: LangPackKey
  descriptionLangKey: LangPackKey
  descriptionLangArgs?: FormatterArguments
}

const getClearCachedFilesArgs = (size: FormatterArgument | null): ConfirmationArgs => ({
  titleLangKey: 'StorageQuota.ClearCachedFiles',
  descriptionLangKey: size ? 'StorageQuota.ClearConfirmation' : 'StorageQuota.ClearConfirmationUnknown',
  descriptionLangArgs: size ? [size] : undefined,
})

// tweb :35-39 — `getClearStreamChunksArgs`: О-6 (расхождение 1).

const getClearAllArgs = (): ConfirmationArgs => ({
  titleLangKey: 'StorageQuota.ClearAll',
  descriptionLangKey: 'StorageQuota.ClearAllConfirmation',
})

const tryFormatBytes = (size: number | null | undefined) => {
  if(typeof size !== 'number') return null
  return formatBytes(size, decimalsForFormatBytes)
}

const getZeroedCollectedCachedFilesSizes = (): CachedFilesSizes => ({
  total: 0,
  images: 0,
  videos: 0,
  stickers: 0,
  other: 0,
})

const SizeWithFallback = (props: {
  resource: Resource<unknown>
  value: number | undefined
}) => (
  <Switch>
    <Match when={props.resource.loading}>
      {i18n('Loading')}
    </Match>
    <Match when={props.resource.state === 'ready'}>
      {formatBytes(props.value!, decimalsForFormatBytes)}
    </Match>
    <Match when>
      {i18n('StorageQuota.FailedToCalculate')}
    </Match>
  </Switch>
)

type Option = {
  value: number
  label: () => JSX.Element
}

const makeTimeOption = (value: number, duration: number, type: DurationType): Option => ({
  value,
  label: () => wrapFormattedDuration([{ duration, type }]),
})

const cacheTimeOptions = [
  makeTimeOption(oneDayInSeconds, 1, DurationType.Days),
  makeTimeOption(oneDayInSeconds * 2, 2, DurationType.Days),
  makeTimeOption(oneDayInSeconds * 3, 3, DurationType.Days),
  makeTimeOption(oneDayInSeconds * 4, 4, DurationType.Days),
  makeTimeOption(oneDayInSeconds * 5, 5, DurationType.Days),
  makeTimeOption(oneDayInSeconds * 6, 6, DurationType.Days),
  makeTimeOption(oneWeekInSeconds, 1, DurationType.Weeks),
  makeTimeOption(oneWeekInSeconds * 2, 2, DurationType.Weeks),
  makeTimeOption(oneWeekInSeconds * 3, 3, DurationType.Weeks),
  makeTimeOption(oneMonthInSeconds, 1, DurationType.Months),
  makeTimeOption(oneMonthInSeconds * 2, 2, DurationType.Months),
  makeTimeOption(oneMonthInSeconds * 3, 3, DurationType.Months),
  makeTimeOption(oneMonthInSeconds * 4, 4, DurationType.Months),
  makeTimeOption(oneMonthInSeconds * 5, 5, DurationType.Months),
  makeTimeOption(oneMonthInSeconds * 6, 6, DurationType.Months),
  makeTimeOption(oneYearInSeconds, 1, DurationType.Years),
]

const makeSizeOption = (value: number): Option => ({
  value,
  label: () => formatBytes(value, decimalsForFormatBytes),
})

const mb = 1024 * 1024
const gb = mb * 1024

// tweb :180-183 — `haveSmallSize = false && DEBUG` (опция 10 МБ для отладки)
// выключена у самого оригинала; ветку не переносим.
const getCacheSizeOptions = (autoLabel: () => JSX.Element): Option[] => [
  makeSizeOption(100 * mb),
  makeSizeOption(200 * mb),
  makeSizeOption(300 * mb),
  makeSizeOption(400 * mb),
  makeSizeOption(500 * mb),
  makeSizeOption(600 * mb),
  makeSizeOption(700 * mb),
  makeSizeOption(800 * mb),
  makeSizeOption(900 * mb),
  makeSizeOption(1 * gb),
  makeSizeOption(2 * gb),
  makeSizeOption(3 * gb),
  makeSizeOption(4 * gb),
  makeSizeOption(5 * gb),
  makeSizeOption(6 * gb),
  makeSizeOption(7 * gb),
  makeSizeOption(8 * gb),
  makeSizeOption(9 * gb),
  makeSizeOption(10 * gb),
  {
    value: 0,
    label: autoLabel,
  },
]

const getInitialCacheTimeIdx = (cacheTTL: number) => {
  const value = cacheTTL || 0
  let foundIdx = 0
  for(let i = 1; i < cacheTimeOptions.length; i++) {
    if(cacheTimeOptions[i].value <= value) foundIdx = i
  }
  return foundIdx
}

const getInitialCacheSizeIdx = (cacheSize: number, options: Option[]) => {
  const value = cacheSize || 0
  if(value === 0) return options.length - 1

  let foundIdx = 0
  for(let i = 1; i < options.length - 1; i++) {
    if(options[i].value <= value) foundIdx = i
  }
  return foundIdx
}

export type StorageQuotaControls = {
  save: () => Promise<void>
}

type Props = {
  controlsRef: (controls: StorageQuotaControls) => void
}

export const StorageQuota = (props: Props) => {
  const cacheSizeOptions = getCacheSizeOptions(() => i18n('StorageQuota.CacheSizeLimitAuto'))

  const [appSettings, setAppSettings] = useAppSettings()

  const [cachedFilesSizes, cachedFilesSizesActions] = createResource(collectCachedFilesSizes)

  const [cacheTimeIdx, setCacheTimeIdx] = createSignal<number>(getInitialCacheTimeIdx(appSettings.cacheTTL))
  const [cacheSizeIdx, setCacheSizeIdx] = createSignal<number>(getInitialCacheSizeIdx(appSettings.cacheSize, cacheSizeOptions))

  const getFinalCacheTTL = () => {
    const option = cacheTimeOptions[cacheTimeIdx()] || cacheTimeOptions[0]
    if(option.value === appSettings.cacheTTL) return

    return option.value
  }

  const getFinalCacheSize = () => {
    const option = cacheSizeOptions[cacheSizeIdx()] || cacheSizeOptions[cacheSizeOptions.length - 1]
    if(option.value === appSettings.cacheSize) return

    return option.value
  }

  props.controlsRef({
    save: async() => {
      const cacheTTL = getFinalCacheTTL()
      const cacheSize = getFinalCacheSize()

      await Promise.all([
        cacheTTL !== undefined ? setAppSettings('cacheTTL', cacheTTL) : Promise.resolve(),
        cacheSize !== undefined ? setAppSettings('cacheSize', cacheSize) : Promise.resolve(),
      ])
    },
  })

  const btnClass = `${styles.Button} primary btn`

  const getConfirmation = async(args: ConfirmationArgs) => {
    try {
      await confirmationPopup({
        ...args,
        button: {
          langKey: 'StorageQuota.Clear',
        },
      })
      return true
    } catch {
      return false
    }
  }

  const onClearCachedFiles = wrapAsyncClickHandler(async() => {
    const formattedSize = tryFormatBytes(cachedFilesSizes.state === 'ready' ? cachedFilesSizes()?.total : null)
    if(!(await getConfirmation(getClearCachedFilesArgs(formattedSize)))) return

    cachedFilesSizesActions.mutate(getZeroedCollectedCachedFilesSizes())

    await clearCachedFiles()

    // Note: refetch triggers 'Loading...' to reappear, we don't want that
    const newValue = await collectCachedFilesSizes()
    cachedFilesSizesActions.mutate(newValue)
  })

  // tweb :305-315 — `onClearCachedVideoStreamChunks`: О-6 (расхождение 1).

  const onClearAllCachedData = wrapAsyncClickHandler(async() => {
    if(!(await getConfirmation(getClearAllArgs()))) return

    cachedFilesSizesActions.mutate(getZeroedCollectedCachedFilesSizes())

    await clearCachedFiles()

    const newCachedFilesSizes = await collectCachedFilesSizes()
    cachedFilesSizesActions.mutate(newCachedFilesSizes)
  })

  return (
    <Section name="StorageQuota.Title" caption="StorageQuota.Caption">
      <Row>
        <Row.Title>{i18n('StorageQuota.CachedFiles')}</Row.Title>
        <Row.Subtitle><SizeWithFallback resource={cachedFilesSizes} value={cachedFilesSizes()?.total} /></Row.Subtitle>
        <Row.RightContent>
          <div>
            <Button class={btnClass} onClick={onClearCachedFiles}>
              {i18n('StorageQuota.Clear')}
            </Button>
          </div>
        </Row.RightContent>
      </Row>

      <Row>
        <Row.Icon icon="photo_filled" />
        <Row.Title>{i18n('StorageQuota.Images')}</Row.Title>
        <Row.Subtitle><SizeWithFallback resource={cachedFilesSizes} value={cachedFilesSizes()?.images} /></Row.Subtitle>
      </Row>

      <Row>
        <Row.Icon icon="play_filled" />
        <Row.Title>{i18n('StorageQuota.VideoFiles')}</Row.Title>
        <Row.Subtitle><SizeWithFallback resource={cachedFilesSizes} value={cachedFilesSizes()?.videos} /></Row.Subtitle>
      </Row>

      <Row>
        <Row.Icon icon="sticker_filled" />
        <Row.Title>{i18n('StorageQuota.StickersEmoji')}</Row.Title>
        <Row.Subtitle><SizeWithFallback resource={cachedFilesSizes} value={cachedFilesSizes()?.stickers} /></Row.Subtitle>
      </Row>

      <Row>
        <Row.Icon icon="limit_file_filled" />
        <Row.Title>{i18n('StorageQuota.Other')}</Row.Title>
        <Row.Subtitle><SizeWithFallback resource={cachedFilesSizes} value={cachedFilesSizes()?.other} /></Row.Subtitle>
      </Row>

      <Space amount="1rem" />

      {/* tweb :374-384 — «Cached video stream chunks» и Space после неё: О-6 */}

      <RangeSettingSelector
        minValue={0}
        maxValue={cacheTimeOptions.length - 1}
        step={1}
        textLeft={i18n('StorageQuota.ClearCacheOlderThan')}
        textRight={(idx) => cacheTimeOptions[idx]?.label()}
        value={cacheTimeIdx()}
        onChange={setCacheTimeIdx}
      />

      <Space amount="0.5rem" />

      <RangeSettingSelector
        minValue={0}
        maxValue={cacheSizeOptions.length - 1}
        step={1}
        textLeft={i18n('StorageQuota.CacheSizeLimit')}
        textRight={(idx) => cacheSizeOptions[idx]?.label()}
        value={cacheSizeIdx()}
        onChange={setCacheSizeIdx}
      />

      <Space amount="1rem" />

      <Button primaryTransparent onClick={onClearAllCachedData} icon="delete">
        {i18n('StorageQuota.ClearAll')}
      </Button>
    </Section>
  )
}

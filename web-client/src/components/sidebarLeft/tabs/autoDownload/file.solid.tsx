/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/autoDownload/file.tsx:1-99
 * (812502980) — вкладка «Автозагрузка файлов»: секция типов чатов и ползунок
 * максимального размера (шкала value⁴, 512 КБ…20 МБ), запись с дебаунсом.
 *
 * Локальный императивный `RangeSettingSelector` (`:9-62`) — как у оригинала,
 * а не Solid-компонент `components/rangeSettingSelector.solid.tsx`: у tweb это
 * два разных узла (здесь значение пишет внешний `I18n.IntlElement`, `writeValue
 * = false`).
 *
 * Расхождения с оригиналом:
 *  1. `formatBytes` — строка из `core/mediaCache.ts` (ключи `Unit.*`), у tweb —
 *     узел `i18n('FileSize.*')`; см. расхождение 3 `dataAndStorage/storageQuota.solid.tsx`.
 *  2. У локального класса нет параметра `writeValue` и его веток (`:22`,
 *     `:38-40`, `:54-56`): единственный вызов у оригинала передаёт `false`.
 */
import debounce from '@helpers/schedulers/debounce'
import I18n, { _i18n, type LangPackKey } from '@lib/langPack'
import { formatBytes as formatBytesT } from '@core/mediaCache'
import { useAppSettings } from '@stores/appSettings.solid'
import RangeSelector from '@components/rangeSelector'
import autoDownloadTab from './autoDownloadTab.solid'
import { autoDownloadPeerTypeSection } from './peerTypeSection.solid'

const formatBytes = (bytes: number) => formatBytesT(bytes, (key) => I18n.format(key, true))

class RangeSettingSelector {
  public container: HTMLDivElement
  public valueContainer: HTMLElement
  private range: RangeSelector

  public onChange?: (value: number) => void

  constructor(
    name: LangPackKey,
    step: number,
    initialValue: number,
    minValue: number,
    maxValue: number,
  ) {
    const BASE_CLASS = 'range-setting-selector'
    this.container = document.createElement('div')
    this.container.classList.add(BASE_CLASS)

    const details = document.createElement('div')
    details.classList.add(BASE_CLASS + '-details')

    const nameDiv = document.createElement('div')
    nameDiv.classList.add(BASE_CLASS + '-name')
    _i18n(nameDiv, name)

    const valueDiv = this.valueContainer = document.createElement('div')
    valueDiv.classList.add(BASE_CLASS + '-value')

    details.append(nameDiv, valueDiv)

    this.range = new RangeSelector({
      step,
      min: minValue,
      max: maxValue,
    }, initialValue)
    this.range.setListeners()
    this.range.setHandlers({
      onScrub: (value) => {
        this.onChange?.(value)
      },
    })

    this.container.append(details, this.range.container)
  }
}

export default autoDownloadTab((tab) => {
  const [appSettings, setAppSettings] = useAppSettings()

  const debouncedSave = debounce((sizeMax: number) => {
    void setAppSettings('autoDownloadNew', 'file_size_max', sizeMax)
  }, 200, false, true)

  const MIN = 512 * 1024
  // const MAX = 2 * 1024 * 1024 * 1024;
  const MAX = 20 * 1024 * 1024
  const MAX_RANGE = MAX - MIN

  const sizeMax = appSettings.autoDownloadNew.file_size_max
  const value = Math.sqrt(Math.sqrt((sizeMax - MIN) / MAX_RANGE))
  const upTo = new I18n.IntlElement({
    key: 'AutodownloadSizeLimitUpTo',
    args: [formatBytes(sizeMax)],
  })
  const range = new RangeSettingSelector('AutoDownloadMaxFileSize', 0.01, value, 0, 1)
  range.onChange = (value) => {
    const sizeMax = (value ** 4 * MAX_RANGE + MIN) | 0

    upTo.compareAndUpdate({ args: [formatBytes(sizeMax)] })

    void debouncedSave(sizeMax)
  }

  range.valueContainer.append(upTo.element)

  tab.scrollable.append(autoDownloadPeerTypeSection(
    'file',
    'AutoDownloadFilesTitle',
    tab.middlewareHelper.get(),
    range.container,
  ))
})

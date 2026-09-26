/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/dataAndStorage/index.tsx:1-130
 * (812502980) — вкладка «Данные и память» (`AppDataAndStorageTab`,
 * `solidJsTabs/tabs.ts`, форма eventable: квота пишется на `destroy`).
 * Задача 7 плана волны 2D. Разметка — дамп `14-left-15-settings-data-storage`
 * с классами HEAD (тумблер `row-checkbox-field-toggle`, `docs/tweb/settings-rows.md` § 7).
 *
 * Расхождения с оригиналом:
 *  1. `appSettings.autoDownload`/`autoDownloadNew` — мост `useAppSettings` над
 *     zustand (О-2): `autoDownloadNew.pFlags.disabled` ↔ наш `autoDownloadEnabled`
 *     (обратный смысл, `codec` в `stores/appSettings.solid.ts`),
 *     `file_size_max` ↔ `autoDownloadFileSizeMax`. `SETTINGS_INIT` — то же
 *     представление над `DEFAULTS` (`settings.tsx`), не копия `config/state.ts`.
 *  2. Подпись строки — `i18n(key, args)` c аргументом-строкой `formatBytes`
 *     (`core/mediaCache.ts`), у tweb аргумент — узел `formatBytes` (ключи
 *     `FileSize.*`); см. расхождение 3 `storageQuota.solid.tsx`.
 *  3. Отмена подтверждения сброса гасится (`then(…, noop)`). У оригинала
 *     `.then` без обработчика отказа (`:72-81`): `confirmationPopup` отклоняет
 *     промис на отмене, и каждая отмена — необработанный reject; `Button` с
 *     пропом `disabled` возвращённый промис не ловит (`buttonTsx.tsx`).
 */
import { onMount, type Component, type JSX } from 'solid-js'
import I18n, { i18n, join, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import noop from '@helpers/noop'
import copy from '@helpers/object/copy'
import deepEqual from '@helpers/object/deepEqual'
import type { AutoDownloadPeerTypes } from '@/settings'
import { formatBytes as formatBytesT } from '@core/mediaCache'
import { SETTINGS_INIT, useAppSettings } from '@stores/appSettings.solid'
import Button from '@components/buttonTsx.solid'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import { confirmationPopup } from '@components/popups/popupPeer'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import type { SliderSuperTabEventableConstructable } from '@components/sliderTab'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { AppAutoDownloadFileTab, AppAutoDownloadPhotoTab, AppAutoDownloadVideoTab, type AppDataAndStorageTab } from '@components/solidJsTabs/tabs'
import { StorageQuota, type StorageQuotaControls } from './storageQuota.solid'

const formatBytes = (bytes: number) => formatBytesT(bytes, (key) => I18n.format(key, true))

const AUTO_DOWNLOAD_FOR_KEYS: { [k in keyof AutoDownloadPeerTypes]: LangPackKey } = {
  contacts: 'AutoDownloadContacts',
  private: 'AutoDownloadPm',
  groups: 'AutoDownloadGroups',
  channels: 'AutoDownloadChannels',
}

function getAutoDownloadSubtitle(settings: AutoDownloadPeerTypes, sizeMax?: number): JSX.Element {
  let key: LangPackKey
  const args: FormatterArguments = []

  const peerKeys = Object.keys(settings) as (keyof typeof AUTO_DOWNLOAD_FOR_KEYS)[]
  const enabledKeys = peerKeys.map((key) => settings[key] ? AUTO_DOWNLOAD_FOR_KEYS[key] : undefined).filter(Boolean) as LangPackKey[]
  if(!enabledKeys.length || sizeMax === 0) {
    key = 'AutoDownloadOff'
  } else {
    const isAll = enabledKeys.length === peerKeys.length
    if(sizeMax !== undefined) {
      key = isAll ? 'AutoDownloadUpToOnAllChats' : 'AutoDownloadOnUpToFor'
      args.push(formatBytes(sizeMax))
    } else {
      key = isAll ? 'AutoDownloadOnAllChats' : 'AutoDownloadOnFor'
    }

    if(!isAll) {
      const fragment = document.createElement('span')
      fragment.append(...join(enabledKeys.map((key) => i18n(key)), true, false))
      args.push(fragment)
    }
  }

  return i18n(key, args)
}

const DataAndStorage: Component = () => {
  const [tab] = useSuperTab<typeof AppDataAndStorageTab>()
  const [appSettings, setAppSettings] = useAppSettings()
  let controls: StorageQuotaControls | undefined

  const autoEnabled = () => !appSettings.autoDownloadNew.pFlags.disabled

  const resetDisabled = () => (
    deepEqual(appSettings.autoDownload, SETTINGS_INIT.autoDownload) &&
    deepEqual(appSettings.autoDownloadNew, SETTINGS_INIT.autoDownloadNew)
  )

  const openTab = (tabConstructor: SliderSuperTabEventableConstructable) => {
    // `tab.slider` у вкладки — узкий контракт `SliderSuperTabSlider` (шапка
    // `sliderTab.ts`) без `createTab`; на деле это всегда `SidebarSlider` хоста.
    void (tab.slider as SidebarSlider).createTab(tabConstructor).open()
  }

  const onAutoEnabledChange = (enabled: boolean) => {
    void setAppSettings('autoDownloadNew', 'pFlags', 'disabled', enabled ? undefined : true)
  }

  const onReset = () => confirmationPopup({
    titleLangKey: 'ResetAutomaticMediaDownloadAlertTitle',
    descriptionLangKey: 'ResetAutomaticMediaDownloadAlert',
    button: {
      langKey: 'Reset',
    },
  }).then(() => {
    void setAppSettings('autoDownload', copy(SETTINGS_INIT.autoDownload))
    void setAppSettings('autoDownloadNew', copy(SETTINGS_INIT.autoDownloadNew))
  }, noop) // расхождение 3

  onMount(() => {
    tab.eventListener.addEventListener('destroy', () => {
      return controls?.save()
    })
  })

  return (
    <>
      <Section name="AutomaticMediaDownload" caption="AutoDownloadAudioInfo">
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx
              checked={autoEnabled()}
              toggle
              onChange={onAutoEnabledChange}
            />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('AutoDownloadMedia')}</Row.Title>
        </Row>
        <Row disabled={!autoEnabled()} clickable={() => openTab(AppAutoDownloadPhotoTab)}>
          <Row.Title>{i18n('AutoDownloadPhotos')}</Row.Title>
          <Row.Subtitle>{getAutoDownloadSubtitle(appSettings.autoDownload.photo)}</Row.Subtitle>
        </Row>
        <Row disabled={!autoEnabled()} clickable={() => openTab(AppAutoDownloadVideoTab)}>
          <Row.Title>{i18n('AutoDownloadVideos')}</Row.Title>
          <Row.Subtitle>{getAutoDownloadSubtitle(appSettings.autoDownload.video)}</Row.Subtitle>
        </Row>
        <Row disabled={!autoEnabled()} clickable={() => openTab(AppAutoDownloadFileTab)}>
          <Row.Title>{i18n('AutoDownloadFiles')}</Row.Title>
          <Row.Subtitle>{getAutoDownloadSubtitle(
            appSettings.autoDownload.file,
            appSettings.autoDownloadNew.file_size_max,
          )}</Row.Subtitle>
        </Row>
        <Button
          disabled={resetDisabled()}
          icon="delete"
          primaryTransparent
          text="ResetAutomaticMediaDownload"
          onClick={onReset}
        />
      </Section>
      <StorageQuota controlsRef={(localControls) => controls = localControls} />
    </>
  )
}

export default DataAndStorage

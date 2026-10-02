/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/call/callDeviceSettings.tsx:1-105 (812502980) —
 * выбор устройства звонка: `useCallDeviceSettings()` (список устройств с
 * `devicechange`, подпись выбранного, выбор через попап) и строка
 * `CallDeviceRow`. Потребители — вкладка «Динамики и камера»
 * (`sidebarLeft/tabs/speakersAndCamera.solid.tsx`) и секция камеры
 * (`call/cameraSection.solid.tsx`); попапа настроек звонка у нас нет.
 *
 * Расхождения с оригиналом:
 *  1. `showOutputDevicePopup` — ВРЕМЕННЫЙ React-мост
 *     (`components/rtmp/outputDevicePopup.tsx`, до 2C-12) с сигнатурой tweb.
 *  2. `appSettings.callDevices` — мост `useAppSettings` над zustand (О-2):
 *     `microphoneId` ↔ наш `micId`.
 *  3. Тип `icon` — наш `IconName` вместо ambient `Icon`.
 */
import { createSignal, onCleanup, onMount } from 'solid-js'
import Row from '@components/rowTsx.solid'
import showOutputDevicePopup from '@components/rtmp/outputDevicePopup'
import { toastNew } from '@components/toast'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { i18n, type LangPackKey } from '@lib/langPack'
import { useAppSettings } from '@stores/appSettings.solid'
import { changeCallDevice } from '@lib/calls/applyDeviceToActiveCall'
import { CALL_DEVICE_SETTING_KEYS, type CallDeviceKind } from '@lib/calls/callDeviceKind'
import type { IconName } from '@core/tgico-icons'

const deviceOptions: Record<CallDeviceKind, {
  mediaKind: MediaDeviceKind
  titleLangKey: LangPackKey
  errorLangKey: LangPackKey
}> = {
  speaker: {
    mediaKind: 'audiooutput',
    titleLangKey: 'CallSettings.Speakers',
    errorLangKey: 'Error.AnError',
  },
  microphone: {
    mediaKind: 'audioinput',
    titleLangKey: 'CallSettings.Microphone',
    errorLangKey: 'ConferenceCall.Media.MicrophoneError',
  },
  camera: {
    mediaKind: 'videoinput',
    titleLangKey: 'CallSettings.Camera',
    errorLangKey: 'ConferenceCall.Media.CameraError',
  },
}

export function useCallDeviceSettings() {
  const [appSettings] = useAppSettings()
  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([])

  const refreshDevices = () => {
    navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([]))
  }

  onMount(() => {
    refreshDevices()
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices)
    onCleanup(() => {
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices)
    })
  })

  const deviceId = (kind: CallDeviceKind): string => {
    return appSettings.callDevices?.[CALL_DEVICE_SETTING_KEYS[kind]] || ''
  }

  const label = (kind: CallDeviceKind) => {
    const id = deviceId(kind)
    if(!id) return i18n('CallSettings.DeviceDefault')

    const { mediaKind } = deviceOptions[kind]
    const device = devices().find((item) => item.kind === mediaKind && item.deviceId === id)
    return device ? wrapEmojiText(device.label || device.deviceId) : i18n('CallSettings.DeviceDefault')
  }

  const reportChangeError = (kind: CallDeviceKind, error: unknown) => {
    console.error(`change ${kind} device failed`, error)
    toastNew({ langPackKey: deviceOptions[kind].errorLangKey })
  }

  const change = (kind: CallDeviceKind, id: string): void => {
    void changeCallDevice(kind, id).catch((error) => reportChangeError(kind, error))
  }

  const pick = (kind: CallDeviceKind): void => {
    const config = deviceOptions[kind]
    showOutputDevicePopup({
      kind: config.mediaKind,
      currentId: deviceId(kind),
      titleLangKey: config.titleLangKey,
      onPick: (id) => change(kind, id),
      onStaleCurrentId: () => {
        void changeCallDevice(kind, '').catch((error) => {
          console.error(`reset ${kind} device failed`, error)
        })
      },
    })
  }

  return { deviceId, label, pick }
}

export type CallDeviceSettings = ReturnType<typeof useCallDeviceSettings>

export function CallDeviceRow(props: {
  settings: CallDeviceSettings
  kind: CallDeviceKind
  icon?: IconName
  titleLangKey?: LangPackKey
}) {
  return (
    <Row clickable={() => props.settings.pick(props.kind)} role="button" tabIndex={0}>
      {props.icon && <Row.Icon icon={props.icon} />}
      <Row.Title titleRight={props.settings.label(props.kind)} titleRightSecondary>
        {i18n(props.titleLangKey || deviceOptions[props.kind].titleLangKey)}
      </Row.Title>
    </Row>
  )
}

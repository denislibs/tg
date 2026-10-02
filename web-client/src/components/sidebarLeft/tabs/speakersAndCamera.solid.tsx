/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/speakersAndCamera.tsx:1-121
 * (812502980) — вкладка «Динамики и камера» (`AppSpeakersAndCameraTab`,
 * `solidJsTabs/tabs.ts`), задача 26 плана волны 2D
 * (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 *
 * Секции — как у оригинала: «Динамики» (строка устройства вывода), «Микрофон»
 * (строка устройства ввода + живой уровень), «Камера» (строка + превью,
 * `call/cameraSection.solid.tsx`). Выбор — попапом `showOutputDevicePopup`,
 * запись — `changeCallDevice` (оптимистично, откат на отказе живого звонка).
 * Открывают вкладку строка корня настроек (`settings.tsx:258`) и меню «⋮»
 * вкладки «Звонки» (`calls.tsx:363`).
 *
 * Расхождения с оригиналом:
 *  1. Секции «Принимать звонки» (`:94-114`) нет — О-8: у бэкенда нет
 *     `account.getAuthorizations` с флагом `call_requests_disabled` и
 *     `changeAuthorizationSettings`, запрета звонков на устройстве нет вовсе.
 *     Поэтому нет и сбора промиса текущей авторизации (`:42-50`) — вкладке
 *     нечего ждать. Наш прежний локальный `acceptCalls` снят: звонковый код
 *     его не читал.
 *  2. Стили `call/settingsPopup.scss` — глобальный партиал
 *     `styles/tweb/_callSettingsPopup.scss` (правило `styles/tweb/`), а не
 *     импорт из компонента.
 */
import { onMount } from 'solid-js'
import Section from '@components/section.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppSpeakersAndCameraTab } from '@components/solidJsTabs/tabs'
import MicrophoneLevelMeter from '@components/call/microphoneLevelMeter.solid'
import CallCameraSection from '@components/call/cameraSection.solid'
import {
  CallDeviceRow,
  useCallDeviceSettings,
} from '@components/call/callDeviceSettings.solid'

// Speakers-and-Camera settings tab. Mirrors tdesktop's settings_calls
// "Calls" panel: Speakers → Microphone (+ live level meter) → Camera (+
// preview) → Accept calls toggle. We deliberately do NOT include tdesktop's
// "Open system sound preferences" entry — there is no web-platform analog.
//
// The "use the same devices for calls" toggle that tdesktop carries is also
// omitted: tweb has no separate "global" audio output device (the only
// non-call output device picker is the RTMP livestream sink, which is
// per-livestream-popup), so the toggle would always be a no-op here.

export default function SpeakersAndCamera() {
  const [tab] = useSuperTab<typeof AppSpeakersAndCameraTab>()
  const callDevices = useCallDeviceSettings()

  onMount(() => {
    tab.header.classList.add('with-border')
  })

  return (
    <>
      <Section name="CallSettings.OutputSection">
        <CallDeviceRow
          settings={callDevices}
          kind="speaker"
          titleLangKey="CallSettings.OutputDevice"
        />
      </Section>

      <Section name="CallSettings.InputSection">
        <CallDeviceRow
          settings={callDevices}
          kind="microphone"
          titleLangKey="CallSettings.InputDevice"
        />
        <div class="speakers-and-camera-meter-wrap">
          <MicrophoneLevelMeter deviceId={callDevices.deviceId('microphone')} />
        </div>
      </Section>

      <CallCameraSection settings={callDevices} />

      {/* «Принимать звонки» (`:94-114`) — О-8, см. шапку */}
    </>
  )
}

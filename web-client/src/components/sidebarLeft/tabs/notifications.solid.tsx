/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/notifications.tsx:1-571 (812502980) —
 * вкладка «Уведомления и звуки» (`AppNotificationsTab`, `solidJsTabs/tabs.ts`).
 * Пилот плана волны 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`,
 * задача 6): первый экран настроек, собранный из Solid `Row`/`Section` HEAD.
 *
 * Состав — как у оригинала (`:543-569`): веб-уведомления, звук, звуковые
 * эффекты, три типа чатов. Разметка — дамп `14-left-14-settings-notifications`
 * с классами HEAD (`row-checkbox-field-toggle`, `docs/tweb/settings-rows.md` § 7).
 *
 * Расхождения с оригиналом:
 *  1. (О-1) Строки «All Accounts» (`:453-462`) и подписи
 *     `MultiAccount.ShowNotificationsFromCaption` при выданном разрешении (`:431`)
 *     нет. У tweb `notifyAllAccounts` выбирает, КАКАЯ вкладка браузера покажет
 *     уведомление (аккаунты живут одновременно в разных вкладках,
 *     `appNotificationsManager.ts:449-475`); у нас одна активная сессия на
 *     браузер, смена аккаунта = смена токена и перезагрузка
 *     (`core/auth/accounts.ts:1-5`) — строке нечего переключать.
 *  2. (О-3, О-4, О-5) Секций «Stories» (`:112-228`), «Reactions» (`:237-347`) и
 *     «Other → Contact joined» (`:349-377`) нет: у `/me/notify_settings` только
 *     `muted`/`preview` по трём типам (`backend/internal/adapter/delivery/http/
 *     notify_handler.go`), ручек реакций и уведомления о новом контакте нет.
 *  3. Отказ в разрешении показывает тост. У оригинала `throw 1` стоит в
 *     onFulfilled того же `.then(onFulfilled, onRejected)` (`:395-406`) и до
 *     onRejected не доходит: отказ — необработанный reject без тоста. У нас
 *     `.then().catch()`: и отказ, и ошибка запроса — `Notifications.Restricted`
 *     (так было и в прежнем экране).
 *  4. Типы чатов: вместо `appNotificationsManager.getNotifySettings`/событий
 *     `notify_settings` (`:71-83`) — `stores/notifyStore.ts`, единственный
 *     владелец глобальных настроек по типам (его читают список чатов, папки и
 *     уведомления). Запись — `managers.notify.update` с зеркалом в сторе и
 *     откатом к серверу при ошибке, как и прежде; момент записи — закрытие
 *     вкладки и только при изменении, как `onCleanup` оригинала (`:49-69`).
 *     `isMuted(notifySettings)` = наш `muted` (глобальный тип — признак, не срок).
 *  5. `uiNotificationsManager.onPushConditionsChange` →
 *     `client/pushSetup.ts::onPushConditionsChange`, `testSound` →
 *     `core/audio/sounds.ts::testSound` (у нас нет класса-менеджера, и
 *     `useHotReloadGuard` не нужен — HMR-ветки tweb не портированы).
 *  6. `SETTINGS_INIT.notifications.volume` → `DEFAULTS.notifyVolume` из
 *     `settings.tsx`; `appSettings.notifications.*` — мост `useAppSettings`
 *     над zustand (О-2).
 */
import { createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import cancelEvent from '@helpers/dom/cancelEvent'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import IS_NOTIFICATION_SUPPORTED from '@environment/notificationSupport'
import { useAppSettings } from '@stores/appSettings.solid'
import { useNotifyStore } from '@stores/notifyStore'
import type { NotifyChatType } from '@core/managers/notifyManager'
import { DEFAULTS } from '@/settings'
import { onPushConditionsChange } from '@/client/pushSetup'
import { testSound } from '@core/audio/sounds'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import RangeSettingSelector from '@components/rangeSettingSelector.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import Button from '@components/buttonTsx.solid'
import { toastNew } from '@components/toast'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppNotificationsTab } from '@components/solidJsTabs/tabs'

const NotifySection = (props: {
  name: LangPackKey
  typeText: LangPackKey
  inputKey: NotifyChatType
}) => {
  const [tab] = useSuperTab<typeof AppNotificationsTab>()
  const [enabled, setEnabled] = createSignal(true)
  const [showPreviews, setShowPreviews] = createSignal(true)
  // tweb :33, :71-83 — снимок настроек типа, обновляемый апдейтами (расхождение 4)
  const notifySettings = subscribeExternal(
    useNotifyStore.subscribe,
    () => useNotifyStore.getState().settings[props.inputKey],
  )

  createEffect(() => {
    const _notifySettings = notifySettings()
    setEnabled(!_notifySettings.muted)
    setShowPreviews(_notifySettings.preview)
  })

  onCleanup(() => {
    const mute = !enabled()
    const _showPreviews = showPreviews()
    const _notifySettings = notifySettings()
    if(
      mute === _notifySettings.muted &&
      _showPreviews === _notifySettings.preview
    ) {
      return
    }

    // Полный тип, как `inputSettings` оригинала (`:61-64`): и mute, и превью.
    const patch = { muted: mute, preview: _showPreviews }
    const managers = tab.managers!
    const store = useNotifyStore.getState()
    store.setType(props.inputKey, patch)
    managers.notify.update({ [props.inputKey]: patch }).catch(() => {
      // не сохранилось — возвращаем зеркало к серверному состоянию
      return managers.notify.settings().then((server) => useNotifyStore.getState().set(server))
    }).catch(() => undefined)
  })

  return (
    <Section name={props.name}>
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx checked={enabled()} onChange={setEnabled} toggle />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n(props.typeText)}</Row.Title>
      </Row>
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx checked={showPreviews()} onChange={setShowPreviews} toggle />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('MessagePreview')}</Row.Title>
      </Row>
    </Section>
  )
}

// tweb :103-377 — StoriesNotifySection, ReactionsNotifySection, OtherSection:
// не портированы, О-3, О-4, О-5 (расхождение 2 в шапке).

const NotificationsSection = () => {
  const [appSettings, setAppSettings] = useAppSettings()
  const [permission, setPermission] = createSignal<NotificationPermission>(
    IS_NOTIFICATION_SUPPORTED ? Notification.permission : 'denied',
  )
  const isGranted = createMemo(() => permission() === 'granted')

  const onClick = (e: MouseEvent) => {
    cancelEvent(e)
    if(!IS_NOTIFICATION_SUPPORTED) {
      toastNew({ langPackKey: 'Notifications.Restricted' })
      return
    }

    // Расхождение 3: `.catch`, а не второй аргумент `then` (`:395-406`).
    Notification.requestPermission().then((permission) => {
      setPermission(permission)
      if(permission === 'granted') {
        void onPushConditionsChange()
      } else {
        throw new Error(permission)
      }
    }).catch(() => {
      toastNew({ langPackKey: 'Notifications.Restricted' })
    })
  }

  const NotificationRow = (props: Parameters<typeof Row>[0]) => {
    return (
      <Row
        {...props}
        fakeDisabled={!isGranted()}
        clickable={!isGranted() && onClick}
      />
    )
  }

  const NotificationCheckbox = (props: Parameters<typeof CheckboxFieldTsx>[0]) => {
    return (
      <CheckboxFieldTsx
        {...props}
        checked={isGranted() && props.checked}
      />
    )
  }

  return (
    <Section
      name="Notifications.Web"
      // tweb :431 — при разрешении подпись про «All Accounts»: О-1
      caption={isGranted() ? undefined : 'Notifications.Default'}
    >
      <NotificationRow>
        <Row.CheckboxFieldToggle>
          <NotificationCheckbox
            checked={appSettings.notifications.desktop}
            onChange={(value) => setAppSettings('notifications', 'desktop', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Show')}</Row.Title>
      </NotificationRow>
      <NotificationRow>
        <Row.CheckboxFieldToggle>
          <NotificationCheckbox
            checked={appSettings.notifications.push}
            onChange={(value) => setAppSettings('notifications', 'push', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Offline')}</Row.Title>
      </NotificationRow>
      {/* tweb :453-462 — строка «All Accounts»: О-1 (расхождение 1 в шапке) */}
      {!isGranted() && (
        <Button
          text="Notifications.Enable"
          class="btn-primary primary btn-transparent"
          icon="unmute"
          disabled={isGranted()}
          onClick={onClick}
        />
      )}
    </Section>
  )
}

const SoundSection = () => {
  const [appSettings, setAppSettings] = useAppSettings()

  return (
    <Section
      name="Notifications.Sound.Section"
      caption="Notifications.Sound.Caption"
    >
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={appSettings.notifications.sound}
            onChange={(value) => {
              if(value && !appSettings.notifications.volume) {
                void setAppSettings('notifications', 'volume', DEFAULTS.notifyVolume)
              }

              void setAppSettings('notifications', 'sound', value)
            }}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Sound')}</Row.Title>
      </Row>
      <RangeSettingSelector
        textLeft={i18n('Notifications.Sound.Volume')}
        textRight={(value) => '' + Math.floor(value * 100) + '%'}
        step={0.01}
        value={appSettings.notifications.volume}
        minValue={0}
        maxValue={1}
        onChange={(value) => {
          value = +value.toFixed(2)
          if(!value) {
            void setAppSettings('notifications', 'sound', false)
          }

          void setAppSettings('notifications', 'volume', value)
        }}
        onMouseUp={() => {
          testSound(appSettings.notifications.volume)
        }}
      />
    </Section>
  )
}

const SoundEffectsSection = () => {
  const [appSettings, setAppSettings] = useAppSettings()

  return (
    <Section name="Notifications.Sound.Effects">
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={appSettings.notifications.sentMessageSound}
            onChange={(value) => setAppSettings('notifications', 'sentMessageSound', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Sound.Sent')}</Row.Title>
      </Row>
    </Section>
  )
}

const Notifications: Component = () => {
  return (
    <>
      <NotificationsSection />
      <SoundSection />
      <SoundEffectsSection />
      <NotifySection
        name="NotificationsPrivateChats"
        typeText="NotificationsForPrivateChats"
        inputKey="private"
      />
      <NotifySection
        name="NotificationsGroups"
        typeText="NotificationsForGroups"
        inputKey="groups"
      />
      <NotifySection
        name="NotificationsChannels"
        typeText="NotificationsForChannels"
        inputKey="channels"
      />
      {/* tweb :564-566 — Stories, Reactions, Other: О-3, О-4, О-5 */}
    </>
  )
}

export default Notifications

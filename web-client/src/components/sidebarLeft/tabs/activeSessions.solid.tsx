/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/activeSessions.tsx:1-401 (812502980) —
 * вкладка «Устройства» (`AppActiveSessionsTab`, `solidJsTabs/tabs.ts`). Задача 9
 * плана волны 2D: вместо императивных `Row`/`SettingSection` старой базы —
 * JSX `Row`/`Section` HEAD; клик по строке открывает экран сессии
 * (`AppSessionTab`, `session.solid.tsx`, tweb 944b578e9), завершение — из
 * контекстного меню строки и с экрана сессии.
 *
 * Состав — как у оригинала (`:353-398`): текущая сессия (+ «завершить все
 * прочие» и подпись `ClearOtherSessionsHelp`, только если прочие есть),
 * незавершённые входы (`password_pending`), прочие сессии. Список
 * перечитывается раз в минуту (`:99-112`, событий о новом входе нет).
 *
 * Расхождения с оригиналом:
 *  1. (О-7) Секции TTL «Automatically Terminate Old Sessions» (`TTLRow`,
 *     `setTTL`, `TTL_OPTIONS`, `nearestTTLOption`, `:27-46`, `:238-292`,
 *     `:392-396`) нет: `authorization_ttl_days` у нас всегда 0
 *     (`backend/internal/domain/mtaccount.go`, `AccountAuthorizations`), ручки
 *     `setAuthorizationTTL` нет. С ней не перенесён и `ttlDays` полезной
 *     нагрузки: оригинал перечитывает список на открытии только ради него
 *     (`:105-108`, открытие из `newAuthorization.tsx` без TTL).
 *  2. (О-9) Переименования устройства нет: `nameRight` у секции
 *     `CurrentSession` (`renameAnchor`/`renameDevice`, `:211-236`) и подмена
 *     `device_model` из `appSettings.customDeviceModel` (`:66-74`) — имя
 *     устройства подставляет сервер из User-Agent
 *     (`backend/internal/usecase/auth/auth.go`).
 *  3. Бизнес-бота (`connectedBot`, `ConnectedBotRow`, `terminateConnectedBot`,
 *     событие `chat_automation_update`, флажок попапа «завершить все» —
 *     `:95-97`, `:148-159`, `:162-205`, `:325-351`) нет: бизнес-ботов у нас нет.
 *  4. Подписки на `unconfirmed_authorizations_update` (`:101-103`) нет: попапа
 *     неподтверждённого входа (`newAuthorization.tsx`) и флага `unconfirmed`
 *     на проводе у нас нет — остаётся минутный опрос.
 *  5. Секция незавершённых входов портирована, но сейчас пустует: бэкенд не
 *     ставит `password_pending` (сессия заводится только после полного входа).
 *  6. `appAccountManager.getAuthorizations()/resetAuthorization(hash)/
 *     resetAuthorizations()` → `tab.managers.sessions.list()/terminate(id)/
 *     terminateOthers()` (`core/managers/sessionsManager.ts`); `hash` на
 *     проводе — `string | number`, менеджер адресует сессию числом.
 *     `tab.managers!`/`tab.slider as SidebarSlider` — поля вкладки объявлены
 *     шире, чем есть на деле (шапки `sliderTab.ts`); `useHotReloadGuard` не
 *     нужен — HMR-ветки tweb не портированы, модули берутся импортом.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { Authorization } from '@layer'
import noop from '@helpers/noop'
import { formatDateAccordingToTodayNew } from '@helpers/date'
import getAuthorizationErrorLangKey from '@helpers/getAuthorizationErrorLangKey'
import getSessionPlatformIcon from '@helpers/sessionPlatformIcon'
import Button from '@components/buttonTsx.solid'
import { confirmationPopup } from '@components/popups/popupPeer'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import type SidebarSlider from '@components/slider'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { AppSessionTab, type AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import { toastNew } from '@components/toast'

/** tdesktop's `kShortPollTimeout` — the sessions list has no update to listen to. */
const REFRESH_INTERVAL = 60e3

const isSameHash = (a: Authorization.authorization, b: Authorization.authorization) => {
  return '' + a.hash === '' + b.hash
}

const ActiveSessions: Component = () => {
  const [tab] = useSuperTab<typeof AppActiveSessionsTab>()

  const [authorizations, setAuthorizations] = createSignal(tab.payload.authorizations || [])

  // tweb :68-74 — без подмены имени устройства (расхождение 2)
  const currentSession = createMemo(() => authorizations().find((authorization) => authorization.pFlags.current))

  // Sessions that entered the right code but never the password have no access
  // to the account; tdesktop keeps them in their own section.
  const incompleteSessions = createMemo(() => authorizations().filter((authorization) => {
    return !authorization.pFlags.current && !!authorization.pFlags.password_pending
  }))
  const otherSessions = createMemo(() => authorizations().filter((authorization) => {
    return !authorization.pFlags.current && !authorization.pFlags.password_pending
  }))
  const hasOtherSessions = () => !!otherSessions().length ||
    !!incompleteSessions().length

  const refresh = () => {
    return tab.managers!.sessions.list().then(setAuthorizations, noop)
  }

  // tweb :95-103 — события бизнес-бота и неподтверждённого входа: расхождения 3, 4

  onMount(() => {
    // tweb :106-108 — перечитывание на открытии ради TTL: расхождение 1
    const interval = setInterval(refresh, REFRESH_INTERVAL)
    onCleanup(() => clearInterval(interval))
  })

  const onError = (err: ApiError) => {
    toastNew({ langPackKey: getAuthorizationErrorLangKey(err) })
  }

  const confirmTerminate = () => confirmationPopup({
    titleLangKey: 'AreYouSureSessionTitle',
    descriptionLangKey: 'TerminateSessionText',
    button: {
      langKey: 'Terminate',
      isDanger: true,
    },
  })

  const terminateSession = async(authorization: Authorization.authorization) => {
    try {
      await confirmTerminate()
    } catch {
      return false
    }

    try {
      const terminated = await tab.managers!.sessions.terminate(Number(authorization.hash))
      if(terminated) {
        // not identity: a refresh in between swaps every entry for a fresh one
        setAuthorizations((list) => list.filter((item) => !isSameHash(item, authorization)))
      }

      return terminated
    } catch(err) {
      onError(err as ApiError)
      return false
    }
  }

  const terminateAll = async() => {
    // tweb :162-190 — флажок «завершить и бота» в подтверждении: расхождение 3
    try {
      await confirmationPopup({
        titleLangKey: 'AreYouSureSessionsTitle',
        descriptionLangKey: 'AreYouSureSessions',
        button: {
          langKey: 'Terminate',
          isDanger: true,
        },
      })
    } catch {
      return
    }

    try {
      const terminated = await tab.managers!.sessions.terminateOthers()
      if(!terminated) {
        toastNew({ langPackKey: 'Error.AnError' })
        return
      }

      setAuthorizations((list) => list.filter((authorization) => authorization.pFlags.current))
    } catch(err) {
      onError(err as ApiError)
    }
  }

  // tweb :211-248 — переименование устройства (О-9) и TTL (О-7): расхождения 1, 2

  const openSession = (authorization: Authorization.authorization) => {
    // tweb :254-256 — `onSettingsChanged` не заведён: О-8 (`tabs.ts`, `AppSessionTab`)
    void (tab.slider as SidebarSlider).createTab(AppSessionTab).open({
      authorization,
      onTerminate: authorization.pFlags.current ? undefined : () => terminateSession(authorization),
    })
  }

  const terminateMenu = (onClick: () => void) => ({
    buttons: [{
      icon: 'stop' as const,
      text: 'Terminate' as const,
      danger: true,
      onClick,
    }],
  })

  const SessionRow = (props: { authorization: Authorization.authorization }) => {
    const authorization = () => props.authorization
    const isCurrent = () => !!authorization().pFlags.current
    const lastActive = () => formatDateAccordingToTodayNew(
      new Date(Math.max(authorization().date_active, authorization().date_created) * 1000),
    )

    return (
      <Row
        class="session-row"
        clickable={() => openSession(authorization())}
        role="button"
        tabIndex={0}
        contextMenu={isCurrent() ? undefined : terminateMenu(() => {
          void terminateSession(authorization())
        })}
      >
        <Row.Icon icon={getSessionPlatformIcon(authorization())} />
        <Row.Title titleRight={isCurrent() ? undefined : lastActive()}>
          {[authorization().app_name, authorization().app_version].filter(Boolean).join(' ')}
        </Row.Title>
        <Row.Midtitle>
          {[authorization().device_model, authorization().system_version || authorization().platform].filter(Boolean).join(', ')}
        </Row.Midtitle>
        <Row.Subtitle>
          {[authorization().ip, authorization().country].filter(Boolean).join(' - ')}
        </Row.Subtitle>
      </Row>
    )
  }

  return (
    <>
      <Section
        name="CurrentSession"
        caption={hasOtherSessions() ? 'ClearOtherSessionsHelp' : undefined}
      >
        <Show when={currentSession()}>
          {(authorization) => <SessionRow authorization={authorization()} />}
        </Show>
        <Show when={hasOtherSessions()}>
          <Button
            class="btn-primary btn-transparent danger"
            icon="stop"
            text="TerminateAllSessions"
            onClick={terminateAll}
          />
        </Show>
      </Section>

      <Show when={incompleteSessions().length}>
        <Section name="AuthSessions.IncompleteAttempts" caption="AuthSessions.IncompleteAttemptsInfo">
          <For each={incompleteSessions()}>
            {(authorization) => <SessionRow authorization={authorization} />}
          </For>
        </Section>
      </Show>

      <Show when={otherSessions().length}>
        <Section name="OtherSessions" caption="SessionsListInfo">
          <For each={otherSessions()}>
            {(authorization) => <SessionRow authorization={authorization} />}
          </For>
        </Section>
      </Show>

      {/* tweb :392-396 — секция TTL: О-7 (расхождение 1) */}
    </>
  )
}

export default ActiveSessions

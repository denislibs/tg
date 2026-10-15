/** @jsxImportSource solid-js */
// Порт tweb `src/components/sidebarLeft/newAuthorization.tsx` (812502980, 1-290) — плашка
// «Someone just got access to your messages!» над полосой папок: о неподтверждённом входе
// спрашивают остальные устройства («Да, это я» / «Нет, это не я»). Данные — владелец
// запросов в воркере (`core/managers/sessionsManager.ts`) через `stores/unconfirmedAuthorizations.solid.ts`;
// пока запрос есть, `body.has-unconfirmed-authorization` (его читает `styles/tweb/_leftSidebar.scss:429`).
//
// Узел и менеджеры даёт владелец списка: `lib/appDialogsManager.ts` препендит контейнер в
// `.chatlist-overlay` и зовёт `renderNewAuthorization(контейнер, managers)` (tweb
// `appDialogsManager.ts:1390-1394`). Действия плашки (`NewAuthorization`) берут менеджеры
// вкладки в момент клика (`getProxiedManagers()`) — оболочка по ним же и построена.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `rootScope.managers.appAccountManager.getAuthorizations/confirmUnconfirmedAuthorization/
//     resetAuthorization` → `getProxiedManagers().sessions.list/confirmUnconfirmedAuthorization/
//     terminate` (`hash` на проводе — `string | number`, `terminate` адресует сессию числом).
//  2. `renderNewAuthorization` возвращает `dispose`, и при нём снимается `has-unconfirmed-authorization`:
//     у tweb корень живёт вечно, у нас владелец списка размонтируется и обязан убрать свои
//     следы (`appDialogsManager.destroy()`, расхождение 1 его шапки; тот же приём у
//     `pendingSuggestion.solid.tsx`, расхождение 3).
//  3. Импорты: `@components/buttonTsx` → `buttonTsx.solid`, `popups/indexTsx` → `indexTsx.solid`,
//     `rippleElement` → `rippleElement.solid`, `animations` → `animations.solid`, `mediaHeader`
//     → `mediaHeader.solid`, `@stores/foldersSidebar` → `foldersSidebar.solid`, `wrapEmojiText`
//     → `@lib/richtext/wrapEmojiText` — файлы-близнецы нашей раскладки, содержимое то же.
import { createEffect, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import Button from '@components/buttonTsx.solid'
import MediaHeader from '@components/mediaHeader.solid'
import PopupElementTsx, { createPopup as createPopupTsx } from '@components/popups/indexTsx.solid'
import RippleElement from '@components/rippleElement.solid'
import appSidebarLeft from '@components/sidebarLeft'
import { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import { hideToast, toast, toastNew } from '@components/toast'
import anchorCallback from '@helpers/dom/anchorCallback'
import documentFragmentToNodes from '@helpers/dom/documentFragmentToNodes'
import getAuthorizationErrorLangKey from '@helpers/getAuthorizationErrorLangKey'
import Animated from '@helpers/solid/animations.solid'
import classNames from '@helpers/string/classNames'
import { I18n, i18n } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import { getProxiedManagers, type Managers } from '@/client/bootstrap'
import type { UnconfirmedAuthorization } from '@core/managers/sessionsManager'
import { useIsSidebarCollapsed } from '@stores/foldersSidebar.solid'
import useUnconfirmedAuthorizations from '@stores/unconfirmedAuthorizations.solid'
import styles from '@components/sidebarLeft/newAuthorization.module.scss'

export function formatAuthorizationOrigin(authorization: UnconfirmedAuthorization) {
  return [authorization.device, authorization.location].filter(Boolean).join(', ')
}

function makeTitle(total: number) {
  const title = document.createDocumentFragment()
  if(total > 1) {
    title.append(`1/${total} `)
  }
  title.append(i18n('UnconfirmedAuthTitle'))
  return title
}

function getAuthorizationAccessibleLabel(authorization: UnconfirmedAuthorization, total: number) {
  const position = total > 1 ? `1/${total}. ` : ''
  return position + I18n.format('UnconfirmedAuthTitle', true) + ' ' +
    I18n.format('UnconfirmedAuthSingle', true, [formatAuthorizationOrigin(authorization)])
}

function AuthorizationPreventedPopup(props: { authorization: UnconfirmedAuthorization }) {
  const [show, setShow] = createSignal(false)
  const [remaining, setRemaining] = createSignal(5)
  let interval: number
  let countdownStarted = false

  const startCountdown = () => {
    if(countdownStarted) return
    countdownStarted = true
    window.clearTimeout(readyFallback)
    setShow(true)
    interval = window.setInterval(() => {
      setRemaining((value) => {
        if(value <= 1) {
          window.clearInterval(interval)
          return 0
        }

        return value - 1
      })
    }, 1000)
  }

  const readyFallback = window.setTimeout(startCountdown, 1000)
  onCleanup(() => {
    window.clearTimeout(readyFallback)
    window.clearInterval(interval)
  })

  return (
    <PopupElementTsx
      class={styles.popup}
      closable={false}
      show={show()}
      animationGroup="none"
      isConfirmationNeededOnClose={() => {
        if(remaining()) return Promise.reject()
      }}
    >
      <PopupElementTsx.Body class={styles.popupBody}>
        <MediaHeader>
          <MediaHeader.Sticker
            class={styles.popupSticker}
            name="hand_stop"
            size={80}
            onReady={startCountdown}
          />
          <MediaHeader.Title>
            {i18n('UnconfirmedAuthDeniedTitle', [1])}
          </MediaHeader.Title>
          <MediaHeader.Subtitle>
            {i18n('UnconfirmedAuthDeniedMessageSingle', [formatAuthorizationOrigin(props.authorization)])}
          </MediaHeader.Subtitle>
        </MediaHeader>
        <div class={classNames('popup-description-framed', styles.warning)}>
          {i18n('UnconfirmedAuthDeniedWarning')}
        </div>
      </PopupElementTsx.Body>
      <PopupElementTsx.Footer>
        <PopupElementTsx.FooterButton
          confirm
          disabled={!!remaining()}
        >
          {i18n('UnconfirmedAuthDeniedButton')}
          {remaining() ? ` (${remaining()})` : undefined}
        </PopupElementTsx.FooterButton>
      </PopupElementTsx.Footer>
    </PopupElementTsx>
  )
}

function showAuthorizationPrevented(authorization: UnconfirmedAuthorization) {
  createPopupTsx(() => <AuthorizationPreventedPopup authorization={authorization} />)
}

async function openActiveSessions() {
  const authorizations = await getProxiedManagers().sessions.list() // расхождение 1
  void appSidebarLeft.createTab(AppActiveSessionsTab).open({
    authorizations,
  })
}

function showAuthorizationConfirmed() {
  const devicesLink = anchorCallback(() => {
    hideToast()
    openActiveSessions().catch(() => toastNew({ langPackKey: 'Error.AnError' }))
  })
  devicesLink.append(i18n('Settings'), ' > ', i18n('Devices'))

  const content = document.createDocumentFragment()
  const title = document.createElement('strong')
  title.append(i18n('UnconfirmedAuthConfirmed'))
  content.append(
    title,
    document.createElement('br'),
    i18n('UnconfirmedAuthConfirmedMessage', [devicesLink]),
  )
  toast(content, undefined, 5000)
}

export function NewAuthorization(props: {
  authorization: UnconfirmedAuthorization
  total: number
}) {
  const [isSidebarCollapsed] = useIsSidebarCollapsed()
  const [processing, setProcessing] = createSignal(false)

  const performAction = async(action: 'confirm' | 'deny') => {
    if(processing()) return false

    const authorization = props.authorization
    setProcessing(true)
    try {
      const sessions = getProxiedManagers().sessions // расхождение 1
      const result = action === 'confirm' ?
        await sessions.confirmUnconfirmedAuthorization(authorization.hash) :
        await sessions.terminate(Number(authorization.hash))

      if(!result) {
        throw new Error('Authorization action failed')
      }

      if(action === 'confirm') {
        showAuthorizationConfirmed()
      } else {
        setTimeout(() => showAuthorizationPrevented(authorization), 0)
      }

      return true
    } catch(err) {
      toastNew({ langPackKey: getAuthorizationErrorLangKey(err as ApiError) })
      return false
    } finally {
      setProcessing(false)
    }
  }

  const showActionsPopup = () => {
    createPopupTsx(() => (
      <PopupElementTsx closable show>
        <PopupElementTsx.Header>
          <PopupElementTsx.Title>{makeTitle(props.total)}</PopupElementTsx.Title>
        </PopupElementTsx.Header>
        <PopupElementTsx.Body>
          <div class="popup-description">
            {i18n('UnconfirmedAuthSingle', [formatAuthorizationOrigin(props.authorization)])}
          </div>
        </PopupElementTsx.Body>
        <PopupElementTsx.Buttons>
          <PopupElementTsx.Button
            confirm
            langKey="UnconfirmedAuthConfirm"
            callback={() => performAction('confirm')}
          />
          <PopupElementTsx.Button
            danger
            langKey="UnconfirmedAuthDeny"
            callback={() => performAction('deny')}
          />
        </PopupElementTsx.Buttons>
      </PopupElementTsx>
    ))
  }

  return (
    <Show
      when={isSidebarCollapsed()}
      fallback={
        <div
          class={styles.notice}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <div class={styles.title}>
            {props.total > 1 && `1/${props.total} `}
            {i18n('UnconfirmedAuthTitle')}
          </div>
          <div class={styles.subtitle}>
            {i18n('UnconfirmedAuthSingle', [formatAuthorizationOrigin(props.authorization)])}
          </div>
          <div class={styles.actions}>
            <Button
              class={classNames(styles.action, 'rp-overflow', 'hover-primary-effect')}
              disabled={processing()}
              onClick={() => performAction('confirm')}
              text="UnconfirmedAuthConfirm"
            />
            <Button
              class={classNames(styles.action, styles.deny, 'rp-overflow', 'hover-danger-effect')}
              disabled={processing()}
              onClick={() => performAction('deny')}
              text="UnconfirmedAuthDeny"
            />
          </div>
        </div>
      }
    >
      <RippleElement
        component="button"
        type="button"
        class={classNames(styles.collapsed, 'hover-effect')}
        onClick={showActionsPopup}
        aria-label={getAuthorizationAccessibleLabel(props.authorization, props.total)}
      >
        {documentFragmentToNodes(wrapEmojiText('🔐'))}
      </RippleElement>
    </Show>
  )
}

export function renderNewAuthorization(toElement: HTMLElement, managers: Managers) {
  toElement.classList.add(styles.container)

  const dispose = render(() => {
    const authorizations = useUnconfirmedAuthorizations(managers)
    const [element, setElement] = createSignal<JSX.Element>()

    createEffect(() => {
      const authorization = authorizations()[0]
      setElement(authorization ? (
        <div class={styles.noticeContainer}>
          <NewAuthorization
            authorization={authorization}
            total={authorizations().length}
          />
        </div>
      ) : undefined)
    })

    createEffect(() => {
      document.body.classList.toggle('has-unconfirmed-authorization', !!element())
    })

    onCleanup(() => {
      document.body.classList.remove('has-unconfirmed-authorization')
    })

    return (
      <Animated
        type="grow-height"
        appear
        mode="add-remove"
        noItemClass
      >
        {element()}
      </Animated>
    )
  }, toElement)

  return dispose // расхождение 2
}

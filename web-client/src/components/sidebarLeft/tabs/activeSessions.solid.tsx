/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/activeSessions.tsx` — вкладка
 * «Устройства» (активные сессии). Первая настоящая вкладка на подсистеме
 * слайдера (задачи 4–6): содержимое строит императивный DOM
 * (`Row`/`SettingSection`/`Button`), а Solid здесь — только жизненный цикл
 * (`onMount`/`onCleanup`), ровно как в оригинале (компонент возвращает `null`).
 *
 * Структура 1:1: секция текущей сессии (+ кнопка «завершить все прочие», если
 * прочие есть) и секция прочих сессий; клик или контекстное меню по строке
 * прочей сессии — подтверждение и завершение.
 *
 * ── Отступления, продиктованные НАШИМ проводом (не вкусом) ─────────────────
 *
 * 1. `pFlags` читается через `?.` (:32, :60 оригинала — `auth.pFlags.current`).
 *    У MTProto `pFlags` всегда объект (его создаёт десериализатор), а наш
 *    бэкенд — Go со `json:"pFlags,omitempty"` (`internal/domain/mtaccount.go`):
 *    у сессии БЕЗ единого взведённого флага поле в JSON просто отсутствует.
 *    Без `?.` первая же не-текущая сессия роняла бы `findAndSplice` на
 *    `TypeError`. Расхождение записано долгом провода (см. отчёт задачи 7).
 *
 * 2. «Текущую строку не гасим» (:132, :157 — `target.dataset.hash === '0'`).
 *    У MTProto адрес ТЕКУЩЕЙ сессии равен нулю — то есть `'0'` в оригинале
 *    это и есть «строка текущей сессии», а не магическое число. Наш бэкенд
 *    кладёт в `hash` настоящий id устройства, одинаково для всех строк,
 *    поэтому проверка на ноль у нас не защитила бы ничего: пользователь
 *    завершил бы собственную сессию кликом по первой секции. Сравниваем с
 *    `hash` той самой сессии, которую `findAndSplice` признал текущей —
 *    тот же смысл, взятый из данных, а не из константы чужого провода.
 *
 * 3. Отказ сервера (:45-50 — `err.type === 'FRESH_RESET_AUTHORISATION_FORBIDDEN'`).
 *    Через нашу границу воркера объект ошибки не проходит целиком:
 *    `superMessagePort.ts:228,235-238` пересылает ТОЛЬКО `message` и `status`
 *    и пересобирает `new Error(message)` на стороне UI. Поля `type` у ошибки
 *    здесь не бывает НИКОГДА — ветка на `err.type` была бы заведомо мёртвой,
 *    а не портом. Имя отказа приезжает текстом (`error.text` бэкенда →
 *    `HttpError.message`, `core/net/restClient.ts:14-18`), по нему и
 *    сверяемся. Остальные ошибки, как и в оригинале, не показываются.
 *
 * 4. `tab.managers!` — поле объявлено опциональным (`sliderTab.ts`), потому
 *    что его проставляет слайдер ПОСЛЕ конструктора (`slider.ts:405`, tweb
 *    :270). Тот же приём, что у `this.slider!` в самом `sliderTab.ts`:
 *    ненулевое утверждение в точке вызова, а не смена контракта.
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `getOverlayRoot()` (`helpers/appWindow.ts` — их поддержка Document PiP)
 *    → `document.body`, как уже сделано в `components/chat/contextMenu.ts:909`;
 *  • `langKey`/`LangPackKey` → строка-ключ через `useI18nStore.getState().t`
 *    (тот же приём, что в `row.ts`/`button.ts`/`popupPeer.ts`) — читается В
 *    ТОЧКЕ ПРИМЕНЕНИЯ (`row.ts:173,247`, `button.ts:59`), а не снимается
 *    один раз на открытии вкладки: иначе смена языка при открытой вкладке
 *    оставила бы кнопку попапа на старом языке;
 *  • `appAccountManager.resetAuthorization(hash)`/`resetAuthorizations()` →
 *    `tab.managers.sessions.terminate(id)`/`terminateOthers()` — наш прямой
 *    аналог; `hash` из `dataset` — строка, менеджер адресует сессию числом.
 */
import { onCleanup, onMount, type Component } from 'solid-js'
import type { Authorization } from '@layer'
import Button from '@components/button'
import Row from '@components/row'
import SettingSection from '@components/settingSection'
import { ButtonMenuSync } from '@components/buttonMenu'
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import { toastNew } from '@components/toast'
import { formatDateAccordingToTodayNew } from '@helpers/date'
import findAndSplice from '@helpers/array/findAndSplice'
import findUpClassName from '@helpers/dom/findUpClassName'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import { attachContextMenuListener } from '@helpers/dom/attachContextMenuListener'
import toggleDisability from '@helpers/dom/toggleDisability'
import positionMenu from '@helpers/positionMenu'
import contextMenuController from '@helpers/contextMenuController'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppActiveSessionsTab } from '@components/solidJsTabs/tabs'
import { useI18nStore } from '@/i18n'

const ActiveSessions: Component = () => {
  const [tab] = useSuperTab<typeof AppActiveSessionsTab>()

  let menuElement: HTMLElement | undefined

  onMount(() => {
    tab.container.classList.add('active-sessions-container')

    const Session = (auth: Authorization.authorization) => {
      const row = new Row({
        title: [auth.app_name, auth.app_version].join(' '),
        subtitle: [auth.ip, auth.country].filter(Boolean).join(' - '),
        clickable: true,
        titleRight: auth.pFlags?.current ? undefined : formatDateAccordingToTodayNew(new Date(Math.max(auth.date_active, auth.date_created) * 1000)),
      })

      row.container.dataset.hash = '' + auth.hash

      row.midtitle.textContent = [auth.device_model, auth.system_version || auth.platform].filter(Boolean).join(', ')

      return row
    }

    const authorizations = tab.payload.authorizations.slice()

    const onError = (err: unknown) => {
      // См. отступление 3 в докблоке файла: имя отказа приезжает текстом.
      if((err as { message?: string })?.message === 'FRESH_RESET_AUTHORISATION_FORBIDDEN') {
        toastNew({ langPackKey: 'RecentSessions.Error.FreshReset' })
      }
    }

    // Строка текущей сессии — единственная, которую нельзя завершить кликом;
    // см. отступление 2 в докблоке файла.
    let currentHash: string | undefined

    {
      const section = new SettingSection({
        name: 'CurrentSession',
        caption: 'ClearOtherSessionsHelp',
      })

      // Оригинал (:60-61) тоже не проверяет результат: сервер обязан отдать
      // текущую сессию в списке. Если её нет — падаем внутри `onMount`, а не
      // молча рисуем чужую строку как свою; падение ловит `ErrorBoundary`
      // моста (`mountSolid`), вкладка целиком не умирает.
      const auth = findAndSplice(authorizations, (auth) => !!auth.pFlags?.current)!
      const session = Session(auth)
      currentHash = session.container.dataset.hash

      section.content.append(session.container)

      if(authorizations.length) {
        const btnTerminate = Button('btn-primary btn-transparent danger', { icon: 'stop', text: 'TerminateAllSessions' })
        attachClickEvent(btnTerminate, () => {
          PopupElement.createPopup(PopupPeer, 'revoke-session', {
            buttons: [{
              text: useI18nStore.getState().t('Terminate'),
              isDanger: true,
              callback: () => {
                const toggle = toggleDisability([btnTerminate], true)
                tab.managers!.sessions.terminateOthers().then((value) => {
                  if(value) {
                    btnTerminate.remove()
                    otherSection.container.remove()
                  }
                }, onError).finally(() => {
                  toggle()
                })
              },
            }],
            titleLangKey: 'AreYouSureSessionsTitle',
            descriptionLangKey: 'AreYouSureSessions',
          }).show()
        }, { listenerSetter: tab.listenerSetter })

        section.content.append(btnTerminate)
      }

      tab.scrollable.append(section.container)
    }

    if(!authorizations.length) {
      return
    }

    const otherSection = new SettingSection({
      name: 'OtherSessions',
      caption: 'SessionsListInfo',
    })

    authorizations.forEach((auth) => {
      otherSection.content.append(Session(auth).container)
    })

    tab.scrollable.append(otherSection.container)

    let target: HTMLElement | null
    const onTerminateClick = () => {
      const row = target!
      const hash = row.dataset.hash!

      PopupElement.createPopup(PopupPeer, 'revoke-session', {
        buttons: [{
          text: useI18nStore.getState().t('Terminate'),
          isDanger: true,
          callback: () => {
            tab.managers!.sessions.terminate(Number(hash))
            .then((value) => {
              if(value) {
                row.remove()
              }
            }, onError)
          },
        }],
        titleLangKey: 'AreYouSureSessionTitle',
        descriptionLangKey: 'TerminateSessionText',
      }).show()
    }

    const element = menuElement = ButtonMenuSync({
      buttons: [{
        icon: 'stop',
        text: 'Terminate',
        onClick: onTerminateClick,
      }],
    })
    element.id = 'active-sessions-contextmenu'
    element.classList.add('contextmenu')

    document.body.append(element)

    attachContextMenuListener({
      element: tab.scrollable.container,
      callback: (e) => {
        target = findUpClassName(e.target as HTMLElement, 'row')
        if(!target || target.dataset.hash === currentHash) {
          return
        }

        // tweb :137-138 — `e.preventDefault()` + `e.cancelBubble = true`.
        // `cancelBubble = true` по спецификации DOM это ровно «взвести флаг
        // остановки всплытия», то есть `stopPropagation()`; берём вторую
        // форму, потому что happy-dom отдаёт `cancelBubble` ТОЛЬКО геттером
        // и присваивание в нём бросает — строка стала бы непроверяемой.
        // Проверка на `touches` — та же cross-realm-безопасная («мышь ли
        // это»), что у оригинала, без `instanceof MouseEvent`.
        if(!('touches' in e)) {
          e.preventDefault()
          e.stopPropagation()
        }

        positionMenu(e, element)
        contextMenuController.openBtnMenu(element)
      },
      listenerSetter: tab.listenerSetter,
    })

    attachClickEvent(tab.scrollable.container, (e) => {
      target = findUpClassName(e.target as HTMLElement, 'row')
      if(!target || target.dataset.hash === currentHash) {
        return
      }

      onTerminateClick()
    }, { listenerSetter: tab.listenerSetter })
  })

  onCleanup(() => {
    menuElement?.remove()
  })

  return null
}

export default ActiveSessions

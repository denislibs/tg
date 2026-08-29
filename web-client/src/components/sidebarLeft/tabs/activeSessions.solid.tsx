/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/activeSessions.tsx` — вкладка
 * «Устройства» (активные сессии). Первая настоящая вкладка на подсистеме
 * слайдера (шаги 4–6 плана волны 2): содержимое строит императивный DOM
 * (`Row`/`SettingSection`/`Button`), а Solid здесь — только жизненный цикл
 * (`onMount`/`onCleanup`), ровно как в оригинале (компонент возвращает `null`).
 *
 * Структура 1:1: секция текущей сессии (+ кнопка «завершить все прочие», если
 * прочие есть) и секция прочих сессий; клик или контекстное меню по строке
 * прочей сессии — подтверждение и завершение.
 *
 * Отступление одно и оно наше, не проводное: `tab.managers!` — поле объявлено
 * опциональным (`sliderTab.ts`), потому что его проставляет слайдер ПОСЛЕ
 * конструктора (`slider.ts::createTab`, tweb :270). Тот же приём, что у `this.slider!`
 * в самом `sliderTab.ts`: ненулевое утверждение в точке вызова, а не смена
 * контракта.
 *
 * ── Адаптации под наш стек ─────────────────────────────────────────────────
 *  • `getOverlayRoot()` (`helpers/appWindow.ts` — их поддержка Document PiP)
 *    → `document.body`, как уже сделано в `components/chat/contextMenu.ts:909`;
 *  • `langKey`/`LangPackKey` → строка-ключ через `useI18nStore.getState().t`
 *    (#109, тот же приём, что в `row.ts`/`button.ts`/`popupPeer.ts`) —
 *    читается В ТОЧКЕ ПРИМЕНЕНИЯ (`row.ts::title`, `button.ts::text`), а не
 *    снимается один раз на открытии вкладки: иначе смена языка при открытой
 *    вкладке оставила бы кнопку попапа на старом языке;
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
        titleRight: auth.pFlags.current ? undefined : formatDateAccordingToTodayNew(new Date(Math.max(auth.date_active, auth.date_created) * 1000)),
      })

      row.container.dataset.hash = '' + auth.hash

      row.midtitle.textContent = [auth.device_model, auth.system_version || auth.platform].filter(Boolean).join(', ')

      return row
    }

    const authorizations = tab.payload.authorizations.slice()

    const onError = (err: ApiError) => {
      if(err.type === 'FRESH_RESET_AUTHORISATION_FORBIDDEN') {
        toastNew({ langPackKey: 'RecentSessions.Error.FreshReset' })
      }
    }

    {
      const section = new SettingSection({
        name: 'CurrentSession',
        caption: 'ClearOtherSessionsHelp',
      })

      // Оригинал (:60-61) тоже не проверяет результат: сервер обязан отдать
      // текущую сессию в списке. Если её нет — падаем внутри `onMount`, а не
      // молча рисуем чужую строку как свою; падение ловит `ErrorBoundary`
      // моста (`mountSolid`), вкладка целиком не умирает.
      const auth = findAndSplice(authorizations, (auth) => auth.pFlags.current)!
      const session = Session(auth)

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
        // `t(...)` ОБЯЗАТЕЛЕН: `ButtonMenuItem` кладёт `text` прямо в
        // `i18nSpan` (`buttonMenu.ts::ButtonMenuItem`), то есть переводит
        // ВЫЗЫВАЮЩИЙ — в отличие от `Button`/`Row`/`SettingSection`, которые
        // переводят у себя. Сырой ключ показывал в русском интерфейсе
        // «Terminate» вместо «Завершить» (найдено живой проверкой стенда). См.
        // #109: с портом `langPack` обе стороны снова станут `LangPackKey`, и
        // разница исчезнет.
        text: useI18nStore.getState().t('Terminate'),
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
        if(!target || target.dataset.hash === '0') {
          return
        }

        // tweb :151-152 — `e.preventDefault()` + `e.cancelBubble = true`.
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
      if(!target || target.dataset.hash === '0') {
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

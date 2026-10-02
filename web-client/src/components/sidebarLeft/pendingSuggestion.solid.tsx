/** @jsxImportSource solid-js */
// Порт tweb `src/components/sidebarLeft/pendingSuggestion.tsx` (812502980,
// 1-158) — плашка-подсказка над списком чатов: из доступных видов берёт первый
// по приоритету (`selectPendingSuggestion`), оборачивает в `.suggestionContainer`
// и показывает/прячет `<Animated type="grow-height">`; пока плашка есть —
// `body.has-pending-suggestion` (его читает `styles/tweb/_leftSidebar.scss`).
//
// Узел даёт владелец списка: `lib/appDialogsManager.ts` препендит контейнер в
// `.chatlist-overlay` и зовёт `renderPendingSuggestion` (tweb
// `appDialogsManager.ts:1384-1388`). Высоту оверлея он же пишет в
// `--chatlist-overlay-height` — по ней `.folders-scrollable` берёт `padding-top`,
// поэтому плашка раздвигает список, а не наезжает на него.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Виды — только `notifications`. `frozen`, `passkey`, `birthdayContacts`,
//     `birthdaySetup` и побочный `createEmailSetupSuggestion()` (попап «укажите
//     почту») берут данные с сервера — заморозки аккаунта и промо-подсказок
//     (`help.getPromoData`/`help.dismissSuggestion`) на нашем бэкенде нет:
//     О-108 волна 7.
//  2. `BotConnectionReviewSuggestion` (`:23-102`, проверка подключения
//     бизнес-бота, `stores/chatAutomation`) не перенесён: бизнес-ботов на
//     бэкенде нет — О-109 волна 7. Ветка `botConnectionReviews().length` в
//     `suggestionConstructor` уходит вместе с ним.
//  3. `renderPendingSuggestion` возвращает `dispose`, и при нём снимается
//     `has-pending-suggestion`: у tweb корень живёт вечно, у нас владелец списка
//     размонтируется и обязан убрать свои следы (`destroy()`, расхождение 1
//     шапки `appDialogsManager.ts`).
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import createNotificationsSuggestion from '@components/sidebarLeft/notificationsSuggestion.solid'
import type { PendingSuggestionController } from '@components/sidebarLeft/pendingSuggestionController'
import styles from '@components/sidebarLeft/pendingSuggestion.module.scss'
import selectPendingSuggestion, { type PendingSuggestionType } from '@components/sidebarLeft/selectPendingSuggestion'
import Animated from '@helpers/solid/animations.solid'

export function renderPendingSuggestion(toElement: HTMLElement) {
  return render(() => {
    const suggestions: Record<PendingSuggestionType, PendingSuggestionController> = {
      notifications: createNotificationsSuggestion(),
    }

    const [element, setElement] = createSignal<JSX.Element>()
    const suggestionConstructor = createMemo(() => {
      const type = selectPendingSuggestion({
        notifications: suggestions.notifications.available(),
      })

      return type ? suggestions[type].component : undefined
    })

    createEffect(() => {
      const constructor = suggestionConstructor()
      const element = constructor ? (<div class={styles.suggestionContainer}>{constructor()}</div>) : undefined
      setElement(element)
    })

    createEffect(() => {
      document.body.classList.toggle('has-pending-suggestion', !!element())
    })

    onCleanup(() => document.body.classList.remove('has-pending-suggestion')) // расхождение 3

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
}

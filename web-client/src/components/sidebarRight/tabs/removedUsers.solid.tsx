/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/removedUsers.tsx:1-140`
 * (812502980) — вкладка правой колонки «Удалённые» (`AppRemovedUsersTab`,
 * tweb `tabs.ts:450-456`). Задача 0б-7 волны 7 (П-1). Открывает её строка
 * «Удалённые пользователи» редактора чата (`editChat.tsx:864-871`).
 *
 *   .sidebar-content
 *     button.btn-corner.is-visible (удалить ещё, при праве `change_permissions`)  (:116-127)
 *     div.selector
 *       .scrollable > Section.no-content (подпись) + .selector-height-container   (:56-65, :129-137)
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Сообществ нет (О-5): источник один — чат (`chatRemovedUsersSource.ts`),
 *     `useCommunityTabGuard` и ветка `communityId` (:31-38, :68-75) не нужны;
 *     источник создаётся синхронно (его расхождение 1).
 *  2. Имя «кто удалил» — `PeerTitle` (`components/chat/peerTitle.ts`) вместо
 *     `wrapPeerTitle`: узлу нужна миддлварь строки.
 */
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  type Component,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import type AppSelectPeers from '@components/appSelectPeers.solid'
import Button from '@components/buttonTsx.solid'
import Section from '@components/section.solid'
import PeerTitle from '@components/chat/peerTitle'
import createMiddleware from '@helpers/solid/createMiddleware'
import { i18n } from '@lib/langPack'
import { toPeerId } from '@core/peers/peerId'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppRemovedUsersTab } from '@components/solidJsTabs/tabs'
import createChatRemovedUsersSource from './chatRemovedUsersSource'
import {
  isRemovedParticipant,
  type RemovedUsersSource,
} from './removedUsersSource'

const RemovedUsers: Component = () => {
  const [tab] = useSuperTab<typeof AppRemovedUsersTab>()
  const promiseCollector = usePromiseCollector()
  const chatId = tab.payload.chatId

  const middlewareHelper = createMiddleware()
  const middleware = middlewareHelper.get(tab.middlewareHelper.get())
  const [source, setSource] = createSignal<RemovedUsersSource>()
  const [selector, setSelector] = createSignal<AppSelectPeers>()
  const [captionElement, setCaptionElement] =
    createSignal<HTMLDivElement>()
  onCleanup(() => {
    tab.container.classList.remove(
      'edit-peer-container',
      'removed-users-container',
    )
    selector()?.container?.remove()
  })

  createEffect(() => {
    const currentSelector = selector()
    const element = captionElement()
    if(currentSelector && element) {
      currentSelector.scrollable.container.insertBefore(
        element,
        currentSelector.heightContainer,
      )
    }
  })

  promiseCollector.collect((async() => {
    // расхождение 1
    const removedUsersSource = createChatRemovedUsersSource({ tab, chatId, middleware })
    if(!middleware()) {
      return
    }

    tab.container.classList.add(
      'edit-peer-container',
      'removed-users-container',
    )
    const selectorResult = removedUsersSource.createSelector({
      appendTo: tab.content,
      managers: tab.managers!,
      middleware,
      getSubtitleForElement: (participantId: PeerId) => {
        const participant = selector()?.participants.get(participantId)
        if(!isRemovedParticipant(participant)) {
          return
        }

        // расхождение 2
        return i18n('UserRemovedBy', [
          new PeerTitle({
            peerId: toPeerId(participant.kicked_by, false),
            middleware,
            managers: tab.managers!,
          }).element,
        ])
      },
    })
    setSelector(selectorResult.selector)
    selectorResult.selector.scrollable.container.querySelector(
      '.gradient-delimiter',
    )?.remove()
    removedUsersSource.attachSelectorBehavior(selectorResult.selector)
    setSource(removedUsersSource)

    await selectorResult.loadPromise
  })())

  return (
    <>
      <Portal mount={tab.content}>
        <Show when={source()?.canChangePermissions}>
          <Button.Corner
            class="is-visible"
            icon="addmember_filled"
            aria-label={i18n('RemovedUsers').textContent ?? undefined}
            tabIndex={0}
            onClick={() => source()?.openAddParticipant()}
          />
        </Show>
      </Portal>

      <Show when={source()}>
        {(source) => (
          <Show when={selector()}>
            {(selector) => (
              <Portal mount={selector().scrollable.container}>
                <Section
                  ref={setCaptionElement}
                  noContent
                  caption={source().caption}
                />
              </Portal>
            )}
          </Show>
        )}
      </Show>
    </>
  )
}

export default RemovedUsers

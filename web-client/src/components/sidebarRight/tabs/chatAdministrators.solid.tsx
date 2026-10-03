/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/chatAdministrators.tsx:1-225`
 * (812502980) — вкладка правой колонки «Администраторы» (`AppChatAdministratorsTab`,
 * `solidJsTabs/tabs.ts`, tweb `tabs.ts:494-501`). Задача 0б-7 волны 7 (пачка П-1).
 * Открывает её строка «Администраторы» редактора чата (`editChat.solid.tsx`,
 * tweb `editChat.tsx:849-856`).
 *
 *   .sidebar-content
 *     button.btn-corner.is-visible (добавить админа, при праве `add_admins`)   (:184-196)
 *     div.selector (`AppSelectPeers` на участниках с фильтром админов)          (:138-170)
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Сообществ нет (О-5): источник один — чат (`chatAdministratorsSource.ts`),
 *     `useCommunityTabGuard` и ветка `communityId` (:30-38, :59-63) не нужны.
 *  2. Подпись «Назначил(а) …» (`EditAdminPromotedBy`, :143-158): `promoted_by`
 *     на проводе нет (`core/peers/participant.ts`, Б-117) — у админа подписи
 *     своей нет, строка показывает статус, как у обычного участника. Создатель —
 *     `ChannelCreator`, как у оригинала.
 *  3. «Антиспам» (секция и `toggleAntiSpam`, :41, :175-221) — нет на бэкенде
 *     (Б-116, расхождение 1 источника): ни секции, ни переключателя.
 *  4. Источник создаётся синхронно (карточка — из зеркала, расхождение 1
 *     источника), у оригинала — `await`.
 */
import { createSignal, onCleanup, Show, type Component } from 'solid-js'
import { Portal } from 'solid-js/web'
import type AppSelectPeers from '@components/appSelectPeers.solid'
import Button from '@components/buttonTsx.solid'
import createMiddleware from '@helpers/solid/createMiddleware'
import { getParticipantPeerId, isParticipantAdmin } from '@core/peers/participant'
import { i18n } from '@lib/langPack'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppChatAdministratorsTab } from '@components/solidJsTabs/tabs'
import type {
  AdministratorParticipant,
  AdministratorsSource,
} from './administratorsSource'
import createChatAdministratorsSource from './chatAdministratorsSource'

const ChatAdministrators: Component = () => {
  const [tab] = useSuperTab<typeof AppChatAdministratorsTab>()
  const promiseCollector = usePromiseCollector()
  const chatId = tab.payload.chatId

  const middlewareHelper = createMiddleware()
  const middleware = middlewareHelper.get(tab.middlewareHelper.get())
  const [administratorSource, setAdministratorSource] =
    createSignal<AdministratorsSource>()
  const [selector, setSelector] = createSignal<AppSelectPeers>()
  let openPermissions!: (
    participantOrPeerId: AdministratorParticipant | PeerId,
  ) => void
  onCleanup(() => {
    tab.container.classList.remove(
      'edit-peer-container',
      'chat-administrators-container',
    )
    selector()?.container?.remove()
  })

  promiseCollector.collect((async() => {
    // расхождение 4
    const source: AdministratorsSource = createChatAdministratorsSource({
      tab,
      chatId,
      middleware,
    })
    if(!middleware()) {
      return
    }

    tab.container.classList.add(
      'edit-peer-container',
      'chat-administrators-container',
    )

    const syncParticipant = async(
      participantId: PeerId,
      updatedParticipant?: AdministratorParticipant,
    ) => {
      if(!middleware()) {
        return
      }
      const currentSelector = selector()
      if(!currentSelector) {
        return
      }
      if(!updatedParticipant || !isParticipantAdmin(updatedParticipant)) {
        currentSelector.participants.delete(participantId)
        currentSelector.deletePeerId(participantId)
        return
      }

      const updatedParticipantId = getParticipantPeerId(updatedParticipant)
      currentSelector.participants.set(
        updatedParticipantId,
        updatedParticipant,
      )
      if(!currentSelector.getElementByKey(updatedParticipantId)) {
        await currentSelector.renderResultsFunc(
          [updatedParticipantId],
          false,
        )
      }
    }

    openPermissions = (
      participantOrPeerId: AdministratorParticipant | PeerId,
    ) => {
      const currentSelector = selector()
      const participant = typeof(participantOrPeerId) === 'object' ?
        participantOrPeerId :
        currentSelector?.participants.get(participantOrPeerId)
      const participantId = participant ?
        getParticipantPeerId(participant) :
        participantOrPeerId as PeerId
      source.openPermissions({
        participantId,
        participant,
        onUpdated: (updatedParticipant) => {
          return syncParticipant(participantId, updatedParticipant)
        },
      })
    }

    const selectorResult = source.createSelector({
      appendTo: tab.content,
      managers: tab.managers!,
      middleware,
      getSubtitleForElement: (peerId: PeerId) => {
        const participant = selector()?.participants.get(peerId)
        if(!participant) {
          return
        }
        if(participant._ === 'channelParticipantCreator') {
          return i18n('ChannelCreator')
        }

        // `EditAdminPromotedBy` — расхождение 2
      },
      onSelect: (participantId: PeerId | string) => {
        openPermissions(
          selector()?.participants.get(participantId as PeerId) || participantId as PeerId,
        )
      },
    })
    setSelector(selectorResult.selector)
    source.attachSelectorBehavior?.(selectorResult.selector)
    setAdministratorSource(source)

    await selectorResult.loadPromise
  })())

  return (
    <>
      <Portal mount={tab.content}>
        <Show when={administratorSource()?.canAddAdmins}>
          <Button.Corner
            class="is-visible"
            icon="addmember_filled"
            aria-label={i18n('EditAdminAddAdmins').textContent ?? undefined}
            tabIndex={0}
            onClick={() => {
              administratorSource()?.openAddAdmin(openPermissions)
            }}
          />
        </Show>
      </Portal>
    </>
  )
}

export default ChatAdministrators

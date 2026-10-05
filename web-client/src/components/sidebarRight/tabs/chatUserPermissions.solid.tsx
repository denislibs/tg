/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/chatUserPermissions.tsx:1-567`
 * (812502980) — вкладка правой колонки «Права админа»/«Ограничения участника»
 * (`AppUserPermissionsTab`, tweb `tabs.ts:543-590`, через диспетчер
 * `userPermissions.solid.tsx`). Задача 0б-7 волны 7 (П-1). Открывают её
 * «Администраторы», меню участника (`createParticipantContextMenu`) и
 * исключения прав группы (`groupPermissions.solid.tsx`).
 *
 *   .sidebar-header > … + button.btn-icon.check (галочка «Сохранить», `createSolidTabState`)
 *   scrollable:
 *     Section[EditAdminWhatCanDo | UserRestrictionsCanDo]
 *       .chatlist-container (строка пользователя) + h2 + тумблеры прав        (:89-176)
 *     админ:     Section > «Разжаловать» (не создатель, могу править)            (:443-474)
 *     участник:  Section > «Длительность» (меню сроков)                          (:475-529)
 *                Section[UserPermissions.RestrictedBy] > «Удалить исключение»,
 *                «Заблокировать и удалить из группы»                            (:531-563)
 *
 * Модель сохранения — оригинала: запись в сеть только по угловой галочке шапки
 * (или «Сохранить» подтверждения на закрытии) — `createSolidTabState`; кнопки
 * «Разжаловать»/«Удалить исключение»/«Заблокировать» подменяют действие
 * сохранения (`saveSomethingDifferent`, :420-437).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Сообществ нет (О-5) — ветки `communityId` нет (у оригинала её отсекает
 *     диспетчер, :45-47).
 *  2. Добавления бота админом (`addingBot`, :50-66, :139-176, :178-210) и
 *     бота-привратника (`bot_guard`, `guard_bot_id`, :226-366) нет на бэкенде
 *     (Б-116): полезная нагрузка без `addingBot`, секций «Сделать админом» и
 *     «Обрабатывать заявки» нет, `isBot` правам не передаётся.
 *  3. Подписи админа (`rank`, секция `EditAdminRank`, :368-405) нет на проводе
 *     (Б-117): поле не рисуется, `editAdmin` уходит без ранга.
 *  4. `canEditAdmin(chat, participant)` — без `myId` (`promoted_by` на проводе
 *     нет, шапка `core/peers/participant.ts`).
 *  5. Базовых групп нет: `isChannel` всегда истина (у оригинала выбирает, откуда
 *     брать исходные права админа, :101-103).
 *  6. `handleChannelsTooMuch` (:72) — нет: сервер не знает лимита каналов
 *     (как у `editChat.solid.tsx`, его расхождение 5).
 *  7. Имена — `PeerTitle` (`components/chat/peerTitle.ts`) вместо
 *     `wrapPeerTitle`; карточки — зеркало (`cachedChat`) и `peers.getPeers`.
 *  8. Срок «свой» (`showDatePickerPopup`) — мост `popups/datePicker.bridge.ts`
 *     (ВРЕМЕННО до 2C-23, его шапка).
 */
import type { Component } from 'solid-js'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import toggleDisability from '@helpers/dom/toggleDisability'
import anchorCallback from '@helpers/dom/anchorCallback'
import copy from '@helpers/object/copy'
import formatDuration from '@helpers/formatDuration'
import tsNow from '@helpers/tsNow'
import { formatDate, formatFullSentTime } from '@helpers/date'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { i18n } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import appImManager from '@lib/appImManager'
import Button from '@components/button'
import Section from '@components/section.solid'
import Row from '@components/rowTsx.solid'
import PeerTitle from '@components/chat/peerTitle'
import { confirmationPopup } from '@components/popups/popupPeer'
import showDatePickerPopup from '@components/popups/datePicker.bridge'
import { wrapFormattedDuration } from '@components/wrappers/wrapDuration'
import type { ButtonMenuItemOptions } from '@components/buttonMenu'
import {
  ChatAdministratorRights,
  ChatPermissions,
  createSolidTabState,
} from './groupPermissions/sharedPermissions'
import {
  canEditAdmin,
  getParticipantPeerId,
  isParticipantAdmin,
  isParticipantCreator,
  participantAdminPredicates,
  type ChannelParticipant,
} from '@core/peers/participant'
import { cachedChat } from '@core/peerCache'
import { toPeerId } from '@core/peers/peerId'
import type { Channel, ChatAdminRights, ChatBannedRights, User } from '@core/peers/peer'
import { BANNED_RIGHTS_UNTIL_FOREVER } from '@core/managers/constants'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppUserPermissionsTab } from '@components/solidJsTabs/tabs'
import attachAdminRightsCaption from './attachAdminRightsCaption'
import appendPermissionsPeerDialog from './permissionsPeerDialog'

type ChannelParticipantAdminOrCreator = Extract<ChannelParticipant, { _: 'channelParticipantAdmin' | 'channelParticipantCreator' }>
type ChannelParticipantBanned = Extract<ChannelParticipant, { _: 'channelParticipantBanned' }>

const ChatUserPermissions: Component = () => {
  const [tab] = useSuperTab<typeof AppUserPermissionsTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!

  const {
    participant,
    chatId,
    userId,
    editingAdmin,
    initialAdminRights,
    existingAdminRights,
  } = tab.payload

  let saveCallback!: () => Promise<unknown>
  const solidState = createSolidTabState<{
    rights: ChatAdminRights | ChatBannedRights,
    rank: string
  }>({
    tab,
    // расхождение 6
    save: () => saveCallback(),
    unsavedConfirmationProps: {},
  })

  tab.header.append(solidState.saveIcon())
  // title is set by the scaffold (function of editingAdmin)

  promiseCollector.collect((async() => {
    tab.container.classList.add('edit-peer-container', 'user-permissions-container')

    // расхождение 7
    const chatPeerId = toPeerId(chatId as number, true)
    const chat = cachedChat(chatPeerId) as Channel
    const [user] = await managers.peers.getPeers([toPeerId(userId as number, false)]) as (User | undefined)[]
    const isChannel = true // расхождение 5
    const isCreator = isParticipantCreator(participant)
    const isAdmin = isParticipantAdmin(participant)
    const _canEditAdmin = canEditAdmin(chat, participant) // расхождение 4

    let goodTypes: Set<ChannelParticipant['_']>
    if(editingAdmin) {
      goodTypes = new Set(participantAdminPredicates)
    } else {
      goodTypes = new Set([
        'channelParticipantBanned',
      ])
    }

    // `confirmGuardBotChange`/`applyGuardBotChange` — расхождение 2

    let chatPermissions!: ChatPermissions
    {
      let sectionContent!: HTMLElement, sectionTitle!: HTMLElement, sectionCaption!: HTMLElement
      const section = wrapSolidComponent(() => (
        <Section
          name={editingAdmin ? 'EditAdminWhatCanDo' : 'UserRestrictionsCanDo'}
          // when editing an admin the caption is filled in by attachAdminRightsCaption
          caption={editingAdmin ? true : undefined}
          contentProps={{ ref: (element) => sectionContent = element }}
          nameRef={(element) => sectionTitle = element}
          captionRef={(element) => sectionCaption = element}
        />
      ), tab.middlewareHelper.get())

      appendPermissionsPeerDialog({
        content: sectionContent,
        title: sectionTitle,
        userId,
        user,
        middleware: tab.middlewareHelper.get(),
        managers,
      })

      const participantRights = goodTypes.has(participant._) ?
        (editingAdmin ?
          (participant as ChannelParticipantAdminOrCreator).admin_rights as ChatAdminRights :
          (participant as ChannelParticipantBanned).banned_rights as ChatBannedRights
        ) :
        undefined

      if(editingAdmin) {
        const p: ChatAdministratorRights = new ChatAdministratorRights({
          chatId,
          listenerSetter: tab.listenerSetter,
          appendTo: sectionContent,
          participant: goodTypes.has(participant._) ? participant as ChannelParticipantAdminOrCreator : undefined,
          rights: initialAdminRights,
          chat,
          canEdit: _canEditAdmin,
          onSomethingChanged: () => solidState.set({ rights: p.takeOut() }),
        })
        if(isAdmin) {
          solidState.setInitial({
            rights: copy(existingAdminRights || (isChannel ? participantRights as ChatAdminRights : p.takeOut())),
          })
        }

        solidState.set({ rights: p.takeOut() })

        attachAdminRightsCaption({
          caption: sectionCaption,
          permissions: p,
          canEdit: _canEditAdmin,
          listenerSetter: tab.listenerSetter,
        })

        saveCallback = async() => {
          if(!_canEditAdmin) {
            return
          }

          // `addingBot`, гард-бот — расхождение 2; `rank` — расхождение 3
          const rights = p.takeOut()
          await managers.groups.editAdmin(
            chatId,
            participant,
            rights,
          )
        }
      } else {
        const p = chatPermissions = new ChatPermissions({
          chatId,
          listenerSetter: tab.listenerSetter,
          appendTo: sectionContent,
          participant: goodTypes.has(participant._) ? participant as ChannelParticipantBanned : undefined,
          onSomethingChanged: () => solidState.set({ rights: p.takeOut() }),
        }, managers)
        solidState.setInitial({ rights: p.takeOut() })

        solidState.set({ rights: p.takeOut() })

        saveCallback = () => {
          const rights = p.takeOut()
          return managers.groups.editBanned(
            chatId,
            participant,
            rights,
          )
        }
      }

      tab.scrollable.append(section)
    }

    // секция ранга — расхождение 3

    const saveSomethingDifferent = async(btn: HTMLElement, _callback: () => Promise<unknown>) => {
      if(solidState.saving()) {
        return
      }

      const toggle = toggleDisability([btn], true)
      const callback = saveCallback
      try {
        saveCallback = _callback
        await solidState.save()
      } catch(err) {
        saveCallback = callback
        toggle()
        throw err
      }
    }

    if(editingAdmin) {
      let btnDelete: HTMLElement | undefined

      if(
        !isCreator &&
        _canEditAdmin &&
        isAdmin &&
        getParticipantPeerId(participant) !== rootScope.myId
      ) {
        btnDelete = Button('btn-primary btn-transparent danger', { icon: 'deleteuser', text: 'Channel.Admin.Dismiss' })

        const removeAdmin = () => managers.groups.editAdmin(
          chatId,
          participant,
          { _: 'chatAdminRights', pFlags: {} },
          '',
        )

        attachClickEvent(btnDelete, () => {
          void saveSomethingDifferent(btnDelete!, removeAdmin)
        }, { listenerSetter: tab.listenerSetter })
      }

      if(btnDelete) {
        tab.scrollable.append(wrapSolidComponent(() => (
          <Section>
            {btnDelete}
          </Section>
        ), tab.middlewareHelper.get()))
      }
    } else {
      const wrapDuration = (duration: number) => {
        return wrapFormattedDuration(formatDuration(duration, 1))
      }

      const getDurationOnClick = (duration: number, isTimestamp: boolean) => {
        const timestamp = isTimestamp ? duration : tsNow(true) + duration
        return () => chatPermissions.setUntilDate(timestamp)
      }

      const durationButtons: ButtonMenuItemOptions[] = [{
        text: 'UserPermissions.Duration.Forever',
        onClick: getDurationOnClick(BANNED_RIGHTS_UNTIL_FOREVER, true),
      }, ...[86400, 86400 * 7, 86400 * 365 / 12].map((duration) => ({
        regularText: wrapDuration(duration),
        onClick: getDurationOnClick(duration, false),
      })), {
        text: 'UserPermissions.Duration.Custom',
        onClick: () => {
          // расхождение 8
          showDatePickerPopup({
            initDate: new Date(),
            withTime: true,
            onPick: (timestamp) => {
              getDurationOnClick(timestamp, true)()
            },
            btnConfirmLangKey: 'Set',
          })
        },
      }]

      const sectionDuration = wrapSolidComponent(() => {
        const getSubtitle = () => {
          const timestamp = (solidState.store.rights as ChatBannedRights).until_date
          return timestamp === BANNED_RIGHTS_UNTIL_FOREVER ?
            i18n('UserPermissions.Duration.Forever') :
            formatDate(new Date(timestamp * 1000), { withTime: true })
        }

        return (
          <Section>
            <Row contextMenu={{ buttons: durationButtons }}>
              <Row.Title>{i18n('UserPermissions.Duration')}</Row.Title>
              <Row.Subtitle>{getSubtitle()}</Row.Subtitle>
            </Row>
          </Section>
        )
      }, tab.middlewareHelper.get())

      const restrictedByPeerId = participant._ === 'channelParticipantBanned' && participant.kicked_by ?
        toPeerId(participant.kicked_by, false) :
        undefined
      const anchor = restrictedByPeerId ? anchorCallback(() => {
        void appImManager.setInnerPeer({ peerId: restrictedByPeerId })
      }) : undefined
      if(restrictedByPeerId) anchor!.append(new PeerTitle({
        peerId: restrictedByPeerId,
        middleware: tab.middlewareHelper.get(),
        managers,
      }).element)
      let btnDeleteException: HTMLElement | undefined
      if(participant._ === 'channelParticipantBanned') {
        btnDeleteException = Button('btn-primary btn-transparent danger', { icon: 'delete', text: 'GroupPermission.Delete' })

        const clearChannelParticipantBannedRights = () => {
          return managers.groups.clearChannelParticipantBannedRights(
            chatId,
            participant,
          )
        }

        attachClickEvent(btnDeleteException, () => {
          void saveSomethingDifferent(btnDeleteException!, clearChannelParticipantBannedRights)
        }, { listenerSetter: tab.listenerSetter })
      }

      const btnDelete = Button('btn-primary btn-transparent danger', { icon: 'deleteuser', text: 'UserRestrictionsBlock' })

      const kickFromChat = async() => {
        const peerId = toPeerId(userId as number, false)
        await confirmationPopup({
          peerId: chatPeerId,
          managers,
          descriptionLangKey: 'Permissions.RemoveFromGroup',
          descriptionLangArgs: [new PeerTitle({ peerId, middleware: tab.middlewareHelper.get(), managers }).element],
          titleLangKey: 'ChannelBlockUser',
          button: {
            langKey: 'Remove',
            isDanger: true,
          },
        })

        await managers.groups.kickFromChat(chatId, participant)
      }

      attachClickEvent(btnDelete, () => {
        void saveSomethingDifferent(btnDelete, kickFromChat)
      }, { listenerSetter: tab.listenerSetter })

      const section = wrapSolidComponent(() => (
        <Section
          caption={anchor ? 'UserPermissions.RestrictedBy' : undefined}
          captionArgs={anchor ? [
            anchor,
            formatFullSentTime((participant as ChannelParticipantBanned).date),
          ] : undefined}
        >
          {btnDeleteException}
          {btnDelete}
        </Section>
      ), tab.middlewareHelper.get())

      tab.scrollable.append(sectionDuration, section)
    }
  })())

  return null
}

export default ChatUserPermissions

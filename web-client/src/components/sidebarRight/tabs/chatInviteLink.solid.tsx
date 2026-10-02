/** @jsxImportSource solid-js */
/**
 * порт tweb/src/components/sidebarRight/tabs/chatInviteLink.tsx:1-250 (812502980) —
 * вкладка одной ссылки-приглашения правой колонки: виджет ссылки (меню ⋮ и
 * кнопка — общие со списком, приходят в полезной нагрузке), кто и когда её
 * создал, «сможет вступить N» и список вступивших селектором `AppSelectPeers`.
 * Регистрация — `AppChatInviteLinkTab` в `solidJsTabs/tabs.ts` (tweb `:684-696`);
 * открывает её вкладка списка ссылок (`chatInviteLinks.solid.tsx::openLink`).
 *
 *   .tabs-tab > .sidebar-content(снят при вступивших) / .selector > .scrollable.selector-scrollable
 *     Section «InviteLink» (+ подпись о сроке/лимите) > div.invite-link-container
 *     Section «LinkCreatedeBy» > div.chatlist-container > ul.chatlist.chatlist-new > a.row (создатель)
 *     [Section > .row «PeopleCanJoinViaLinkCount»]
 *     [div.selector-height-container > Section «N joined» (+ «M left») > ul.chatlist]
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. (О-122) Заявок по ссылке нет на проводе: секции «JoinRequests» с меню
 *     «Добавить в группу/канал» / «Отклонить» (`:120-201`, `hideChatJoinRequest`)
 *     нет, а с ней и `isBroadcast` (`:29` — нужен только меню заявок).
 *  2. (О-123) Платные ссылки-подписки (`subscription_pricing`, секция
 *     «InviteLink.Observe.Fee», `:91-107`) — нет на бэкенде.
 *  3. (О-124) Вступившие — одна страница сервера (`getImportersLoader`,
 *     расхождение 4 `chatInviteLinkShared.ts`).
 *  4. (снято К-2: `appImManager.setInnerPeer({peerId})`, `:79`, `:216`.)
 *  5. `addDialogNew` берёт менеджеры строки параметром (`managers`, С1 у
 *     `lib/appDialogsManager.ts`).
 */
import type { Component } from 'solid-js'
import deferredPromise from '@helpers/cancellablePromise'
import { formatFullSentTime } from '@helpers/date'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import tsNow from '@helpers/tsNow'
import { addDialogNew, createChatList } from '@lib/appDialogsManager'
import { i18n } from '@lib/langPack'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import AppSelectPeers from '@components/appSelectPeers.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import { ChatInviteLink, getImportersLoader } from './chatInviteLinkShared'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppChatInviteLinkTab } from '@components/solidJsTabs/tabs'
import appImManager from '@lib/appImManager'
import { toPeerId } from '@core/peers/peerId'

const ChatInviteLinkTab: Component = () => {
  const [tab] = useSuperTab<typeof AppChatInviteLinkTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!
  const { chatId, chatInvite, menuButtons, actions } = tab.payload

  const setInnerPeer = (peerId: PeerId) => { void appImManager.setInnerPeer({ peerId }) }

  promiseCollector.collect((async() => {
    // default title 'InviteLink' is set by the scaffold; override only for a custom invite title
    if(chatInvite.title) {
      tab.title.replaceChildren(wrapEmojiText(chatInvite.title))
    }

    {
      const isExpiring = !!chatInvite.expire_date && chatInvite.expire_date > tsNow(true)
      const isUsageLimit = !!chatInvite.usage_limit && chatInvite.usage_limit <= (chatInvite.usage || 0)
      const inviteLink = new ChatInviteLink({
        buttons: menuButtons,
        listenerSetter: tab.listenerSetter,
        url: chatInvite.link,
        actions,
      })

      inviteLink.setChatInvite(chatInvite)

      tab.scrollable.append(wrapSolidComponent(() => (
        <Section
          name="InviteLink"
          caption={isUsageLimit ? 'LinkIsExpiredLimitReached' : (isExpiring ? 'InviteLinks.ExpiresCaption' : (chatInvite.expire_date ? 'LinkIsExpired' : undefined))}
          captionArgs={isExpiring ? [formatFullSentTime(chatInvite.expire_date!)] : undefined}
        >
          {inviteLink.container}
        </Section>
      ), tab.middlewareHelper.get()))
    }

    {
      const div = document.createElement('div')
      div.classList.add('chatlist-container')

      const list = createChatList({ new: true })
      div.append(list)

      const peerId = toPeerId(chatInvite.admin_id, false)
      const { dom } = addDialogNew({
        peerId,
        container: list,
        rippleEnabled: true,
        avatarSize: 'abitbigger',
        meAsSaved: false,
        wrapOptions: {
          middleware: tab.middlewareHelper.get(),
        },
        managers, // расхождение 5
      })

      dom.titleSpan.classList.add('text-bold')
      attachClickEvent(dom.listEl, () => {
        setInnerPeer(peerId)
      }, { listenerSetter: tab.listenerSetter })

      dom.lastMessageSpan.append(formatFullSentTime(chatInvite.date))

      tab.scrollable.append(wrapSolidComponent(() => (
        <Section name="LinkCreatedeBy">
          {div}
        </Section>
      ), tab.middlewareHelper.get()))
    }

    // :91-107 — плата за подписку (расхождение 2)

    if(chatInvite.usage_limit && !chatInvite.usage && (!chatInvite.expire_date || chatInvite.expire_date > tsNow(true))) {
      tab.scrollable.append(wrapSolidComponent(() => (
        <Section>
          <Row>
            <Row.Title>{i18n('PeopleCanJoinViaLinkCount', [chatInvite.usage_limit!])}</Row.Title>
          </Row>
        </Section>
      ), tab.middlewareHelper.get()))
    }

    const promises: Promise<unknown>[] = []
    // :120-201 — заявки по ссылке (расхождение 1)

    if(chatInvite.usage) {
      const { importersMap, load } = getImportersLoader({
        chatId,
        managers,
        link: chatInvite.link,
      })

      const deferred = deferredPromise<void>()
      const selector = new AppSelectPeers({
        middleware: tab.middlewareHelper.get(),
        appendTo: tab.container,
        onSelect: (peerId) => {
          setInnerPeer(peerId as PeerId)
        },
        // onChange: this.onSelectChange,
        peerType: ['custom'],
        getMoreCustom: load,
        getSubtitleForElement: (peerId) => {
          const date = importersMap.get(peerId)?.date
          return date ? formatFullSentTime(date) : undefined
        },
        sectionNameLangPackKey: i18n('PeopleJoined', [chatInvite.usage]),
        onFirstRender: () => {
          deferred.resolve!()
        },
        managers,
        noSearch: true,
        multiSelect: false,
      })

      tab.content.remove()
      selector.scrollable.attachBorderListeners(tab.container)
      selector.scrollable.prepend(...Array.from(tab.scrollable.container.children))

      if(chatInvite.usage_limit) {
        const i = i18n('PeopleJoinedRemaining', [chatInvite.usage_limit - chatInvite.usage])
        i.classList.add('sidebar-left-section-name-right')
        selector.section.title!.append(i)
      }

      promises.push(deferred)
    }

    await Promise.all(promises)
  })())

  return null
}

export default ChatInviteLinkTab

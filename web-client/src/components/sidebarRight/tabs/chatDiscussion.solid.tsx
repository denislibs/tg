/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/chatDiscussion.tsx:1-317` (812502980) —
 * вкладка «Группа обсуждения» канала / «Привязанный канал» группы
 * (`AppChatDiscussionTab`, `solidJsTabs/tabs.ts`, tweb `tabs.ts:528-532`).
 * Задача 0б-5, пачка П-1 (Б-40). Открывает её строка «Обсуждение» редактора
 * чата (`editChat.solid.tsx`, tweb `editChat.tsx:743-761`).
 *
 *   div.tabs-tab.chat-folders-container.chat-discussion-container
 *     div.sticker-container (UtyanDiscussion 120×120) + div.caption
 *     Section[caption DiscussionChannelHelp2 | DiscussionGroupHelp2]
 *       ul.chatlist (кандидаты; при привязке — только привязанная) + «Создать новую группу»
 *     Section(.hide) > button.danger «Отвязать группу / канал»
 *
 * Сеть — как у оригинала: привязка — по клику строки после подтверждения,
 * отвязка — по кнопке после подтверждения; «Создать новую группу» открывает
 * `AppNewGroupTab` и привязывает созданную группу в её `onCreate`. Новое
 * состояние вкладка берёт из кадра `chat_update` канала, как оригинал из
 * `chat_full_update`.
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. `appChatsManager.setDiscussionGroup(id, groupId)` (`:48`) — ручки канала
 *     `channels.linkDiscussion`/`unlinkDiscussion` (`PUT`/`DELETE
 *     /channels/{id}/discussion`). `handleChannelsTooMuch` (`:47`) не нужен:
 *     лимита каналов сервер не знает (как у `editChat.solid.tsx`, расхождение 5).
 *  2. `getGroupsForDiscussion` (`:98`) — `channels.discussionCandidates`
 *     (карточки чатов кладутся в зеркало пиров); `getChat`/`isPublic`/`isForum`
 *     (`:103-104`, `:145`, `:160-161`) — синхронно из зеркала (`cachedChat`),
 *     `getChatFull` группы (`:162`) — `groups.card`. Базовых групп (`chatFull`)
 *     сервер не производит — ветка `:175` сводится к `hidden_prehistory`.
 *  3. `getPeerActiveUsernames(chat)[0]` (`:236`) — `chat.username`: коллекции
 *     имён нет (О-17 волны 7).
 *  4. `wrapPeerTitle`/`PeerTitleTsx` — узел `PeerTitle` (`chat/peerTitle.ts`) на
 *     миддлвари вкладки; `getPeerTitle({plainText})` (`:53`) — заголовок из
 *     зеркала (`peerTitle`, `core/peerCache.ts`).
 *  5. `addDialogNew` без `loadPromises` (`:224`, `:230`): наша строка грузит
 *     аватар сама и промисов наружу не отдаёт — вкладка ждёт только список и
 *     анимацию.
 *  6. Миграции группы нет (`dialog_migrate`, `:265-270`): базовых групп сервер
 *     не производит (как у `editChat.solid.tsx`, расхождение 2).
 *  7. `chat_full_update` (`:272-280`) — кадр `rt:chat_update` с полной формой
 *     (`messages.chatFull`); после привязки и отвязки его шлёт сервер
 *     (`usecase/chat/discussion.go`). У группы обсуждения `linked_chat_id` — id
 *     канала, а карточка канала едет вторым элементом `chats` той же ручки
 *     (`groups.card` кладёт её в зеркало) — сторона группы («Привязанный канал»)
 *     открывается строкой редактора по `linkedChatId` группы; отвязка с неё —
 *     той же ручкой канала (`DELETE /channels/{id}/discussion`, разрешена и
 *     админу группы с `change_info`).
 *  8. Анимация — фолбэк PNG без WASM (`renderStaticAssetFallback`), как у
 *     вкладки ссылок (`chatInviteLinks.solid.tsx`, расхождение 9).
 *  9. Отказ в подтверждении (`await confirmationPopup`, `:71`, `:181`) у
 *     оригинала улетает необработанным отклонением из обработчика клика; здесь
 *     он ловится и обработчик выходит — видимый исход тот же (сети нет).
 */
import { createSignal, onMount, Show, type Component } from 'solid-js'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import shake from '@helpers/dom/shake'
import toggleDisability from '@helpers/dom/toggleDisability'
import { addDialogNew, createChatList } from '@lib/appDialogsManager'
import appImManager from '@lib/appImManager'
import { i18n, type LangPackKey } from '@lib/langPack'
import lottieLoader from '@lib/lottie/lottieLoader'
import { renderStaticAssetFallback } from '@lib/lottie/lottieAssetFallback'
import rootScope from '@lib/rootScope'
import Button from '@components/buttonTsx.solid'
import Section from '@components/section.solid'
import PeerTitle from '@components/chat/peerTitle'
import { confirmationPopup } from '@components/popups/popupPeer'
import { toastNew } from '@components/toast'
import { AppNewGroupTab } from '@components/solidJsTabs/tabs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppChatDiscussionTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import { RT } from '@core/realtime/events'
import { cachedChat, peerTitle } from '@core/peerCache'
import { isBroadcast as isBroadcastChat, isForum, isPublic } from '@core/peers/predicates'
import { hasRights } from '@core/peers/rights'
import { getPeerId, toChatId, toPeerId } from '@core/peers/peerId'

type DiscussionChat = { id: ChatId, username?: string }

const ChatDiscussion: Component = () => {
  const [tab] = useSuperTab<typeof AppChatDiscussionTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!
  const slider = tab.slider as SidebarSlider
  const { chatId } = tab.payload
  const chatPeerId = (id: ChatId) => toPeerId(id as number, true)

  let linkedChatId = tab.payload.linkedChatId
  let isBroadcast = false
  let canChangeInfo = false

  let stickerContainer!: HTMLDivElement
  let btnUnlink!: HTMLButtonElement

  const [captionEl, setCaptionEl] = createSignal<HTMLElement>()
  const [chatlistElement, setChatlistElement] = createSignal<HTMLElement>()
  const [sectionCaption, setSectionCaption] = createSignal<LangPackKey>()
  const [isBroadcastSig, setIsBroadcastSig] = createSignal(false)
  const [createGroupHidden, setCreateGroupHidden] = createSignal(false)
  const [unlinkHidden, setUnlinkHidden] = createSignal(false)
  const [unlinkText, setUnlinkText] = createSignal<LangPackKey>()

  // расхождение 4
  const wrapPeerTitle = (peerId: PeerId) => new PeerTitle({
    peerId,
    middleware: tab.middlewareHelper.get(),
    managers,
  }).element

  // расхождение 1
  const setDiscussionGroup = async(id: ChatId, groupId: ChatId | undefined) => {
    if(groupId === undefined) {
      await managers.channels.unlinkDiscussion(chatPeerId(id))
      return
    }

    await managers.channels.linkDiscussion(chatPeerId(id), chatPeerId(groupId))
  }

  const onCreateGroup = () => {
    // расхождение 4
    let title = peerTitle(chatPeerId(chatId))
    title += ' Chat'

    const subTab = slider.createTab(AppNewGroupTab)
    void subTab.open({
      peerIds: [],
      onCreate: async(newChatId) => {
        slider.removeTabFromHistory(tab)
        await setDiscussionGroup(chatId, newChatId)
      },
      openAfter: false,
      title,
      asChannel: true,
    })
  }

  const onUnlink = async() => {
    const _linkedChatId = linkedChatId!
    try {
      await confirmationPopup({
        descriptionLangKey: isBroadcast ? 'DiscussionUnlinkChannelAlert' : 'DiscussionUnlinkGroupAlert',
        descriptionLangArgs: [wrapPeerTitle(chatPeerId(_linkedChatId))],
        button: {
          langKey: 'DiscussionUnlink',
        },
      })
    } catch{
      return // расхождение 9
    }

    const toggle = toggleDisability([btnUnlink], true)
    try {
      await setDiscussionGroup(isBroadcast ? chatId : _linkedChatId, undefined)
    } catch(err) {
      console.error('setDiscussionGroup error', err)
    }

    if(!isBroadcast) {
      tab.close()
      return
    }

    toggle()
  }

  onMount(() => {
    promiseCollector.collect((async() => {
      const p = {
        animationData: lottieLoader.loadAnimationFromURLManually('UtyanDiscussion'),
        // расхождение 2
        chats: managers.channels.discussionCandidates(chatPeerId(chatId)),
      }

      const chat = cachedChat(chatPeerId(chatId))
      isBroadcast = isBroadcastChat(chat)
      canChangeInfo = !!chat && chat._ === 'channel' && hasRights(chat, 'change_info')

      tab.title.replaceChildren(i18n(isBroadcast ? 'DiscussionController.Channel.Title' : 'DiscussionController.Group.Title'))
      tab.container.classList.add('chat-folders-container', 'chat-discussion-container')

      setIsBroadcastSig(isBroadcast)
      setSectionCaption(isBroadcast ? 'DiscussionChannelHelp2' : 'DiscussionGroupHelp2')
      setUnlinkText(isBroadcast ? 'DiscussionUnlinkGroup' : 'DiscussionUnlinkChannel')

      const setCaption = () => {
        setCaptionEl(i18n(
          linkedChatId ? (isBroadcast ? 'DiscussionChannelGroupSetHelp2' : 'DiscussionGroupHelp') : 'DiscussionChannelHelp3',
          linkedChatId ? [wrapPeerTitle(chatPeerId(linkedChatId))] : undefined,
        ))
      }

      const chatlist = createChatList()
      chatlist.classList.add('chatlist')

      let busy = false
      attachClickEvent(chatlist, async(e) => {
        const el = findUpClassName(e.target as HTMLElement, 'chatlist-chat') as HTMLElement | null
        if(!el) {
          return
        }

        const peerId = Number(el.dataset.peerId) as PeerId

        if(linkedChatId) {
          void appImManager.setInnerPeer({ peerId })
          return
        }

        if(busy) {
          return
        }

        // расхождение 2
        const group = cachedChat(peerId)
        if(isForum(group)) {
          toastNew({ langPackKey: 'ChannelTopicsDiscussionForbidden' })
          shake(el)
          return
        }

        const d = document.createDocumentFragment()
        d.append(
          i18n('Discussion.Set.Modal.Text.PublicChannelPublicGroup', [
            wrapPeerTitle(peerId),
            wrapPeerTitle(chatPeerId(chatId)),
          ]),
        )

        const isPublicGroup = isPublic(group)
        const isPublicChannel = isPublic(cachedChat(chatPeerId(chatId)))
        const groupCard = await managers.groups.card(peerId)

        const br = document.createElement('br')
        if(!isPublicChannel) {
          d.append(br.cloneNode(), br.cloneNode(), i18n('Discussion.Set.PrivateChannel'))
        }

        if(!isPublicGroup) {
          d.append(br.cloneNode(), br.cloneNode(), i18n('Discussion.Set.PrivateGroup'))
        }

        if(groupCard?.fullChat.pFlags?.hidden_prehistory) {
          d.append(br.cloneNode(), br.cloneNode(), i18n('DiscussionLinkGroupAlertHistory'))
        }

        try {
          await confirmationPopup({
            peerId: chatPeerId(chatId),
            managers,
            description: d,
            button: {
              langKey: 'DiscussionLinkGroup',
            },
          })
        } catch{
          return // расхождение 9
        }

        busy = true
        try {
          await setDiscussionGroup(chatId, toChatId(peerId))
        } catch(err) {
          console.error('setDiscussionGroup error', err)
        }
        busy = false
      }, { listenerSetter: tab.listenerSetter })

      setChatlistElement(chatlist)

      const loadAnimationPromise = p.animationData.then(async(cb) => {
        const player = await cb({
          container: stickerContainer,
          loop: true,
          autoplay: true,
          width: 120,
          height: 120,
          middleware: tab.middlewareHelper.get(),
        })

        return lottieLoader.waitForFirstFrame(player)
      }).catch(() => {
        // расхождение 8
        renderStaticAssetFallback(stickerContainer, 'UtyanDiscussion')
      })

      const loadChatsPromise = (
        isBroadcast ?
          p.chats.then((candidates) => candidates.map((candidate): DiscussionChat => ({
            id: toChatId(candidate.peerId),
            username: candidate.username,
          }))) :
          Promise.resolve([] as DiscussionChat[])
      ).then((chats) => {
        if(linkedChatId && !chats.some((chat) => chat.id === linkedChatId)) {
          const linkedChat = cachedChat(chatPeerId(linkedChatId))
          chats.push({
            id: linkedChatId,
            username: linkedChat?._ === 'channel' ? linkedChat.username : undefined,
          })
        }

        chats.forEach((chat) => {
          const { dom } = addDialogNew({
            peerId: chatPeerId(chat.id),
            container: chatlist,
            rippleEnabled: true,
            avatarSize: 'abitbigger',
            wrapOptions: {
              middleware: tab.middlewareHelper.get(),
            },
            managers,
          })

          // расхождение 3
          const username = chat.username

          if(username) {
            dom.lastMessageSpan.textContent = '@' + username
          } else {
            dom.lastMessageSpan.append(i18n(isBroadcast ? 'DiscussionController.PrivateGroup' : 'DiscussionController.PrivateChannel'))
          }
        })
      })

      const update = () => {
        setCaption()

        if(!isBroadcast) {
          return
        }

        (Array.from(chatlist.children) as HTMLElement[]).forEach((el) => {
          const _chatId = toChatId(Number(el.dataset.peerId))
          el.classList.toggle('hide', linkedChatId ? linkedChatId !== _chatId : false)
        })
        setUnlinkHidden(!linkedChatId || !canChangeInfo)
        setCreateGroupHidden(!!linkedChatId || !canChangeInfo)
      }

      // расхождения 6, 7
      tab.listenerSetter.add(rootScope)(RT.chatUpdate, (evt) => {
        if(getPeerId(evt.peer) !== chatPeerId(chatId)) {
          return
        }

        linkedChatId = evt.chat_full.full_chat.linked_chat_id || undefined
        update()
      })

      await Promise.all([loadAnimationPromise, loadChatsPromise])
      update()
    })())
  })

  return (
    <>
      <div ref={stickerContainer} class="sticker-container" />
      <div class="caption">{captionEl()}</div>
      <Section caption={sectionCaption()}>
        <Show keyed when={chatlistElement()}>{(element) => element}</Show>
        <Show when={isBroadcastSig() && !createGroupHidden()}>
          <Button
            class="btn-primary btn-transparent primary"
            icon="newgroup"
            text="DiscussionCreateGroup"
            onClick={() => { onCreateGroup() }}
          />
        </Show>
      </Section>
      <Section classList={{ hide: unlinkHidden() }}>
        <Button
          ref={btnUnlink}
          class="btn-primary btn-transparent danger"
          icon="delete"
          text={unlinkText()}
          onClick={() => { void onUnlink() }}
        />
      </Section>
    </>
  )
}

export default ChatDiscussion

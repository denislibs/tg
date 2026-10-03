// ВРЕМЕННО до 2C-24 — мост вместо `showForwardPopup` из tweb
// `src/components/popups/forward.tsx:93-443` (812502980). Solid-попап пересылки
// над `pickUser` портируют задачи 16 и 24 плана 2C; до них получателя выбирает
// текущий React `ForwardPicker` (`messages/ChatDialogs.tsx`), открытый ФУНКЦИЕЙ
// через `popupStore` (остров оверлеев) — тот же приём, что у
// `popups/shareUrl.bridge.ts`. Задача 2C-24 заменяет импорт у вызывающих на
// `@components/popups/forward` и удаляет этот файл:
// `git grep -n "ВРЕМЕННО до 2C-24"` → пусто.
//
// Сигнатура и ход выбора — оригинала (`onSelect`, :350-399; `processSingle`,
// :185-227): ОДИН получатель — открыть его чат и поставить плашку пересылки в
// композер (`appImManager.chat.input.initMessagesForward`), несколько — переслать
// сразу каждому и показать тост `FwdMessage(s)To…`. Чего мост не умеет
// (закроет 2C-24):
//  1. поле комментария и меню отправки (без звука, по расписанию) подвала
//     попапа (:400-440) — у `ForwardPicker` их нет; поэтому «Избранное» одним
//     получателем идёт сразу пересылкой (`isSavedMessagesNoText`, :355-358);
//  2. «Копировать ссылку» поста канала (`canCopyLink`, :109-117) и темы
//     форумов получателя (`threadId`, `noTopics`);
//  3. права получателя выводятся из пересылаемых сообщений нашим
//     `resolveChatRightsActions` (`core/peers/filterByRights.ts`), у которого
//     права грубее (`send_messages`/`send_media`, а не по виду медиа).
import { createElement } from 'react'
import { openPopup } from '@stores/popupStore'
import { useChatsStore } from '@stores/chatsStore'
import { startClient } from '@/client/bootstrap'
import type { AppImManager } from '@lib/appImManager'
import rootScope from '@lib/rootScope'
import { toastNew } from '@components/toast'
import { i18n, join } from '@lib/langPack'
import { peerTitle } from '@core/peerCache'
import { resolveChatRightsActions } from '@core/peers/filterByRights'
import type { MyMessage } from '@core/models'

export type ForwardPeerIdMids = { [fromPeerId: PeerId]: number[] }

/** tweb `resolveChatRightsActions(peerIdMids)` (:28-91) — сообщения берутся из
 *  окна открытого чата: пересылать можно только то, что лента показала. */
function getForwardedMessages(appImManager: AppImManager, peerIdMids: ForwardPeerIdMids): MyMessage[] {
  const chat = appImManager.chat
  const messages: MyMessage[] = []
  for(const fromPeerId in peerIdMids) {
    if(!chat || chat.peerId !== +fromPeerId) continue
    for(const mid of peerIdMids[fromPeerId]) {
      const message = chat.getMessage(mid)
      if(message) messages.push(message)
    }
  }

  return messages
}

/** tweb `ChatInput.sendMessageWithForward` (input.ts) в объёме моста: без
 *  текста и параметров отправки (расхождение 1) — одна пересылка на источник. */
async function sendMessageWithForward(peerId: PeerId, forwarding: ForwardPeerIdMids): Promise<boolean> {
  const { managers } = startClient()
  try {
    for(const fromPeerId in forwarding) {
      await managers.messages.forwardMessages(peerId, +fromPeerId, forwarding[fromPeerId])
    }

    return true
  } catch(err) {
    console.error('forward failed', { peerId }, err)
    return false
  }
}

export default async function showForwardPopup(
  peerIdMids: ForwardPeerIdMids,
  _onSelect?: (peerId: PeerId) => Promise<void> | void,
): Promise<void> {
  // Синглтон и React-пикер грузятся по требованию: статический импорт тянул бы
  // `appImManager` и React-диалоги чата в каждого, кто умеет пересылать (меню,
  // лента, shared media).
  const [{ default: appImManager }, { ForwardPicker }] = await Promise.all([
    import('@lib/appImManager'),
    import('@components/messages/ChatDialogs'),
  ])
  const chatRightsActions = resolveChatRightsActions(getForwardedMessages(appImManager, peerIdMids))

  let messageCount = 0
  for(const fromPeerId in peerIdMids) {
    messageCount += peerIdMids[fromPeerId].length
  }

  // :185-227
  const processSingle = async(peerId: PeerId, openChat: boolean) => {
    if(_onSelect) {
      await _onSelect(peerId)
    }

    if(openChat) {
      await appImManager.setInnerPeer({ peerId })
      appImManager.chat.input.initMessagesForward(peerIdMids)
      return false
    }

    return sendMessageWithForward(peerId, peerIdMids)
  }

  // :350-399
  const onSelect = async(chosen: PeerId[]) => {
    const sentToPeerIds = new Set<PeerId>()
    const isSavedMessagesNoText = chosen.length === 1 && chosen[0] === rootScope.myId
    const openChat = chosen.length === 1 && !isSavedMessagesNoText
    for(const peerId of chosen) {
      const success = await processSingle(peerId, openChat)
      if(success) {
        sentToPeerIds.add(peerId)
      }
    }

    if(sentToPeerIds.size === 1 && [...sentToPeerIds][0] === rootScope.myId) {
      toastNew({
        langPackKey: messageCount > 1 ? 'FwdMessagesToSavedMessages' : 'FwdMessageToSavedMessages',
      })
    } else if(sentToPeerIds.size) {
      const peerTitles = sentToPeerIds.size <= 3 ? [...sentToPeerIds].map((peerId) => {
        const b = document.createElement('b')
        b.append(peerTitle(peerId))
        return b
      }) : []

      toastNew({
        langPackKey: messageCount === 1 ? 'FwdMessageTo' : 'FwdMessagesTo',
        langPackArguments: peerTitles.length ? [join(peerTitles)] : [i18n('FwdMessagesToChats', [sentToPeerIds.size])],
      })
    }
  }

  openPopup((p) => createElement(ForwardPickerHost, {
    ForwardPicker,
    chatRightsActions,
    onClose: p.destroy,
    onPick: (peerIds: PeerId[]) => {
      p.destroy()
      if(peerIds.length) void onSelect(peerIds)
    },
  }))
}

function ForwardPickerHost(props: {
  ForwardPicker: typeof import('@components/messages/ChatDialogs').ForwardPicker,
  chatRightsActions: ReturnType<typeof resolveChatRightsActions>,
  onPick: (peerIds: PeerId[]) => void,
  onClose: () => void,
}) {
  const dialogs = useChatsStore((st) => st.dialogs)
  return createElement(props.ForwardPicker, {
    dialogs,
    chatRightsActions: props.chatRightsActions,
    onPick: props.onPick,
    onClose: props.onClose,
  })
}

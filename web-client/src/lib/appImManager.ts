// Срез tweb `src/lib/appImManager.ts` (812502980): статус набора пира —
// `getTypingElement` `:3454-3506` и `getPeerTyping` `:3508-3675`. Класса
// `AppImManager` у нас ещё нет (этап 4 волны 7, план
// `docs/superpowers/plans/2026-09-30-wave-7-shell-sidebars.md`), а строке
// чатлиста «печатает» нужен уже сейчас (`setDialogTyping`,
// `components/autonomousDialogList/base.ts`, задача 1-4) — поэтому методы лежат
// функциями модуля на месте оригинала. Задача 5-3 переносит их в класс вместе с
// `getChatStatus`/`getUserStatus` и сносит React-двойник `core/hooks/useTypingLabel.ts`.
//
// Расхождения с оригиналом:
//  1. Набор пира — синхронно из зеркала `chatsStore.typing` (мост чтения п. 2 плана
//     волны 7), а не `appProfileManager.getPeerTypings`; срок жизни записи ведёт
//     проектор (`client/realtime/storeProjection.ts`, `TYPING_TTL`). Бот — по
//     `pFlags.bot` карточки зеркала (`appUsersManager.isBot`).
//  2. Таблица ключей — только действия, которые производит наш клиент
//     (`core/realtime/events.ts::SendMessageAction`): игры, стикеры, кружки и
//     эмодзи-интеракции (`sendMessageGamePlayAction`, `…ChooseSticker…`,
//     `…UploadRound…`, `…RecordRound…`, `sendMessageEmojiInteractionSeen`) на
//     проводе не бывают, их ключей и веток (`peer-typing-choosing-sticker`,
//     `peer-typing-flex`) нет.
//  3. Имя печатающего — узел нашего `PeerTitle` (синхронный, сам перерисуется,
//     когда карточка доедет); ему нужны зона и менеджеры — они приходят опцией.
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import type { Middleware } from '@helpers/middleware'
import { i18n, type FormatterArguments } from '@lib/langPack'
import type { LangPackKey } from '@/lang'
import type { SendMessageAction } from '@core/realtime/events'
import { cachedPeer } from '@core/peerCache'
import { isAnyChat, isUser } from '@core/peers/peerId'
import { useChatsStore } from '@stores/chatsStore'

/** tweb `:3454-3506` без веток стикера и эмодзи (расхождение 2). */
export function getTypingElement(action: SendMessageAction) {
  const el = document.createElement('span')
  let c = 'peer-typing'
  el.classList.add(c)
  el.dataset.action = action._
  switch(action._) {
    case 'sendMessageTypingAction': {
      c += '-text'
      for(let i = 0; i < 3; ++i) {
        const cc = c + '-dot'
        const dot = document.createElement('span')
        dot.className = cc + (i === 0 ? ' ' + cc + '-first' : (i === 2 ? ' ' + cc + '-last' : ''))
        el.append(dot)
      }
      break
    }

    case 'sendMessageUploadAudioAction':
    case 'sendMessageUploadDocumentAction':
    case 'sendMessageUploadVideoAction':
    case 'sendMessageUploadPhotoAction': {
      c += '-upload'
      break
    }

    case 'sendMessageRecordAudioAction':
    case 'sendMessageRecordVideoAction': {
      c += '-record'
      break
    }
  }

  el.classList.add(c)

  return el
}

type ActivityKeys = { [action in SendMessageAction['_']]: LangPackKey }

/** tweb `:3538-3595` в объёме наших действий (расхождение 2). */
const langPackKeys: { [peerType in 'private' | 'chat' | 'multi' | 'pair']: ActivityKeys } = {
  private: {
    sendMessageTypingAction: 'Peer.Activity.User.TypingText',
    sendMessageUploadAudioAction: 'Peer.Activity.User.SendingFile',
    sendMessageUploadDocumentAction: 'Peer.Activity.User.SendingFile',
    sendMessageUploadPhotoAction: 'Peer.Activity.User.SendingPhoto',
    sendMessageUploadVideoAction: 'Peer.Activity.User.SendingVideo',
    sendMessageRecordVideoAction: 'Peer.Activity.User.RecordingVideo',
    sendMessageRecordAudioAction: 'Peer.Activity.User.RecordingAudio',
  },
  chat: {
    sendMessageTypingAction: 'Peer.Activity.Chat.TypingText',
    sendMessageUploadAudioAction: 'Peer.Activity.Chat.SendingFile',
    sendMessageUploadDocumentAction: 'Peer.Activity.Chat.SendingFile',
    sendMessageUploadPhotoAction: 'Peer.Activity.Chat.SendingPhoto',
    sendMessageUploadVideoAction: 'Peer.Activity.Chat.SendingVideo',
    sendMessageRecordVideoAction: 'Peer.Activity.Chat.RecordingVideo',
    sendMessageRecordAudioAction: 'Peer.Activity.Chat.RecordingAudio',
  },
  multi: {
    sendMessageTypingAction: 'Peer.Activity.Chat.Multi.TypingText1',
    sendMessageUploadAudioAction: 'Peer.Activity.Chat.Multi.SendingFile1',
    sendMessageUploadDocumentAction: 'Peer.Activity.Chat.Multi.SendingFile1',
    sendMessageUploadPhotoAction: 'Peer.Activity.Chat.Multi.SendingPhoto1',
    sendMessageUploadVideoAction: 'Peer.Activity.Chat.Multi.SendingVideo1',
    sendMessageRecordVideoAction: 'Peer.Activity.Chat.Multi.RecordingVideo1',
    sendMessageRecordAudioAction: 'Peer.Activity.Chat.Multi.RecordingAudio1',
  },
  pair: {
    sendMessageTypingAction: 'Peer.Activity.Chat.Pair.TypingText',
    sendMessageUploadAudioAction: 'Peer.Activity.Chat.Pair.SendingFile',
    sendMessageUploadDocumentAction: 'Peer.Activity.Chat.Pair.SendingFile',
    sendMessageUploadPhotoAction: 'Peer.Activity.Chat.Pair.SendingPhoto',
    sendMessageUploadVideoAction: 'Peer.Activity.Chat.Pair.SendingVideo',
    sendMessageRecordVideoAction: 'Peer.Activity.Chat.Pair.RecordingVideo',
    sendMessageRecordAudioAction: 'Peer.Activity.Chat.Pair.RecordingAudio',
  },
}

/** Набор пира из зеркала: кто и что делает (расхождение 1). */
function getPeerTypings(peerId: PeerId) {
  const typing = useChatsStore.getState().typing[peerId]
  return typing ?
    Object.entries(typing).map(([userId, entry]) => ({ userId: +userId, action: entry.action })) :
    []
}

/**
 * tweb `:3508-3675`. Возвращает `span.online.peer-typing-container` (либо
 * переиспользует переданный `container`), если пир что-то делает и его можно
 * назвать, иначе `undefined`.
 */
export function getPeerTyping(peerId: PeerId, options: {
  container?: HTMLElement,
  middleware: Middleware,
  managers: PeerTitleManagers,
}) {
  // * asked for every dialog element that gets built, so the cheap check that
  // * answers "no" for almost every peer goes first
  const allTypings = getPeerTypings(peerId)
  if(!allTypings.length) {
    return
  }

  const isUserPeer = isUser(peerId)
  const peer = cachedPeer(peerId)
  if(isUserPeer && peer?._ === 'user' && peer.pFlags?.bot) {
    return
  }

  // * a peer that hasn't reached the mirror yet has no title to render and would be
  // * named "Deleted", so it doesn't get counted either — a private chat never names anyone
  const typings = isUserPeer ?
    allTypings :
    allTypings.filter(({ userId }) => !!cachedPeer(userId))
  if(!typings.length) {
    return
  }

  const typing = typings[0]

  // * with exactly two typings there's no point in hiding the second one behind "1 other"
  const isPair = typings.length === 2
  const mapa = isUserPeer ? langPackKeys.private : (isPair ? langPackKeys.pair : (typings.length > 1 ? langPackKeys.multi : langPackKeys.chat))
  let action = typing.action

  if(typings.length > 1) {
    const s = new Set(typings.map((typing) => typing.action._))
    if(s.size > 1) {
      action = { _: 'sendMessageTypingAction' }
    }
  }

  const langPackKey = mapa[action._]

  let args: FormatterArguments | undefined
  if(isAnyChat(peerId)) {
    args = typings.slice(0, isPair ? 2 : 1).map((typing) => new PeerTitle({
      peerId: typing.userId,
      onlyFirstName: true,
      middleware: options.middleware,
      managers: options.managers,
    }).element)
    if(!isPair) {
      args.push(typings.length - 1)
    }
  }

  let { container } = options
  if(!container) {
    container = document.createElement('span')
    container.classList.add('online', 'peer-typing-container')
  }

  let typingElement = container.firstElementChild as HTMLElement | null
  if(!typingElement) {
    typingElement = getTypingElement(action)
    container.prepend(typingElement)
  } else if(typingElement.dataset.action !== action._) {
    typingElement.replaceWith(getTypingElement(action))
  }

  const descriptionElement = i18n(langPackKey, args)
  descriptionElement.classList.add('peer-typing-description')

  if(container.childElementCount > 1) container.lastElementChild!.replaceWith(descriptionElement)
  else container.append(descriptionElement)

  return container
}

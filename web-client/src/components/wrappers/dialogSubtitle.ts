// Порт tweb `src/components/wrappers/dialogSubtitle.ts:19-204` (812502980, с
// 3f974c341) — части подзаголовка строки чатлиста: иконка пересылки, миниатюры
// медиа, автор («Вы» / имя) либо «Черновик:», и сам текст. Каждая часть — свой
// `span.dialog-subtitle-span[dir=auto]` (изоляция направления, `_chatlist.scss`
// `&-span { unicode-bidi: isolate }`), последняя — `-last`. Зовёт
// `setLastMessage` (`lib/appDialogsManager.ts`).
//
// Расхождения с оригиналом:
//  1. `isSaved` (`:21`, сохранённый диалог — строка «Избранного» с `threadId`) не
//     принимается: сохранённых диалогов строкой у нас нет (задача 1-7 волны 7,
//     `AutonomousSavedDialogList`). С ним ушло условие `!isSaved` у иконки пересылки.
//  2. Иконка `storyreply` (`:56-61`) — ответа на историю (`messageReplyStoryHeader`)
//     в нашей модели нет (`core/models.ts::MessageReplyHeader`).
//  3. `prependPeerId` и стрелка `dialog-subtitle-arrow` (`:84-148`) — имя чата
//     перед автором бывает только у строк сообществ (Communities, О-5 плана
//     волны 7); у нас его никто не передаёт.
//  4. Имя автора — узел нашего `PeerTitle` (`components/chat/peerTitle.ts`), а не
//     `wrapPeerTitle` (`:99-111`): `wrapPeerTitle` у нас не портирован, а узел
//     сам перерисуется, когда карточка пира доедет. Поэтому вместо
//     `peerTitleRenderer` приходят `titleMiddleware` и `managers` узла имени.
//  5. `textColor` (`:30`, цвет кастом-эмодзи активной строки) не передаётся —
//     рендерера кастом-эмодзи у `wrapRichText` нет; `messageRenderer` не
//     принимается — у нас один `wrapMessageForReply` (синхронный, шапка его файла).
//  6. Наш параметр `highlightWord`: подсветку запроса у нас делает сам
//     `wrapMessageForReply` (`messageEntityHighlight`), а не `highlightText`
//     поверх готовых частей (tweb f57dbcec3 не портирован, `delta/part-3.md`).
//  7. Автор поста канала: у оригинала `fromId` поста равен пиру (`:94`), у нас
//     параметра нет — сравнивается `fromId ?? peerId`.
import Icon from '@components/icon'
import PeerTitle, { type PeerTitleManagers } from '@components/chat/peerTitle'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import type { Middleware } from '@helpers/middleware'
import type middlewarePromise from '@helpers/middlewarePromise'
import type { DraftMessageReal, MyMessage } from '@core/models'
import { isAnyChat } from '@core/peers/peerId'
import { i18n } from '@lib/langPack'
import rootScope from '@lib/rootScope'

type MiddlewarePromise = ReturnType<typeof middlewarePromise>

export default async function renderDialogSubtitleParts(options: {
  peerId: PeerId,
  lastMessage?: MyMessage,
  draftMessage?: DraftMessageReal,
  noForwardIcon?: boolean,
  mediaParts?: (Promise<HTMLElement> | HTMLElement)[],
  withoutMediaType?: boolean,
  highlightWord?: string,
  middleware: MiddlewarePromise,
  titleMiddleware: Middleware,
  managers: PeerTitleManagers,
}) {
  const {
    peerId,
    lastMessage,
    draftMessage,
    noForwardIcon,
    middleware,
  } = options
  const willPrepend: (Promise<HTMLElement> | HTMLElement)[] = []

  // tweb `:47-61` — у черновика иконки нет
  if(!draftMessage && lastMessage?._ === 'message' && lastMessage.fwd_from && !noForwardIcon) {
    willPrepend.push(Icon('forward_filled', 'dialog-subtitle-ico', 'dialog-subtitle-ico-forward_filled'))
  }

  if(options.mediaParts?.length) {
    willPrepend.push(...options.mediaParts)
  }

  // tweb `:73-116` — имена, которыми открывается превью, и «Черновик:» перед текстом
  const names: HTMLElement[] = []
  let draftLabel: HTMLElement | undefined

  const fromId = lastMessage && (lastMessage.fromId ?? lastMessage.peerId)
  if(draftMessage) {
    const span = document.createElement('span')
    span.classList.add('danger')
    span.append(i18n('Draft'), ': ')
    // * not a name — it labels the message and stays right in front of it
    draftLabel = span
  } else if(
    lastMessage &&
    isAnyChat(peerId) &&
    peerId !== fromId &&
    lastMessage._ === 'message'
  ) {
    const span = document.createElement('span')
    span.classList.add('primary-text')

    if(fromId === rootScope.myId) {
      span.append(i18n('FromYou'))
    } else {
      const peerTitle = new PeerTitle({
        peerId: fromId,
        onlyFirstName: true,
        middleware: options.titleMiddleware,
        managers: options.managers,
      })
      span.prepend(peerTitle.element)
    }

    names.push(span)
    span.append(': ')
  }

  if(draftLabel) {
    names.push(draftLabel)
  }

  willPrepend.unshift(...names)

  // tweb `:154-175`
  let fragment: DocumentFragment
  if(draftMessage) {
    fragment = wrapMessageForReply({ message: draftMessage, plain: false })
  } else if(lastMessage) {
    fragment = wrapMessageForReply({
      message: lastMessage,
      withoutMediaType: options.withoutMediaType,
      highlightWord: options.highlightWord,
      plain: false,
    })
  } else {
    fragment = document.createDocumentFragment()
  }

  // `Promise.resolve` на каждой части — только под `await-thenable` линтера: у
  // оригинала в `Promise.all` уходят вперемешку узлы и промисы (`:179`)
  const resolvedPrepend: HTMLElement[] = willPrepend.length ?
    await middleware(Promise.all(willPrepend.map((part) => Promise.resolve(part)))) :
    []

  return [...resolvedPrepend, fragment].map((part, idx, parts) => {
    const span = document.createElement('span')
    span.classList.add('dialog-subtitle-span')
    // * every part isolates its own direction, so an RTL name or message reads
    // * correctly without reordering the parts around it
    span.dir = 'auto'
    if(idx === parts.length - 1) {
      span.classList.add('dialog-subtitle-span-last')
    }
    span.append(part)
    return span
  })
}

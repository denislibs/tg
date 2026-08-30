// src/core/hooks/useMessageActions.tsx
//
// Действия НАД СООБЩЕНИЕМ, у которых есть состояние: подтверждение удаления,
// пикер пересылки, «кто отреагировал», статистика поста и редактор проверки
// фактов. Вью рисует их из возвращённого стейта (`ChatMsgActionPopups`).
//
// ЕДИНСТВЕННЫЙ вызывающий — ванильное меню сообщения
// (`components/chat/contextMenu.ts`, порт tweb `ChatContextMenu`) через
// проводку `Chat.tsx` → `components/chat/VanillaFeed.tsx`, плюс плашка
// выделения и медиавьювер. Поэтому каждое действие принимает АДРЕС ЯВНО —
// `(peerId, mid[s])`, ровно в той форме, в какой его зовёт оригинал
// (`showDeleteMessages(peerId, mids)`, `showForwardPopup({[peerId]: mids})`,
// `PopupPinMessage(peerId, mid)`).
//
// Прежде здесь жило ВТОРОЕ, React-овское меню сообщения: его открывала строка
// React-ленты (`openMsgMenu(event, row)`), цель хранилась в состоянии, а пункты
// были тонкими обёртками над теми же действиями. Лента снесена (этап 7), меню
// вместе с ней — второго набора пунктов у клиента больше нет.
//
// Источник сообщения — ЗЕРКАЛО ОКНА (`core/history/messagesMirror.ts` через
// единственный мост `core/hooks/useMirrorWindow.ts`), тем же номером и тем же
// зеркалом адресует цель ванильное меню (`contextMenu.ts::getMessageByPeer`,
// порт tweb `chat.getMessageByPeer`).
import { useRef, useState } from 'react'
import { useEvent } from './useEvent'
import { useReportStore } from '../../stores/reportStore'
import { useSearchStore } from '../../stores/searchStore'

import { mediaLabel } from '../dialogToChat'
import { parseMarkdown } from '../richtext/markdown'
import { getMessageText, type FactCheck, type MyMessage } from '../models'
import { getMediaId, getMessageKind } from '../messages/messageKind'
import { useT } from '../../i18n'
import type { Chat } from '../../data'
import { useManagers } from './useManagers'
import { useMirrorWindow } from './useMirrorWindow'
import { winKey } from '../history/messagesMirror'
import { cachedPeer } from '../peerCache'
import type { ReplyState, EditState } from './useChatSend'
import { getPeerTitle, getUserTitle } from '../peers/getPeerTitle'
import { canViewReactionsList } from '../reactions/messageReactions'
import type { ReactionUser } from '../managers/messages/reactionMethods'
import { getPeerPhotoId } from '../peers/peer'

// peerId — адресат удаления: действие приходит парой «пир + номера» (её же
// передаёт ванильное меню, tweb contextMenu.ts:2056 `PopupDeleteMessages(
// peerId, mids, chatType)`).
type DelState = { peerId: number; ids: number[]; canRevoke: boolean }
// Строка объединённого списка «кто отреагировал / просмотрел». `emoji` есть
// только у реагировавшего — у просмотревшего реакции нет, и оригинал рисует его
// строку без стикера (tweb `processDialogElementForReaction`,
// `popups/reactedList.ts:49-72`: стикер добавляется только `if(reaction)`).
type ReactedRow = { name: string; photoId?: number; emoji?: string }
type ReactedState = { x: number; y: number; rows: ReactedRow[] }

interface UseMessageActionsArgs {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  /** Тред (форум-топик / комментарии) — второй сегмент ключа окна в зеркале. */
  threadRootId?: number
  meId: number | null
  setReply: (r: ReplyState) => void
  setEditing: (e: EditState) => void
  clearSelection: () => void
  onChatCreated?: (chatId: number) => void
}

export function useMessageActions({
  chat, numericChatId, isRealChat, threadRootId, meId,
  setReply, setEditing, clearSelection, onChatCreated,
}: UseMessageActionsArgs) {
  const managers = useManagers()
  // Окно чата из ЗЕРКАЛА — тот же источник, из которого цель берёт ванильное
  // меню (`contextMenu.ts::getMessageByPeer`) и из которого рисует императивная
  // лента. Мост в React ОДИН на приложение (`useMirrorWindow`), поэтому пункты
  // пересобираются на каждое изменение окна: пока меню открыто, сообщение может
  // быть отредактировано, а его реакции — измениться.
  const winMsgs = useMirrorWindow(isRealChat ? winKey(numericChatId, threadRootId) : null)
  const t = useT()
  // Оверлей «Статистика поста» (канал, админ): открывается из меню, id поста.
  const [postStats, setPostStats] = useState<{ msgId: number } | null>(null)
  // Редактор «проверки фактов» (канал, автор/админ): id сообщения + текущее значение.
  const [factCheckEdit, setFactCheckEdit] = useState<{ msgId: number; initial?: FactCheck } | null>(null)
  const [delIds, setDelIds] = useState<DelState | null>(null)
  const [forwardIds, setForwardIds] = useState<number[] | null>(null)
  // Источник пересылаемых сообщений (null = текущий чат). Для «Переслать в другой
  // чат» из плашки форварда источник — исходный чат, а не открытый сейчас.
  const forwardSourceRef = useRef<number | null>(null)
  // Готовое превью плашки (кросс-чат форвард): исходных сообщений нет в текущем
  // сторе, поэтому превью переносим снимком, а не пересобираем из msgs.
  const forwardPreviewRef = useRef<{ count: number; text: string; hasCaption: boolean } | null>(null)
  const [reacted, setReacted] = useState<ReactedState | null>(null)

  // Правка по ЯВНОМУ номеру — форма tweb `chat.input.initMessageEditing(mid)`
  // (contextMenu.ts:1912). Текст и сущности достаём из окна сами: композеру
  // нужен исходник, а не только адрес.
  const startEditFor = (mid: number) => {
    const raw = winMsgs.find((m) => m.id === mid)
    if (!raw) return
    // Composer prefills its draft + focuses when `editing` becomes set.
    setEditing({ msgId: raw.id, text: getMessageText(raw), entities: raw._ === 'message' ? raw.entities : undefined })
    setReply(null)
  }

  // "Delete for everyone" is offered when every target is the author's own or the
  // chat is private (Telegram). Backend re-checks; group admins handled server-side.
  const canRevokeAll = (ids: number[]) =>
    chat.type === 'private' || ids.every((id) => winMsgs.find((m) => m.id === id)?.fromId === meId)
  // Подтверждение удаления по ЯВНОЙ паре «пир + номера»: так его зовут плашка
  // выделения, медиавьювер и ванильное меню (tweb contextMenu.ts:2056).
  const openDeleteFor = (peerId: number, ids: number[]) =>
    setDelIds({ peerId, ids, canRevoke: canRevokeAll(ids) })
  const doDelete = (revoke: boolean) => {
    if (!delIds || !isRealChat) return setDelIds(null)
    // deleteMessage после успеха REST удаляет из SSOT воркера и публикует
    // операцию `remove`; веер владельца автора НЕ исключает, поэтому бабл
    // уходит из зеркала и в ЭТОЙ вкладке (пин —
    // `core/history/messagesMirror.test.ts`). Второй, main-side вставки здесь
    // больше нет: окно правят только операции.
    const peerId = delIds.peerId
    for (const id of delIds.ids) {
      void managers.messages.deleteMessage(peerId, id, revoke)
    }
    setDelIds(null)
    clearSelection()
  }

  // «Пожаловаться» на сообщение (tweb reportMessages): открывает глобальный
  // ReportPopup через reportStore (цель — чат + id сообщения).
  // Явная пара «пир + номера» — форма tweb `showMessageReport(peerId, mids)`
  // (contextMenu.ts:1216-1220), которой пользуется ванильное меню. Наш
  // ReportPopup адресует ОДНО сообщение (`ReportTarget.msgId`), поэтому из
  // набора берётся первое: жалобы на пачку у нас нет.
  const openReportFor = (peerId: number, mids: number[]) => {
    if (!isRealChat || !mids.length) return
    useReportStore.getState().open({ peerId, msgId: mids[0] })
  }

  // Пикер пересылки по ЯВНОЙ паре «пир-источник + номера» — форма tweb
  // `showForwardPopup({[peerId]: mids})` (contextMenu.ts:2028). Источник кладём
  // в реф, откуда его читает doForward; превью там же считается лениво.
  const openForwardFor = (peerId: number, ids: number[]) => {
    forwardSourceRef.current = peerId
    forwardPreviewRef.current = null
    setForwardIds(ids)
  }
  // «Переслать в другой чат» из плашки форварда: источник и превью переносим явно
  // (мы не в исходном чате, его сообщений нет в текущем msgs).
  const openForwardFrom = (sourceChatId: number, ids: number[], preview: { count: number; text: string; hasCaption: boolean }) => {
    forwardSourceRef.current = sourceChatId
    forwardPreviewRef.current = preview
    setForwardIds(ids)
  }
  // Метка отправителя для превью плашки форварда — порт `initMessagesForward`
  // (tweb input.ts:4471-4505): вопрос задаётся САМОМУ сообщению, а имя берётся
  // из карточки пира (`PeerTitle`), а не из вью-модельного ряда ленты. «Вы» —
  // когда автор это я (tweb: `peerId === rootScope.myId`, :4500); скрытая
  // атрибуция пересылки (`from_name` без `from_id`) — вместо имени (:4473-4476).
  const fwdSenderLabel = (m: MyMessage): string => {
    if (m.fromId != null && m.fromId === meId) return t('FromYou')
    const hidden = m._ === 'message' ? m.fwd_from?.from_name : undefined
    if (hidden && m.fromId == null) return hidden
    const title = m.fromId != null ? getPeerTitle({ peerId: m.fromId, peer: cachedPeer(m.fromId) }) : ''
    return title || hidden || chat.name
  }
  // Превью плашки форварда (tweb setTopInfo forward): «Отправитель: текст» для
  // одного сообщения, иначе «Переслано от: имена». Строится из окна зеркала.
  const buildForwardPreview = (ids: number[]) => {
    const picked = ids.map((id) => winMsgs.find((m) => m.id === id)).filter((m): m is MyMessage => !!m)
    const count = ids.length
    const senders = [...new Set(picked.map(fwdSenderLabel))]
    let text: string
    if (count === 1 && picked[0]) {
      const m = picked[0]
      const body = getMessageText(m) || mediaLabel(getMessageKind(m)) || ''
      text = body ? `${senders[0]}: ${body}` : senders[0]
    } else {
      const names = senders.length <= 2 ? senders.join(', ') : `${senders.slice(0, 2).join(', ')} …`
      text = `${t('Chat.ForwardedFrom')}: ${names}`
    }
    // tweb messagesWithCaptionsLength (:4477-4486) — вложение + подпись.
    const hasCaption = picked.some((m) => getMediaId(m) != null && !!getMessageText(m))
    return { count, text, hasCaption }
  }
  // Выбор адресата(ов) в пикере. Один чат → tweb-флоу: открываем чат и показываем
  // плашку форварда в композере (финализация по «Отправить»). Несколько → шлём
  // сразу во все с параметрами по умолчанию (составить коммент в N чатах нельзя).
  const doForward = async (chatIds: number[]) => {
    const ids = forwardIds
    const source = forwardSourceRef.current ?? numericChatId
    const previewSnap = forwardPreviewRef.current
    setForwardIds(null)
    forwardSourceRef.current = null
    forwardPreviewRef.current = null
    if (!ids?.length || !isRealChat || !chatIds.length) return
    if (chatIds.length === 1) {
      const targetPeerId = chatIds[0]
      const preview = previewSnap ?? buildForwardPreview(ids)
      useSearchStore.getState().setPendingForward({
        targetPeerId, sourcePeerId: source, msgIds: ids,
        count: preview.count, text: preview.text, hasCaption: preview.hasCaption,
      })
      clearSelection()
      onChatCreated?.(targetPeerId)
      return
    }
    let lastOk: number | null = null
    for (const toChatId of chatIds) {
      try {
        await managers.messages.forwardMessages(toChatId, source, ids)
        lastOk = toChatId
      } catch (err) {
        console.error('forward failed', { toChatId }, err)
      }
    }
    clearSelection()
    if (lastOk != null) onChatCreated?.(lastOk)
  }

  // Явная тройка — форма tweb `PopupPinMessage(peerId, mid)` / `(…, true)`
  // (contextMenu.ts:1994-2000): «закрепить» и «открепить» там ДВА пункта с
  // разными обработчиками, поэтому направление приезжает аргументом, а не
  // выводится из `pins` — своего списка закреплённых у ванильного меню нет.
  const pinMessage = (peerId: number, mid: number, unpin?: boolean) => {
    if (!isRealChat) return
    void (unpin ? managers.messages.unpin(peerId, mid) : managers.messages.pin(peerId, mid))
  }

  // Download the original media bytes (the context-menu "Загрузить" action). The
  // content endpoint is same-origin, so the <a download> forces a save.
  // Токен-URL сознательно (Task 7): это БАЙТОВОЕ скачивание файла браузером,
  // категория «МОЖНО: bytes прямым fetch», не картинка для <img>.
  // Скачивание по ЯВНОМУ адресу вложения — сюда же приходит пункт «Download»
  // ванильного меню (tweb `appDownloadManager.downloadToDisc({media})`,
  // contextMenu.ts:2189).
  const downloadMedia = async (mediaId: number) => {
    const [meta, url] = await Promise.all([
      managers.media.meta(mediaId),
      managers.media.contentUrl(mediaId),
    ])
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName || `media-${mediaId}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // Кто отреагировал И кто просмотрел — ОДИН список. Открывается и по пункту
  // `views` меню сообщения («Seen by N» / «Reacted N»), и long-press'ом по чипу
  // реакции; тап по чипу остаётся тогглом своей реакции.
  //
  // Порт `getMessageReactionsListAndReadParticipants`
  // (tweb `lib/appManagers/appMessagesManager.ts:9037-9088`) — у оригинала это
  // ОДИН ответ на оба списка, и из него же кормится единственный список
  // `PopupReactedList` (`popups/reactedList.ts:221-224`) и подпись пункта меню
  // (`components/chat/contextMenu.ts:1586`). Второго списка заводить нельзя.
  const showReactedUsers = useEvent(async (msgId: number, x: number, y: number) => {
    if (!isRealChat) return
    const raw = winMsgs.find((m) => m.id === msgId)
    if (!raw || raw.id < 0) return
    // Оба запроса уходят ПАРАЛЛЕЛЬНО одним `Promise.all` (tweb :9053-9057), и
    // упавший список просмотревших даёт пустой вектор, а не рушит весь попап
    // (`.catch(() => [])` там же).
    // СПИСОК реагировавших запрашивается, только если зритель ВПРАВЕ его
    // видеть: у оригинала ровно этот терм гейтит вызов
    // `getMessageReactionsList` (tweb `chat/reactionContextMenu.ts:95,99-106` —
    // `canViewList ? managers.appReactionsManager.getMessageReactionsList(...)
    // : undefined`). Право звучит один раз на весь клиент
    // (`canViewReactionsList`, `core/reactions/messageReactions.ts`) — тем же
    // термом чип решает, показывать аватарки или число.
    //
    // Без права остаётся ВТОРАЯ половина того же списка — просмотревшие: попап
    // у нас один на оба (порт `PopupReactedList`), и «реакции видеть нельзя» не
    // значит «просмотры видеть нельзя».
    const [users, viewerIds] = await Promise.all([
      canViewReactionsList(raw.reactions, raw.peerId)
        ? managers.messages.reactionUsers(numericChatId, msgId)
        : Promise.resolve([] as ReactionUser[]),
      managers.messages.viewers(numericChatId, msgId).catch(() => [] as number[]),
    ])
    // Просмотревший, который УЖЕ отреагировал, из второго списка вычёркивается —
    // одна строка на человека (tweb :9058-9063, `forEachReverse` + `splice`).
    const reactedIds = new Set(users.map((u) => u.user.id))
    const onlyViewers = viewerIds.filter((id) => !reactedIds.has(id))
    // Ручка просмотревших отдаёт только КЛЮЧИ (вектор `readParticipantDate`),
    // как и `messages.getMessageReadParticipants` у оригинала (:9089-9098):
    // имя и аватарку строка достаёт сама (`addDialogNew({peerId})`,
    // `reactedList.ts:225-235`) — у нас это карточки из воркера.
    const viewerCards = onlyViewers.length ? await managers.peers.getUsers(onlyViewers) : []
    // Порядок ленты — реагировавшие, следом просмотревшие (tweb :9065-9080:
    // `combined` строится из реакций и КОНКАТЕНИРУЕТСЯ отфильтрованными
    // просмотревшими). Имя и аватарка живут в КАРТОЧКЕ, а не плоскими полями.
    const rows: ReactedRow[] = [
      ...users.map((u) => ({ name: getUserTitle(u.user), photoId: getPeerPhotoId(u.user.photo) || undefined, emoji: u.emoji })),
      ...viewerCards.map((u) => ({ name: getUserTitle(u), photoId: getPeerPhotoId(u.photo) || undefined })),
    ]
    setReacted({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), rows })
  })

  // Явная пара — форма tweb «таб `AppStatisticsTab` правой колонки»
  // (contextMenu.ts:2108-2112). Оверлей `PostStats` смонтирован на ОТКРЫТЫЙ чат
  // (`ChatMsgActionPopups` отдаёт ему `chatId={numericChatId}`), поэтому пир
  // сверяется, а не запоминается: с чужим адресом открылся бы не тот пост.
  const openPostStatsFor = (peerId: number, mid: number) => {
    if (peerId !== numericChatId) return
    setPostStats({ msgId: mid })
  }

  // Явная пара — форма tweb `onEditFactCheckClick` (contextMenu.ts:1916-1992).
  // Сохраняет редактор через `submitFactCheck`, а тот адресует открытый чат —
  // поэтому пир сверяется, как и у статистики.
  const openFactCheckEditorFor = (peerId: number, mid: number) => {
    if (!isRealChat || peerId !== numericChatId) return
    const raw = winMsgs.find((m) => m.id === mid)
    if (!raw) return
    setFactCheckEdit({ msgId: raw.id, initial: raw._ === 'message' ? raw.factcheck : undefined })
  }
  // Сохранить проверку: разбор markdown (сущности как при отправке), REST + оптимистичный патч стора.
  const submitFactCheck = async (text: string, country: string) => {
    const edit = factCheckEdit
    setFactCheckEdit(null)
    if (!edit || !isRealChat) return
    const parsed = parseMarkdown(text)
    if (!parsed.text.trim()) return
    // Окно правит ВЛАДЕЛЕЦ: `messages.setFactCheck` объявляет `patch {factcheck}`
    // СРАЗУ, до ответа сервера, и откатывает его на упавшей сети
    // (`core/managers/messagesManager.ts::setFactCheck`), а следом ту же правку
    // приносит кадр `factcheck_update` → `cacheFactCheck`. Долг этапа 7
    // («оптимистики здесь больше нет») закрыт там, а не здесь: своей копии окна
    // у вью нет и заводить её нельзя. Ошибку глотаем — откат уже объявлен.
    await managers.messages.setFactCheck(numericChatId, edit.msgId, parsed.text, parsed.entities, country || undefined).catch(() => null)
  }

  return {
    showReactedUsers,
    postStats, closePostStats: () => setPostStats(null),
    factCheckEdit, submitFactCheck, closeFactCheckEditor: () => setFactCheckEdit(null),
    delIds, doDelete, closeDelete: () => setDelIds(null), openDeleteFor, canRevokeAll,
    forwardIds, doForward, closeForward: () => setForwardIds(null), openForwardFor, openForwardFrom,
    // Действия с ЯВНЫМ адресом — их зовёт ванильное меню (см. шапку файла).
    pinMessage, openReportFor, openPostStatsFor, openFactCheckEditorFor, startEditFor, downloadMedia,
    reacted, closeReacted: () => setReacted(null),
  }
}

// src/core/hooks/useMessageActions.tsx
//
// The message context menu + everything it triggers: reply / edit / copy / pin /
// delete / forward / select / download / "seen by". Owns the menu anchor plus the
// delete-confirm, forward-picker and viewers-popup state, and builds the menu item
// list (gated by chat kind and the target message). The View renders the menu /
// dialogs from the returned state and wires the feed's context-menu open to
// `openMsgMenu`.
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import TgIcon from '../../components/TgIcon'
import { convMsgReplyState } from '../draftReply'
import { useEvent } from './useEvent'
import { useReportStore } from '../../stores/reportStore'
import { useSearchStore } from '../../stores/searchStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useReactionEffectStore } from '../../stores/reactionEffectStore'

// tweb getLimit('reactions') → appConfig reactions_user_max_default/premium:
// сколько РАЗНЫХ своих реакций помещается на одном сообщении.
const REACTIONS_USER_MAX_DEFAULT = 1
const REACTIONS_USER_MAX_PREMIUM = 3
import { mediaLabel } from '../dialogToChat'
import { useSettingsStore } from '../../settings'
import rootScope from '@lib/rootScope'
import { getDocumentFromMessage } from '../media/messageMedia'
import { buildMessageLink } from '../messageLink'
import { parseMarkdown } from '../richtext/markdown'
import { getReplyToMsgId, getThreadRootId, type FactCheck } from '../models'
import { getMediaId, getMessageKind, type MessageKind } from '../messages/messageKind'
import { getServerMessageId } from '../history/messageId'
import { friendlyMsgTime } from '../format/friendlyTime'
import { useT, useLang } from '../../i18n'
import type { Chat, ConvMsg } from '../../data'
import { useManagers } from './useManagers'
import type { MessageWindow } from './useMessageWindow'
import type { ReplyState, EditState } from './useChatSend'
import { getUserTitle } from '../peers/getPeerTitle'
import { getPeerPhotoId } from '../peers/peer'

// closing — меню играет exit-анимацию ui-kit Menu; из стейта убирается только
// по onExitComplete (destroyMsgMenu), иначе размонтирование срезало бы анимацию.
type MsgMenu = { x: number; y: number; idx: number; originX: 'left' | 'right'; originY: 'top' | 'bottom'; closing?: boolean }
type DelState = { ids: number[]; canRevoke: boolean }
type ViewersState = { x: number; y: number; names: string[] }
type ReactedRow = { name: string; photoId?: number; emoji: string }
type ReactedState = { x: number; y: number; rows: ReactedRow[] }
// Read-date исходящего сообщения (приватный чат, tweb getOutboxReadDate):
// лениво подгружается при открытии меню. null — строку не показываем.
type ReadDateState = { state: 'loading' } | { state: 'done'; at: string } | { state: 'restricted' }
// label — ReactNode: у пункта read-date это скелетон-лоадер / кластер
// «Read show when», а не строка (tweb кладёт в textElement узлы).
// separatorDown — `hr` после пункта (tweb ButtonMenu separatorDown).
export type MsgMenuItem = { icon: ReactNode; label: ReactNode; danger?: boolean; separatorDown?: boolean; onClick?: (e: React.MouseEvent) => void }

interface UseMessageActionsArgs {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  // Пост канала + текущий пользователь — админ/владелец: показывать «Статистику».
  canViewPostStats?: boolean
  // Канал + зритель автор/админ: показывать пункты «проверки фактов» (tweb canUpdateFactCheck).
  canEditFactCheck?: boolean
  win: MessageWindow
  msgs: ConvMsg[]
  meId: number | null
  pins: { id?: number }[]
  accent: string
  setReply: (r: ReplyState) => void
  setEditing: (e: EditState) => void
  setSelectionMode: (v: boolean) => void
  setSelected: (s: Set<number>) => void
  clearSelection: () => void
  onChatCreated?: (chatId: number) => void
}

export function useMessageActions({
  chat, numericChatId, isRealChat, canViewPostStats, canEditFactCheck, win, msgs, meId, pins, accent,
  setReply, setEditing, setSelectionMode, setSelected, clearSelection, onChatCreated,
}: UseMessageActionsArgs) {
  const managers = useManagers()
  const t = useT()
  const [lang] = useLang()
  const [msgMenu, setMsgMenu] = useState<MsgMenu | null>(null)
  // Read-date подгружаем при открытии меню; reqRef отсекает ответ прошлого меню.
  const [readDate, setReadDate] = useState<ReadDateState | null>(null)
  const readDateReqRef = useRef(0)
  // Оверлей «Статистика поста» (канал, админ): открывается из меню, id поста.
  const [postStats, setPostStats] = useState<{ msgId: number } | null>(null)
  // Редактор «проверки фактов» (канал, автор/админ): id сообщения + текущее значение.
  const [factCheckEdit, setFactCheckEdit] = useState<{ msgId: number; initial?: FactCheck } | null>(null)
  // Ответ с цитатой: текст, выделенный внутри сообщения на момент открытия меню
  // (right-click сохраняет выделение), плюс его offset (UTF-16) в тексте сообщения.
  // Используется startReply; сбрасывается, если выделения не было.
  const pendingQuoteRef = useRef<{ text: string; offset: number } | null>(null)
  const [delIds, setDelIds] = useState<DelState | null>(null)
  const [forwardIds, setForwardIds] = useState<number[] | null>(null)
  // Источник пересылаемых сообщений (null = текущий чат). Для «Переслать в другой
  // чат» из плашки форварда источник — исходный чат, а не открытый сейчас.
  const forwardSourceRef = useRef<number | null>(null)
  // Готовое превью плашки (кросс-чат форвард): исходных сообщений нет в текущем
  // сторе, поэтому превью переносим снимком, а не пересобираем из msgs.
  const forwardPreviewRef = useRef<{ count: number; text: string; hasCaption: boolean } | null>(null)
  // «Ответить в другом чате» (tweb ReplyToAnotherChat): снимок оригинала ждёт
  // выбора целевого чата в пикере. null — пикер закрыт.
  const [replyAnother, setReplyAnother] = useState<{ msgId: number; name: string; text: string; color: string } | null>(null)
  const [viewers, setViewers] = useState<ViewersState | null>(null)
  const [reacted, setReacted] = useState<ReactedState | null>(null)
  // Платная ⭐-реакция: открытый попап выбора количества звёзд (msgId цели).
  const [starReact, setStarReact] = useState<{ msgId: number } | null>(null)
  const [translateText, setTranslateText] = useState<string | null>(null)
  const showTranslate = useSettingsStore((st) => st.showTranslateButton)
  // Секретный чат: скрываем forward/copy/quote (поведение Telegram) — остаётся
  // обычный reply, удаление и реакции.
  const isSecret = chat.type === 'secret'

  // Takes the message itself (not its index) so MessageRow needs no `index` prop —
  // that prop shifts on every loadOlder prepend and would re-render every row. We
  // resolve the index here, at click time, against the current msgs.
  const openMsgMenu = useEvent((e: React.MouseEvent, m: ConvMsg) => {
    e.preventDefault()
    // Сводный ConvMsg альбома синтезируется в ChatFeed и в msgs отсутствует —
    // ищем по id (меню действует на первый элемент группы).
    let idx = msgs.indexOf(m)
    if (idx < 0 && m.id != null) idx = msgs.findIndex((x) => x.id === m.id)
    if (idx < 0) return
    // Захватываем выделенный фрагмент этого сообщения для «ответа с цитатой»
    // (best-effort: текст выделения + его offset как indexOf в тексте сообщения).
    pendingQuoteRef.current = null
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && m.text) {
      const s = sel.toString().trim()
      const at = s ? m.text.indexOf(s) : -1
      if (s && at >= 0 && s !== m.text) pendingQuoteRef.current = { text: s, offset: at }
    }
    // Anchor a corner of the menu at the click point and grow from there (tweb):
    // flip to the left/upward when near the right/bottom edge so it stays on-screen.
    const MW = 256, MH = 440
    const openLeft = e.clientX + MW > window.innerWidth
    const openUp = e.clientY + MH > window.innerHeight
    setMsgMenu({ x: e.clientX, y: e.clientY, idx, originX: openLeft ? 'right' : 'left', originY: openUp ? 'bottom' : 'top' })

    // «Прочитано в HH:MM» для исходящего сообщения приватного чата (tweb
    // getOutboxReadDate): ленивая подгрузка при открытии меню.
    const req = ++readDateReqRef.current
    setReadDate(null)
    const rawId = win.msgs[idx]?.id
    if (isRealChat && chat.type === 'private' && m.out && rawId != null && rawId > 0) {
      setReadDate({ state: 'loading' })
      void managers.chats.getReadDate(numericChatId, rawId).then((res) => {
        if (req !== readDateReqRef.current) return // открыли другое меню — игнор
        if (!res) setReadDate(null)
        else if ('restricted' in res) setReadDate({ state: 'restricted' })
        else setReadDate({ state: 'done', at: res.readAt })
      }).catch(() => { if (req === readDateReqRef.current) setReadDate(null) })
    }
  })

  // Закрытие в два шага: closing=true запускает exit-анимацию ui-kit Menu,
  // окончательное снятие стейта — по onExitComplete (destroyMsgMenu).
  const closeMsgMenu = () => setMsgMenu((m) => (m ? { ...m, closing: true } : m))
  const destroyMsgMenu = () => setMsgMenu(null)

  // The selected message's raw window entry (real id/seq) for actions.
  const menuRawMsg = () => (msgMenu && isRealChat ? win.msgs[msgMenu.idx] : undefined)
  // Вид и адрес вложения СПРАШИВАЮТСЯ у модели (`core/messages/messageKind.ts`),
  // а не читаются полями `type`/`media_id`: обоих на проводе больше нет.
  const menuRawMsgKind = () => { const r = menuRawMsg(); return r ? getMessageKind(r) : undefined }
  const getMenuMediaId = () => { const r = menuRawMsg(); return r ? getMediaId(r) : undefined }
  const menuRawFactCheck = () => { const r = menuRawMsg(); return r?._ === 'message' ? r.factcheck : undefined }
  /** Вид вью-модельной строки → `MessageKind` для таблицы лейблов. Совпадают
   *  везде, кроме синтетических рядов ленты (`date`, `album`), которых у самого
   *  сообщения нет. */
  const convKindLabel = (t: ConvMsg['type']): MessageKind | undefined =>
    t === 'date' ? undefined : t === 'album' ? 'photo' : t

  const startReply = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    const rs = m ? convMsgReplyState(m, menuRawMsg()?.id, chat.name, accent, { meId: meId ?? undefined, peerId: Number(chat.id) }) : null
    if (rs) {
      setReply({ ...rs, quote: pendingQuoteRef.current ?? undefined })
      setEditing(null)
      // Composer focuses itself when `reply` becomes set.
    }
    closeMsgMenu()
  }

  // «Ответить в другом чате» (tweb ReplyToAnotherChat): снимаем превью оригинала
  // (имя автора + текст/медиа-лейбл) и открываем пикер целевого чата.
  const startReplyAnother = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    const raw = menuRawMsg()
    const rs = m ? convMsgReplyState(m, raw?.id, chat.name, accent, { meId: meId ?? undefined, peerId: Number(chat.id) }) : null
    if (rs && raw?.id != null) {
      setReplyAnother({ msgId: raw.id, name: rs.name, text: rs.text || mediaLabel(convKindLabel(m!.type)), color: rs.color })
    }
    closeMsgMenu()
  }
  // Выбран целевой чат: кладём pending-reply в стор и переключаемся туда —
  // Chat на маунте поставит reply-плашку с исходным чатом + снимком.
  const pickReplyAnotherChat = (targetPeerId: PeerId) => {
    const r = replyAnother
    setReplyAnother(null)
    if (!r || !isRealChat) return
    useSearchStore.getState().setPendingReply({
      targetPeerId, sourcePeerId: numericChatId, msgId: r.msgId, name: r.name, text: r.text, color: r.color,
    })
    onChatCreated?.(targetPeerId)
  }

  const startEdit = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    const raw = menuRawMsg()
    if (m && raw?.id != null) {
      setEditing({ msgId: raw.id, text: m.text ?? '', entities: raw._ === 'message' ? raw.entities : undefined })
      setReply(null)
      // Composer prefills its draft + focuses when `editing` becomes set.
    }
    closeMsgMenu()
  }

  const copyMsg = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m?.text) void navigator.clipboard?.writeText(m.text).catch(() => {})
    closeMsgMenu()
  }

  // «Copy Media» — картинка сообщения в буфер обмена. Буфер принимает только
  // image/png, поэтому не-png (webp/jpeg с бэка) перерисовываем канвасом.
  // ClipboardItem принимает Promise<Blob>, а сам `write` обязан стартовать в
  // задаче клика — иначе Chrome снимает разрешение как «не жест пользователя»
  // (та же механика, что у tweb в popups/myQrCode.tsx). Поэтому байты грузим
  // ВНУТРИ промиса, а не до вызова write.
  const copyMedia = () => {
    const raw = menuRawMsg()
    const mediaId = raw ? getMediaId(raw) : undefined
    closeMsgMenu()
    if (mediaId == null || !navigator.clipboard?.write) return

    const png = (async (): Promise<Blob> => {
      const url = await managers.media.contentUrl(mediaId)
      const blob = await fetch(url).then((r) => r.blob())
      if (blob.type === 'image/png') return blob

      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      bitmap.close?.()
      const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!converted) throw new Error('copyMedia: canvas.toBlob вернул null')
      return converted
    })()

    void navigator.clipboard
      .write([new ClipboardItem({ 'image/png': png })])
      .then(() => rootScope.dispatchEvent('ui:toast', t('Image copied to clipboard')))
      .catch(() => rootScope.dispatchEvent('ui:toast', t('Could not copy the image')))
  }

  // «Copy Message Link» — ссылка на конкретный пост (tweb
  // MessageContext.CopyMessageLink1, только в каналах). Формат и разбор — в
  // core/messageLink.ts; открывается нашим же клиентом через хэш навигации.
  const copyMsgLink = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw == null) return
    const link = buildMessageLink({
      origin: location.origin,
      pathname: location.pathname,
      peerId: numericChatId,
      username: chat.username,
      seq: getServerMessageId(raw.id),
    })
    void navigator.clipboard
      ?.writeText(link)
      .then(() => rootScope.dispatchEvent('ui:toast', t('Link copied to clipboard')))
      .catch(() => {})
  }

  const startTranslate = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m?.text) setTranslateText(m.text)
    closeMsgMenu()
  }

  // "Delete for everyone" is offered when every target is the author's own or the
  // chat is private (Telegram). Backend re-checks; group admins handled server-side.
  const canRevokeAll = (ids: number[]) =>
    chat.type === 'private' || ids.every((id) => win.msgs.find((m) => m.id === id)?.fromId === meId)
  const openDelete = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setDelIds({ ids: [raw.id], canRevoke: canRevokeAll([raw.id]) })
    closeMsgMenu()
  }
  // Open the delete-confirm for an arbitrary id set (the selection bar's bulk delete).
  const openDeleteFor = (ids: number[]) => setDelIds({ ids, canRevoke: canRevokeAll(ids) })
  const doDelete = (revoke: boolean) => {
    if (!delIds || !isRealChat) return setDelIds(null)
    // deleteMessage после успеха REST удаляет из SSOT воркера; main-стор убираем
    // здесь (applyDelete), а WS delete_message затем реконсилит (идемпотентно).
    const store = useMessagesStore.getState()
    for (const id of delIds.ids) {
      void managers.messages.deleteMessage(numericChatId, id, revoke).then(() => store.applyDelete(numericChatId, id))
    }
    setDelIds(null)
    clearSelection()
  }

  // «Пожаловаться» на сообщение (tweb reportMessages): открывает глобальный
  // ReportPopup через reportStore (цель — чат + id сообщения).
  const openReport = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id != null && isRealChat) useReportStore.getState().open({ peerId: numericChatId, msgId: raw.id })
  }

  const openForward = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) { forwardSourceRef.current = null; forwardPreviewRef.current = null; setForwardIds([raw.id]) }
    closeMsgMenu()
  }
  // Open the forward picker for an arbitrary id set (the selection bar's bulk forward).
  const openForwardFor = (ids: number[]) => { forwardSourceRef.current = null; forwardPreviewRef.current = null; setForwardIds(ids) }
  // «Переслать в другой чат» из плашки форварда: источник и превью переносим явно
  // (мы не в исходном чате, его сообщений нет в текущем msgs).
  const openForwardFrom = (sourceChatId: number, ids: number[], preview: { count: number; text: string; hasCaption: boolean }) => {
    forwardSourceRef.current = sourceChatId
    forwardPreviewRef.current = preview
    setForwardIds(ids)
  }
  // Метка отправителя для превью плашки форварда (tweb senderTitles): «Вы» для
  // своих, иначе имя автора / скрытая атрибуция форварда / имя чата-источника.
  const fwdSenderLabel = (m: ConvMsg): string => (m.out ? t('You') : (m.sender ?? m.forwardFrom?.name ?? chat.name))
  // Превью плашки форварда (tweb setTopInfo forward): «Отправитель: текст» для
  // одного сообщения, иначе «Переслано от: имена». Строится из текущего msgs.
  const buildForwardPreview = (ids: number[]) => {
    const picked = ids.map((id) => msgs.find((m) => m.id === id)).filter((m): m is ConvMsg => !!m)
    const count = ids.length
    const senders = [...new Set(picked.map(fwdSenderLabel))]
    let text: string
    if (count === 1 && picked[0]) {
      const m = picked[0]
      const body = m.text || mediaLabel(convKindLabel(m.type)) || ''
      text = body ? `${senders[0]}: ${body}` : senders[0]
    } else {
      const names = senders.length <= 2 ? senders.join(', ') : `${senders.slice(0, 2).join(', ')} …`
      text = `${t('Forwarded from')}: ${names}`
    }
    const hasCaption = picked.some((m) => m.mediaId != null && !!m.text)
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

  // Enter selection mode from the context menu, pre-selecting that message.
  const startSelect = () => {
    const raw = menuRawMsg()
    setSelectionMode(true)
    if (raw?.id != null) setSelected(new Set([raw.id]))
    closeMsgMenu()
  }

  const togglePin = () => {
    const raw = menuRawMsg()
    if (raw?.id != null && isRealChat) {
      const pinned = pins.some((p) => p.id === raw.id)
      void (pinned ? managers.messages.unpin(numericChatId, raw.id) : managers.messages.pin(numericChatId, raw.id))
    }
    closeMsgMenu()
  }

  // Download the original media bytes (the context-menu "Загрузить" action). The
  // content endpoint is same-origin, so the <a download> forces a save.
  // Токен-URL сознательно (Task 7): это БАЙТОВОЕ скачивание файла браузером,
  // категория «МОЖНО: bytes прямым fetch», не картинка для <img>.
  const downloadMsg = async () => {
    const mediaId = getMenuMediaId()
    closeMsgMenu()
    if (mediaId == null) return
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

  // «Сохранить GIF» для гифок (tweb: `doc.type === 'gif'`):
  // POST /gifs/saved — гиф появляется во вкладке GIF пикера (лимит 200 LIFO на бэке).
  const saveGifFromMsg = () => {
    const mediaId = getMenuMediaId()
    closeMsgMenu()
    if (mediaId == null) return
    void managers.stickers.saveGif(mediaId)
      .then(() => rootScope.dispatchEvent('ui:toast', t('GIF saved to your GIFs.')))
      .catch(() => {})
  }

  const showViewers = async (e: React.MouseEvent) => {
    const raw = menuRawMsg()
    const x = e.clientX, y = e.clientY
    closeMsgMenu()
    if (raw?.id == null || !isRealChat) return
    const ids = await managers.messages.viewers(numericChatId, raw.id)
    const users = ids.length ? await managers.peers.getUsers(ids) : []
    const byId = new Map(users.map((u) => [u.id, u]))
    // Имя собирает клиент; фолбэк оригинала («Удалённый аккаунт») внутри
    // `getUserTitle`, поэтому `ID N` больше не нужен.
    const names = ids.map((id) => getUserTitle(byId.get(id)))
    setViewers({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), names })
  }

  // Тоггл реакции (клик по чипу / полоске эмодзи в меню). Оптимистику применяет
  // воркер (tweb-модель, SSOT): react/unreact правят кэш и бродкастят эхо ДО сети —
  // storeProjection единственный писатель стора, кросс-таб бесплатно.
  //
  // Число СВОИХ реакций на одном сообщении ограничено (tweb getLimit('reactions')
  // → reactions_user_max_default/premium): у обычного аккаунта — одна, у premium —
  // до трёх. Ставя новую сверх лимита, tweb молча снимает самые старые
  // (appReactionsManager.sendReaction: unsetReactions), а не копит их.
  const toggleReaction = useEvent((msgId: number, emoji: string) => {
    if (!isRealChat) return
    const raw = win.msgs.find((m) => m.id === msgId)
    if (!raw || raw.id < 0) return // оптимистичный бабл ещё без серверного id
    const mine = raw.reactions?.find((r) => r.emoji === emoji)?.mine
    // Оптимистика в main-сторе (tweb sendReaction — мгновенно, ДО сети): дельта
    // ±1; серверное эхо reaction (с counts) реконсилит абсолютно, на ошибке сети —
    // откат обратной дельтой. Раньше это делал worker fake-broadcast.
    const action: 'add' | 'remove' = mine ? 'remove' : 'add'
    const store = useMessagesStore.getState()
    // Свой КЛЮЧ — чтобы чип сразу показал аватар (tweb кладёт свой peer в
    // recent_reactions мгновенно), а не мигнул числом до серверного эха. Имя и
    // фото чип берёт из зеркала пиров сам, снимок карточки ему не нужен.
    const me = useChatsStore.getState().me
    const meCard = me ? me.user.id : undefined

    if (action === 'add') {
      // Эффект вокруг чипа + select-анимация иконки (tweb reaction.ts
      // fireAroundAnimation) — играют РОВНО здесь: это единственный писатель
      // reactionEffectStore, поэтому чужая реакция, приехавшая по WS
      // (applyReaction в storeProjection — отдельный путь), эффект не триггерит.
      useReactionEffectStore.getState().trigger(msgId, emoji)

      // Снимаем свои прежние реакции, которые не помещаются в лимит вместе с новой.
      // Порядок постановки (tweb chosen_order) сервер нам не отдаёт, поэтому
      // старшинство берём по позиции в агрегате.
      // Premium — ФЛАГ конструктора (`user.pFlags.premium`), а не поле витрины.
      const limit = me?.user.pFlags?.premium ? REACTIONS_USER_MAX_PREMIUM : REACTIONS_USER_MAX_DEFAULT
      const others = (raw.reactions ?? []).filter((r) => r.mine && r.emoji !== emoji)
      for (const stale of others.slice(0, Math.max(0, others.length - limit + 1))) {
        store.applyReactionOptimistic(numericChatId, msgId, stale.emoji, 'remove', meCard)
        void managers.messages.unreact(numericChatId, msgId, stale.emoji).catch(() =>
          store.applyReactionOptimistic(numericChatId, msgId, stale.emoji, 'add', meCard),
        )
      }
    }

    store.applyReactionOptimistic(numericChatId, msgId, emoji, action, meCard)
    const req = mine
      ? managers.messages.unreact(numericChatId, msgId, emoji)
      : managers.messages.react(numericChatId, msgId, emoji)
    void req.catch(() =>
      store.applyReactionOptimistic(numericChatId, msgId, emoji, action === 'add' ? 'remove' : 'add', meCard),
    )
    // В «Избранном» реакция = тег: пусть панель тегов пересчитает список/счётчики
    // (слушатель есть только когда открыт самочат).
    rootScope.dispatchEvent('ui:savedTagsChanged', undefined)
  })

  // Кто отреагировал (long-press / правый клик по чипу реакции): попап со списком
  // «аватар + имя + его эмодзи». Тап по чипу остаётся тогглом своей реакции.
  const showReactedUsers = useEvent(async (msgId: number, x: number, y: number) => {
    if (!isRealChat) return
    const raw = win.msgs.find((m) => m.id === msgId)
    if (!raw || raw.id < 0) return
    const users = await managers.messages.reactionUsers(numericChatId, msgId)
    // Имя и аватарка живут в КАРТОЧКЕ (`u.user`), а не плоскими полями рядом.
    const rows = users.map((u) => ({ name: getUserTitle(u.user), photoId: getPeerPhotoId(u.user.photo) || undefined, emoji: u.emoji }))
    setReacted({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), rows })
  })

  // Платная ⭐-реакция: открыть попап выбора количества (клик по чипу звезды в
  // полоске реакций / пункт меню). Реальный чат + серверный id обязательны.
  const openStarReaction = useEvent((msgId: number) => {
    if (!isRealChat || msgId < 0) return
    setStarReact({ msgId })
  })
  const openStarReactionFromMenu = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id != null) setStarReact({ msgId: raw.id })
  }
  // «Статистика» поста канала (tweb messageStatistics): открыть оверлей PostStats.
  const openPostStats = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id != null) setPostStats({ msgId: raw.id })
  }

  // «Проверка фактов» (tweb onEditFactCheckClick): открыть редактор (add/edit).
  const openFactCheckEditor = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw != null && isRealChat) setFactCheckEdit({ msgId: raw.id, initial: raw._ === 'message' ? raw.factcheck : undefined })
  }
  // Сохранить проверку: разбор markdown (сущности как при отправке), REST + оптимистичный патч стора.
  const submitFactCheck = async (text: string, country: string) => {
    const edit = factCheckEdit
    setFactCheckEdit(null)
    if (!edit || !isRealChat) return
    const parsed = parseMarkdown(text)
    if (!parsed.text.trim()) return
    // Воркер пишет свой SSOT; main-стор патчим здесь результатом (factcheck на
    // сообщении, не пер-юзерный), WS factcheck_update затем реконсилит.
    const m = await managers.messages.setFactCheck(numericChatId, edit.msgId, parsed.text, parsed.entities, country || undefined).catch(() => null)
    if (m) useMessagesStore.getState().applyFactCheck(numericChatId, edit.msgId, m._ === 'message' ? m.factcheck : undefined)
  }
  // Снять проверку фактов (tweb deleteFactCheck): оптимистично + REST.
  const removeFactCheck = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id == null || !isRealChat) return
    const msgId = raw.id
    // Оптимистично снимаем в main-сторе; воркер патчит свой SSOT; WS реконсилит.
    useMessagesStore.getState().applyFactCheck(numericChatId, msgId, undefined)
    void managers.messages.removeFactCheck(numericChatId, msgId)
  }

  // Полоска эмодзи над контекстным меню: реакция на сообщение меню.
  const reactToMenuMsg = (emoji: string) => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id != null) toggleReaction(raw.id, emoji)
  }

  // Неотправленное сообщение (message_error): вместо обычного меню — только
  // «Переотправить» / «Удалить» (tweb: контекст-меню error-бабла).
  const resendFailed = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?._ !== 'message' || !raw.failed || !raw.random_id) return
    const kind = getMessageKind(raw)
    // Снять пометку ошибки (владелец → операция patch) и переотправить тем же
    // random_id. `optimistic` в sendText НЕ передаём: бабл уже есть и в окне, и
    // в pending-реестре воркера — beforeMessageSending завёл бы рядом второй.
    void managers.messages.retryPending({ clientMsgId: raw.random_id })
    void managers.messages.sendText({
      peerId: numericChatId, text: raw.message, entities: raw.entities,
      clientMsgId: raw.random_id, mediaId: getMediaId(raw),
      type: kind !== 'text' ? kind : undefined,
      // Пакет параметров отправки восстанавливается из САМОГО бабла — порт tweb
      // `repayCallback` (appMessagesManager.ts:1484-1489: повтор идёт тем же
      // `options`, что и первая попытка). Плашки композера здесь уже нет: ответ
      // и тред — свойства неотправленного сообщения, не текущего инпута.
      replyToMsgId: getReplyToMsgId(raw), threadId: getThreadRootId(raw),
    })
  }
  const removeFailed = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.random_id) void managers.messages.cancelPending({ clientMsgId: raw.random_id })
  }
  const failedMenuItems: MsgMenuItem[] = [
    { icon: <TgIcon name="send" size={20} />, label: 'Resend', onClick: resendFailed },
    { icon: <TgIcon name="copy" size={20} />, label: 'Copy', onClick: copyMsg },
    { icon: <TgIcon name="delete" size={20} />, label: 'Delete', danger: true, onClick: removeFailed },
  ]

  const regularMenuItems: MsgMenuItem[] = [
    // Исходящее сообщение — ПЕРВЫЙ видимый пункт (tweb contextMenu.ts:874,
    // localName 'views'). Приватный чат: дата прочтения (getOutboxReadDate,
    // :1504-1541) — пока запрос летит, вместо текста скелетон
    // `.btn-menu-item-loader.shimmer` (:1508-1511), следом `hr` (:1514).
    // Группа/канал: «Кто просмотрел» (без разделителя — tweb вешает `hr` только
    // в ветке isUser).
    ...(() => {
      const isOut = isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      if (!isOut) return []
      const icon = <TgIcon name="checks" size={20} />
      if (chat.type !== 'private') return [{ icon, label: 'Viewers', onClick: showViewers }]
      if (!readDate) return []
      if (readDate.state === 'loading') {
        return [{ icon, label: <div className="btn-menu-item-loader shimmer" />, separatorDown: true }]
      }
      // tweb :1526 — лоадер заменяется ТОЛЬКО датой (formatFullSentTime), слова
      // «Прочитано» в успешном случае нет (закомментировано в оригинале).
      if (readDate.state === 'done') return [{ icon, label: friendlyMsgTime(readDate.at, lang), separatorDown: true }]
      // YOUR_PRIVACY_RESTRICTED (tweb :1537-1540): «Read» + `.show-when`.
      // отступление от tweb: ключей 'Chat.ContextMenu.Read'/'PmReadShowWhen' в
      // нашем словаре нет — язык берём напрямую, как это делает friendlyMsgTime.
      const ru = lang === 'ru'
      return [{
        icon,
        label: <>{ru ? 'Прочитано' : 'Read'} <span className="show-when">{ru ? 'показать когда' : 'show when'}</span></>,
        separatorDown: true,
      }]
    })(),
    { icon: <TgIcon name="reply" size={20} />, label: 'Reply', onClick: startReply },
    // «Ответить в другом чате» (tweb ReplyToAnotherChat, icon replace) — рядом с
    // «Ответить». Не в секретном чате (кросс-чат перенос там неприменим).
    ...(isRealChat && !isSecret ? [{ icon: <TgIcon name="replace" size={20} />, label: 'Reply in Another Chat', onClick: startReplyAnother }] : []),
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="edit" size={20} />, label: 'Edit', onClick: startEdit }]
      : []),
    ...(!isSecret ? [{ icon: <TgIcon name="copy" size={20} />, label: 'Copy', onClick: copyMsg }] : []),
    // «Copy Media» — сразу после «Copy», как в оригинале. Только фото: буфер
    // обмена принимает картинку, для видео/файлов пункта нет (там «Download»).
    ...(isRealChat && !isSecret && menuRawMsgKind() === 'photo'
      ? [{ icon: <TgIcon name="copy" size={20} />, label: 'Copy Media', onClick: copyMedia }]
      : []),
    // «Copy Message Link» — только в каналах (tweb verify: isChannel), у поста
    // с серверным seq: у неотправленного якоря ещё нет.
    ...(isRealChat && chat.type === 'channel' && menuRawMsg() != null
      ? [{ icon: <TgIcon name="link" size={20} />, label: 'Copy Message Link', onClick: copyMsgLink }]
      : []),
    ...(showTranslate && (msgs[msgMenu?.idx ?? -1]?.text)
      ? [{ icon: <TgIcon name="language" size={20} />, label: 'Translate', onClick: startTranslate }]
      : []),
    ...(isRealChat
      ? [{
          icon: <TgIcon name="pin" size={20} />,
          label: pins.some((p) => p.id === menuRawMsg()?.id) ? 'Unpin' : 'Pin',
          onClick: togglePin,
        }]
      : []),
    ...(() => {
      const raw = menuRawMsg()
      // tweb contextMenu «Save GIF» — `doc.type === 'gif'` (тот же вопрос к
      // документу, что и у бабла): признак выведен из `documentAttributeAnimated`
      // в `saveDocument`, а не угадан по mime/имени файла.
      return isRealChat && raw != null && getMediaId(raw) != null
        && getDocumentFromMessage(raw._ === 'message' ? raw : undefined)?.type === 'gif'
        ? [{ icon: <TgIcon name="gifs" size={20} />, label: 'Save GIF', onClick: saveGifFromMsg }]
        : []
    })(),
    ...(isRealChat && getMenuMediaId() != null
      ? [{ icon: <TgIcon name="download" size={20} />, label: 'Download', onClick: downloadMsg }]
      : []),
    // Опрос: «Отменить голос» (не викторина, не закрыт, голосовал) и
    // «Остановить опрос» (своё сообщение, не закрыт) — tweb contextMenu
    ...(() => {
      const raw = menuRawMsg()
      const media = raw?._ === 'message' && raw.media?._ === 'messageMediaPoll' ? raw.media : undefined
      if (!isRealChat || !media) return []
      const poll = media.poll
      const items: MsgMenuItem[] = []
      // «Мой голос» — флаг ВАРИАНТА в итогах, а не массив индексов рядом.
      const voted = (media.results.results ?? []).some((r) => r.pFlags?.chosen)
      if (!poll.pFlags?.closed && !poll.pFlags?.quiz && voted) {
        items.push({
          icon: <TgIcon name="checkretract" size={20} />,
          label: 'Retract Vote',
          onClick: () => { void managers.messages.votePoll(numericChatId, poll.id, []).then((p) => useMessagesStore.getState().setPollMedia(numericChatId, p)) },
        })
      }
      if (!poll.pFlags?.closed && raw!.fromId === meId) {
        items.push({
          icon: <TgIcon name="stop" size={20} />,
          label: 'Stop Poll',
          onClick: () => { void managers.messages.closePoll(poll.id) },
        })
      }
      return items
    })(),
    ...(isRealChat ? [{ icon: <TgIcon name="star" size={20} />, label: 'React with Stars', onClick: openStarReactionFromMenu }] : []),
    ...(isRealChat && !isSecret ? [{ icon: <TgIcon name="reply" size={20} style={{ transform: 'scaleX(-1)' }} />, label: 'Forward', onClick: openForward }] : []),
    ...(isRealChat ? [{ icon: <TgIcon name="checkround" size={20} />, label: 'Select', onClick: startSelect }] : []),
    // «Статистика» — пост канала, зритель админ/владелец (tweb can_view_stats).
    ...(canViewPostStats && menuRawMsg()?.id != null
      ? [{ icon: <TgIcon name="statistics" size={20} />, label: 'Statistics', onClick: openPostStats }]
      : []),
    // «Проверка фактов» — канал, зритель автор/админ (tweb canUpdateFactCheck):
    // добавить/изменить + (если есть) удалить.
    ...(canEditFactCheck && menuRawMsg()?.id != null
      ? [
          { icon: <TgIcon name="factcheck" size={20} />, label: menuRawFactCheck() ? 'Edit Fact Check' : 'Add Fact Check', onClick: openFactCheckEditor },
          ...(menuRawFactCheck() ? [{ icon: <TgIcon name="delete" size={20} />, label: 'Delete Fact Check', danger: true, onClick: removeFactCheck }] : []),
        ]
      : []),
    // «Пожаловаться» — на чужие сообщения в реальном чате (своё не жалуют).
    ...(isRealChat && !(msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="hand" size={20} />, label: 'Report', danger: true, onClick: openReport }]
      : []),
    ...(isRealChat ? [{ icon: <TgIcon name="delete" size={20} />, label: 'Delete', danger: true, onClick: openDelete }] : []),
  ]

  const msgMenuItems: MsgMenuItem[] = menuRawMsg()?.failed ? failedMenuItems : regularMenuItems

  return {
    msgMenu, openMsgMenu, closeMsgMenu, destroyMsgMenu, msgMenuItems,
    toggleReaction, reactToMenuMsg, showReactedUsers,
    openStarReaction, starReact, closeStarReaction: () => setStarReact(null),
    postStats, closePostStats: () => setPostStats(null),
    factCheckEdit, submitFactCheck, closeFactCheckEditor: () => setFactCheckEdit(null),
    delIds, doDelete, closeDelete: () => setDelIds(null), openDeleteFor, canRevokeAll,
    forwardIds, doForward, closeForward: () => setForwardIds(null), openForwardFor, openForwardFrom,
    replyAnother, pickReplyAnotherChat, closeReplyAnother: () => setReplyAnother(null),
    viewers, closeViewers: () => setViewers(null),
    reacted, closeReacted: () => setReacted(null),
    translateText, closeTranslate: () => setTranslateText(null),
  }
}

// src/core/dialogToChat.ts
//
// Строка диалога → вью-модель списка чатов.
//
// ── Что изменилось с переводом /chats на контейнер (шаг C диалогов) ─────────
// Строка `dialog` больше не держит в себе ни чат, ни последнее сообщение: имя,
// аватарка и `forum` живут в карточке пира (зеркало `core/peerCache.ts`,
// наполняют его векторы `chats`/`users` контейнера), а `top_message` разрешён
// воркером в ЦЕЛОЕ сообщение. Отсюда три следствия:
//
//  • ВИД ЧАТА ВЫВОДИТСЯ ЗДЕСЬ — и только здесь (решение Р8). С провода строка
//    `type` снята; вопрос задают предикаты над конструктором
//    (`core/peers/predicates.ts`). Вью-модельный `ChatType` (`data.ts`) при
//    этом остаётся строкой: у него ~80 сравнений, а вывод один на всех;
//  • имя автора превью в группе собирает КЛИЕНТ (`getPeerTitle` по пиру из
//    зеркала) — серверного `sender_name` больше нет вовсе;
//  • заглушённость считается по СРОКУ (`notify_settings.mute_until`), а не по
//    булеву полю строки.
import type { LangPackKey } from '@/lang'
import { useI18nStore } from '../i18n'
import type { Chat, ChatType } from '../data'
import { getMessageText, isDialogArchived, type Dialog, type MyMessage } from './models'
import { draftDate, draftText, hasDraft as dialogHasDraft } from './dialogs/draft'
import { getMediaId, getMessageKind, type MessageKind } from './messages/messageKind'
import { serviceMsgText } from './serviceMsg'
import { getPeerPhotoId, getPeerPhotoStrippedThumb, type Chat as PeerChat, type User } from './peers/peer'
import { SAVED_MESSAGES_TITLE, getPeerTitle } from './peers/getPeerTitle'
import { getChatPhoto, isBroadcast, isForum } from './peers/predicates'
import { isUser } from './peers/peerId'
import { isPeerMuted } from './dialogs/notifySettings'
import { cachedPeer } from './peerCache'

// Палитра аватаров 1:1 с tweb (base.scss @include avatar-color): вертикальный
// градиент top→bottom, 7 цветов, индекс = abs(id) % 7 (getPeerColorIndexById).
// Порядок tweb: red, orange, violet, green, cyan, blue, pink.
export const GRADIENTS = [
  'linear-gradient(#FF845E,#D45246)', // red
  'linear-gradient(#FEBB5B,#F68136)', // orange
  'linear-gradient(#B694F9,#6C61DF)', // violet
  'linear-gradient(#9AD164,#46BA43)', // green
  'linear-gradient(#53EDD6,#28C9B7)', // cyan
  'linear-gradient(#5CAFFA,#408ACF)', // blue
  'linear-gradient(#FF8AAC,#D95574)', // pink
]

export function gradientFor(id: number): string {
  return GRADIENTS[Math.abs(id) % GRADIENTS.length]
}

// Reserved id of the official "Telegram" service account (mirrors the backend's
// domain.ServiceUserID). Rendered with the Telegram-plane avatar, not initials.
export const SERVICE_USER_ID = 777000
// Telegram-сервис: фирменный голубой градиент плашки (tweb telegram blue).
const SERVICE_GRADIENT = 'linear-gradient(#72D5FD,#2A9EF1)'

// A human label for a media message with no caption (tweb wrapMessageForReply:
// grey type label). Возвращает КЛЮЧ, а не текст: до задачи 6 здесь лежали русские
// строки прямо в коде (задача 1, п. 2), и английский интерфейс показывал русское
// «Фото». Вместе с ними ушли эмодзи-приставки («📊 Опрос»): у оригинала в этом
// месте иконок нет, метка серая и текстовая (`wrapMessageForReply`).
export function mediaLabelKey(kind?: MessageKind): LangPackKey | '' {
  switch (kind) {
    case 'photo': return 'AttachPhoto'
    case 'video': return 'AttachVideo'
    case 'gif': return 'AttachGif'
    case 'roundVideo': return 'AttachRound'
    case 'voice': return 'AttachAudio'
    case 'audio': return 'SharedMedia.Audio'
    case 'document': return 'Chat.Input.Attach.Document'
    case 'sticker': return 'AttachSticker'
    case 'call': return 'Message.Preview.Call'
    case 'poll': return 'Poll'
    case 'geo': return 'AttachLocation'
    case 'contact': return 'AttachContact'
    case 'gift': return 'StarGiftTitle'
    case 'giveaway': return 'BoostingGiveaway'
    case 'text':
    case undefined:
      return ''
    // Вид, у которого своей строки нет (чек-лист, шифрованное, пилюля), —
    // не показываем пустоту. Прежние ветки 'game'/'story' сняты: таких видов
    // сообщения у нас нет вовсе, а `MessageKind` перечисляет ровно те, что есть.
    default: return 'Message'
  }
}

/**
 * ТЕКСТ метки — то, что печатают потребители (превью списка чатов, тем форума, общих
 * медиа, поиска и тела уведомления). Ключ отдаёт `mediaLabelKey` рядом: перевод живёт
 * у производителя, потому что ни один из пяти потребителей `t()` не зовёт.
 */
export function mediaLabel(kind?: MessageKind): string {
  const key = mediaLabelKey(kind)
  return key ? useI18nStore.getState().t(key) : ''
}

/** Разрешение «ключ пира → карточка». По умолчанию — зеркало главного потока;
 *  аргументом, чтобы функция осталась чистой и проверяемой. */
export type PeerLookup = (peerId: PeerId) => User | PeerChat | undefined

/**
 * Вид чата — порт ветвления `appPeersManager` по конструктору пира и флагам
 * `Chat`, а не по снятой с провода строке.
 *
 * Порядок вопросов: «Избранное» — это пир, равный зрителю; секретный — НАШ
 * параметр вне схемы (решение Р9, подсистема вне периметра порта); дальше
 * приватный это ключ пользователя, канал — `pFlags.broadcast`, группа — всё
 * остальное чатовое.
 *
 * `bot` вью-модели здесь НЕ производится и не производился: он про
 * собеседника-бота, а не про вид пира, и его ставят экраны по карточке.
 */
export function dialogChatType(
  dialog: Pick<Dialog, 'peerId' | 'secret'>,
  chat: PeerChat | undefined,
  meId?: number | null,
): ChatType {
  if (meId != null && dialog.peerId === meId) return 'saved'
  if (dialog.secret) return 'secret'
  if (isUser(dialog.peerId)) return 'private'
  return isBroadcast(chat) ? 'channel' : 'group'
}

/**
 * Превью последнего сообщения. Строится из ЦЕЛОГО `Message` — того же объекта,
 * что рисует лента, — а не из девятиполевой серверной выжимки.
 *
 * `mediaLabel()` пока остаётся: `wrapMessageForReply` (452 строки оригинала —
 * одна таблица лейблов на список чатов, цитату ответа и уведомления) у нас не
 * портирован вовсе. Этот шаг даёт ему ПРЕДМЕТ (целое сообщение), сам порт —
 * отдельная задача следом.
 */
export function previewOf(lm: MyMessage | undefined): { text: string; isService: boolean } {
  if (!lm) return { text: '', isService: false }
  const kind = getMessageKind(lm)
  // «Служебное ли» — ВЫБОР КОНСТРУКТОРА (messageService), а не значение поля
  // type; лог звонка это тоже служебное сообщение, но со своим баблом, поэтому
  // пилюлей он не считается.
  const isService = kind === 'service'
  if (isService) return { text: serviceMsgText(lm as Extract<MyMessage, { _: 'messageService' }>), isService }
  if (kind === 'call') return { text: mediaLabel('call'), isService }
  return { text: getMessageText(lm) || mediaLabel(kind), isService }
}

export function dialogToChat(
  d: Dialog,
  meId?: number | null,
  lookup: PeerLookup = cachedPeer,
  now = Math.floor(Date.now() / 1000),
): Chat {
  const peer = lookup(d.peerId)
  const chatPeer = isUser(d.peerId) ? undefined : (peer as PeerChat | undefined)
  const user = isUser(d.peerId) && peer && peer._ === 'user' ? peer : undefined
  const type = dialogChatType(d, chatPeer, meId)
  const isSaved = type === 'saved'
  const isService = d.peerId === SERVICE_USER_ID
  // Имя собирает КЛИЕНТ (`display_name` и `title` строки диалога с провода
  // убраны): у приватного — из конструктора `user` с фолбэками «Удалённый
  // аккаунт»/username, у группы/канала — `title` конструктора `channel`. Оба
  // ответа даёт один `getPeerTitle`, и фолбэк «карточки ещё нет» у него разный
  // по виду пира — ровно как в оригинале.
  const name = isSaved ? SAVED_MESSAGES_TITLE : getPeerTitle({ peerId: d.peerId, peer }) || `Chat ${d.peerId}`
  const lm = d.lastMessage
  // Sidebar tick: only when the LAST message is mine and it's not a broadcast
  // channel. ✓✓ once the peer's read horizon (read_outbox_max_id) reaches its seq.
  const lastMine = lm != null && meId != null && lm.fromId === meId && type !== 'channel'
  const { text: baseText, isService: isServiceMsg } = previewOf(lm)
  let preview = baseText
  // Forwarded last message: a forward arrow stands in front (no "Вы:" prefix, like
  // Telegram) — the arrow itself signals it wasn't authored here.
  const forwarded = !!(lm?._ === 'message' ? lm.fwd_from : undefined)
  if (preview && !forwarded && !isServiceMsg) {
    if (lastMine) preview = `Вы: ${preview}`
    else if (type === 'group' && lm?.fromId) {
      // Имя автора — ПИР из зеркала (он приезжает в векторе `users` того же
      // контейнера), а не серверная строка `sender_name`. `onlyFirstName` —
      // потому что в строке списка оригинал показывает короткое имя, а фолбэк
      // «Удалён» у пропавшей карточки даёт сам `getPeerTitle`.
      const author = getPeerTitle({ peerId: lm.fromId!, peer: lookup(lm.fromId!), onlyFirstName: true })
      if (author) preview = `${author}: ${preview}`
    }
  }
  // Черновик заменяет превью последнего сообщения (tweb getLastMessageForDialog:
  // красный «Черновик: » + текст; тики/стрелка пересылки не показываются).
  // Черновик лежит В САМОМ диалоге — отдельным аргументом он больше не едет.
  const hasDraft = dialogHasDraft(d.draft)
  const photo = user ? user.photo : getChatPhoto(chatPeer)
  return {
    id: String(d.peerId),
    name,
    // Saved Messages: blue gradient + bookmark icon. Telegram service account:
    // blue gradient + the Telegram-plane logo. Otherwise the peer's photo or a
    // per-id gradient with initials.
    avatar: isSaved
      ? 'linear-gradient(#69BFFA,#3D9DE0)' // tweb Saved Messages blue
      : isService
        ? SERVICE_GRADIENT
        : gradientFor(d.peerId),
    avatarText: name.charAt(0).toUpperCase() || '?',
    avatarEmoji: isSaved ? 'saved' : isService ? 'tg-logo' : undefined,
    // Одно поле вместо пяти: аватарка живёт в карточке пира и несёт готовый
    // `photo_id`. Регулярки по собственной строке `/media/N/content` больше нет.
    photoId: isSaved || isService ? undefined : getPeerPhotoId(photo) || undefined,
    // Превью — тем же правилом, что и сам id: `stripped_thumb` того же `photo`.
    avatarPreview: isSaved || isService ? undefined : getPeerPhotoStrippedThumb(photo) || undefined,
    isBot: user?.pFlags?.bot || undefined,
    verified: user?.pFlags?.verified || undefined,
    premium: user?.pFlags?.premium || undefined,
    emojiStatus: user?.emoji_status_emoticon || undefined,
    // Секунды эпохи у обоих (`date:int` схемы): черновик приезжает
    // конструктором draftMessage со своим `date`, и сравниваем мы числа. Здесь
    // ВЫБОР ЧИСЛА и только он — ровно как у оригинала
    // (`appDialogsManager.ts:2240`: `Math.max(draftMessage.date, lastMessage.date)`);
    // подпись из него строит место рендера, см. `Chat.date` в `data.ts`.
    date: hasDraft && (!lm || draftDate(d.draft) > lm.date)
      ? draftDate(d.draft)
      : lm?.date,
    preview,
    draftPreview: hasDraft ? draftText(d.draft) : undefined,
    type,
    // Мьют это СРОК: «замьючен» ВЫЧИСЛЯЕТСЯ, а не приезжает признаком (порт
    // `appNotificationsManager.isMuted`). Глобально выключенный ТИП чатов
    // накладывается витриной поверх — `stores/notifyStore.ts::isDialogMuted`.
    muted: isPeerMuted(d.notify_settings, now) || undefined,
    pinned: d.pFlags?.pinned || undefined,
    archived: isDialogArchived(d) || undefined,
    isForum: isForum(chatPeer) || undefined,
    autoDeletePeriod: d.ttl_period || undefined,
    unread: d.unread_count > 0 ? d.unread_count : undefined,
    unreadMentions: d.unread_mentions_count > 0 ? d.unread_mentions_count : undefined,
    unreadReactions: d.unread_reactions_count > 0 ? d.unread_reactions_count : undefined,
    sent: (lastMine && !hasDraft) || undefined,
    read: lastMine && !hasDraft && lm!.id <= d.read_outbox_max_id ? true : undefined,
    previewMediaId: !hasDraft && lm && getMessageKind(lm) === 'photo' ? getMediaId(lm) : undefined,
    forwarded: (forwarded && !hasDraft) || undefined,
  }
}

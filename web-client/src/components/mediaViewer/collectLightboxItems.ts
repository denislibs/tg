// Сбор items вьювера из сообщений — чистая логика бывшего useLightbox
// (Task 16 медиа-суперпорта; сам хук снесён вместе с MediaLightbox).
// Квалификация медиа — тот же вопрос к самому медиа, что в bubbles.ts:3719-3722
// (`media._ === 'photo' || ['video','gif'].includes(media.type)`), плюс
// секретные (E2E) медиа того же вида. Элементы-миниатюры соседей отдаёт
// вызывающий через findElement (tweb собирает их из отрендеренных баблов,
// bubbles.ts:3744-3800) — у не отрендеренных element остаётся null.
import { friendlyMsgTime } from '@core/format/friendlyTime'
import { getMediaDimensions, getMediaFromMessage, getStrippedThumb } from '@core/media/messageMedia'
import { getSecretMediaUrl, peekSecretMediaUrl } from '@core/secret/mediaCache'
import { getMessageText, type MyMessage } from '@core/models'
import { getMediaId } from '@core/messages/messageKind'
import { messageDateISO } from '@core/messageToConvMsg'
import type { Chat, User } from '@core/peers/peer'
import { getPeerPhoto, getPeerPhotoStrippedThumb } from '@core/peers/peer'
import { getPeerTitle } from '@core/peers/getPeerTitle'
import type { ViewerItem } from './appMediaViewer'

// Контекст резолва автора (модель бывшего useLightbox: имя/дата — готовые
// строки, воркерных RPC здесь нет). peers — карта КАРТОЧЕК ПИРА (конструкторы
// схемы, как в зеркале `core/peerCache.ts`): имя из них собирает клиент
// (`getPeerTitle`), превью аватарки лежит в `photo.stripped_thumb`. Плоской
// пары {displayName, avatarPreview} больше нет — это был снимок карточки рядом
// с настоящей. chatName — фолбэк имени (приват/канал).
export type LightboxCtx = {
  meId: number | null
  meName?: string
  peers?: Map<PeerId, User | Chat>
  chatName?: string
  lang: string
}

const senderPeer = (m: MyMessage, ctx: LightboxCtx) => ctx.peers?.get((m.fromId ?? 0))

const senderName = (m: MyMessage, ctx: LightboxCtx): string =>
  (m.fromId ?? 0) === ctx.meId
    ? (ctx.meName || 'Вы')
    : (ctx.peers?.has(m.fromId ?? 0)
        ? getPeerTitle({ peerId: (m.fromId ?? 0), peer: senderPeer(m, ctx) })
        : ctx.chatName || '')

/** Один Message → ViewerItem (модель вьювера). Используется и сбором окна ниже,
 * и маппингом ответа REST `/chats/{id}/media` (loadMoreMedia), и shared media. */
export function messageToViewerItem(m: MyMessage, ctx: LightboxCtx, element: HTMLElement | null = null): ViewerItem {
  const sec = m.secretMedia
  // Медиа сообщения — как у оригинала: вьювер спрашивает его у самого сообщения
  // (tweb `getMediaFromMessage(message)`, mediaViewer/index.ts), а не собирает из
  // отдельных полей. Секретное (E2E) медиа этой модели не имеет: сервер отдаёт
  // только шифртекст, вид лежит в расшифрованном `secretMedia.mediaType`.
  const media = getMediaFromMessage(m)
  const doc = media?._ === 'document' ? media : undefined
  // tweb base.ts:2360 — `isVideo` считается ровно так: документ с типом
  // video/gif либо с video/*-mime; всё остальное вьювер ведёт как фото.
  const isVideo = !!doc && (doc.type === 'video' || doc.type === 'gif' || doc.mime_type.startsWith('video/'))
  const { w, h } = getMediaDimensions(media)
  return {
    element,
    mid: m.id,
    seq: m.id,
    media: {
      mediaId: (sec?.mediaId ?? getMediaId(m)) as number,
      width: w ?? 0,
      height: h ?? 0,
      blurPreview: getStrippedThumb(media),
      kind: sec ? (sec.mediaType === 'video' ? 'video' : 'photo') : (isVideo ? 'video' : 'photo'),
      // tweb base.ts:2479 `(media as MyDocument).type !== 'gif'` — гифку от видео
      // отличает ТИП ДОКУМЕНТА, выведенный из `documentAttributeAnimated`
      // (`saveDocument`), а не догадка по mime/имени файла.
      gif: doc?.type === 'gif' || undefined,
      duration: doc?.duration,
      // Секретное медиа (E2E): сервер отдаёт только ciphertext — байты качает
      // и расшифровывает вкладка (общий кэш с баблом), воркерный конвейер
      // downloadMediaURL/resolveStreamUrl НЕ зовётся (ветка media.url в
      // base._openMedia). Уже расшифрованное (кликнутая миниатюра показана
      // баблом) отдаём готовой строкой — она же ghost-подложка полёта.
      url: sec
        ? (peekSecretMediaUrl(sec.mediaId) ?? (() => getSecretMediaUrl(sec.mediaId, sec.keyB64, sec.ivB64, sec.mime)))
        : undefined,
    },
    author: {
      peerId: (m.fromId ?? 0),
      name: senderName(m, ctx),
      date: friendlyMsgTime(messageDateISO(m.date), ctx.lang),
      avatarPreview: (m.fromId ?? 0) === ctx.meId
        ? undefined
        : getPeerPhotoStrippedThumb(getPeerPhoto(senderPeer(m, ctx))) || undefined,
    },
    // подпись к медиа — текст самого сообщения (tweb `.media-viewer-caption`)
    caption: getMessageText(m) || undefined,
    captionEntities: m._ === 'message' ? m.entities : undefined,
  }
}

/** Окно сообщений → items вьювера + индекс кликнутого медиа.
 * Порядок — порядок окна (по возрастанию seq) → вьювер открывается с
 * reverse: true, как tweb bubbles.ts:3838. */
export function collectLightboxItems({ msgs, mediaId, ctx, findElement }: {
  msgs: MyMessage[]
  mediaId: number
  ctx: LightboxCtx
  /** миниатюра сообщения в отрендеренных баблах (null — не отрендерено) */
  findElement?: (m: MyMessage) => HTMLElement | null
}): { items: ViewerItem[]; index: number } {
  // Квалификация медиа — 1:1 критерий tweb (bubbles.ts:3722):
  // `media._ === 'photo' || ['video','gif'].includes(media.type)`. Секретные
  // (E2E) медиа модели не имеют (сервер отдаёт шифртекст) — их вид лежит в
  // расшифрованном `secretMedia.mediaType`.
  // `mediaId != null` остаётся гейтом ФАЙЛА: у платного медиа до оплаты его нет
  // вовсе (сервер отдаёт псевдо-фото из одной stripped-ступени), открывать
  // нечего.
  const isViewable = (m: MyMessage) => {
    if (getMediaId(m) == null) return false
    const sec = m.secretMedia?.mediaType
    if (sec) return sec === 'photo' || sec === 'video'
    const media = getMediaFromMessage(m)
    return media?._ === 'photo' || (media?._ === 'document' && (media.type === 'video' || media.type === 'gif'))
  }
  const viewable = msgs.filter(isViewable)
  const index = viewable.findIndex((m) => getMediaId(m) === mediaId)
  if (index >= 0) {
    return { items: viewable.map((m) => messageToViewerItem(m, ctx, findElement?.(m) ?? null)), index }
  }

  // Медиа не в ленте фото/видео (сервисное сообщение смены фото группы — type
  // 'service'): одиночный просмотр именно этого фото (фолбэк useLightbox).
  const src = msgs.find((m) => getMediaId(m) === mediaId)
  const item: ViewerItem = src
    ? messageToViewerItem(src, ctx, findElement?.(src) ?? null)
    : {
      element: null,
      mid: 0,
      media: { mediaId, width: 0, height: 0, kind: 'photo' },
      author: { peerId: -1, name: ctx.chatName || '', date: '' },
    }
  return { items: [item], index: 0 }
}

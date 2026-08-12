// Сбор items вьювера из сообщений — чистая логика бывшего useLightbox
// (Task 16 медиа-суперпорта; сам хук снесён вместе с MediaLightbox).
// Аналог tweb-квалификации медиа в bubbles.ts:3719-3722 (`media._ === 'photo' ||
// ['video','gif'].includes(media.type)`) в нашей модели окна: фото/видео чата +
// секретные (E2E) медиа того же вида. Элементы-миниатюры соседей отдаёт
// вызывающий через findElement (tweb собирает их из отрендеренных баблов,
// bubbles.ts:3744-3800) — у не отрендеренных element остаётся null.
import { friendlyMsgTime } from '@core/format/friendlyTime'
import { isGifLike } from '@core/gifs'
import { getSecretMediaUrl, peekSecretMediaUrl } from '@core/secret/mediaCache'
import type { Message } from '@core/models'
import type { ViewerItem } from './appMediaViewer'

// Контекст резолва автора (модель бывшего useLightbox: имя/дата — готовые
// строки, воркерных RPC здесь нет). peers — карта карточек с displayName и
// stripped-превью аватарки; chatName — фолбэк имени (приват/канал).
export type LightboxCtx = {
  meId: number | null
  meName?: string
  peers?: Map<number, { displayName: string; avatarPreview?: string }>
  chatName?: string
  lang: string
}

const senderName = (m: Message, ctx: LightboxCtx): string =>
  m.senderId === ctx.meId
    ? (ctx.meName || 'Вы')
    : (ctx.peers?.get(m.senderId)?.displayName || ctx.chatName || '')

/** Один Message → ViewerItem (модель вьювера). Используется и сбором окна ниже,
 * и маппингом ответа REST `/chats/{id}/media` (loadMoreMedia), и shared media. */
export function messageToViewerItem(m: Message, ctx: LightboxCtx, element: HTMLElement | null = null): ViewerItem {
  const sec = m.secretMedia
  return {
    element,
    mid: m.id,
    seq: m.seq,
    media: {
      mediaId: (sec?.mediaId ?? m.mediaId) as number,
      width: m.mediaWidth ?? 0,
      height: m.mediaHeight ?? 0,
      blurPreview: m.mediaBlur,
      kind: (sec?.mediaType ?? m.type) === 'video' ? 'video' : 'photo',
      // GIF-детект — ровно критерий бабла (RealMediaBubble.tsx:124): tweb
      // `document.type === 'gif'`; duration — из меты сообщения (у бэка может
      // быть 0 — тогда видео получит loop как «короткое», см. ViewerMedia).
      gif: sec ? undefined : (isGifLike({ mime: m.mediaMime, fileName: m.mediaName, duration: m.mediaDuration }) || undefined),
      duration: m.mediaDuration,
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
      peerId: m.senderId,
      name: senderName(m, ctx),
      date: friendlyMsgTime(m.createdAt, ctx.lang),
      avatarPreview: m.senderId === ctx.meId ? undefined : (ctx.peers?.get(m.senderId)?.avatarPreview || undefined),
    },
    // подпись к медиа — текст самого сообщения (tweb `.media-viewer-caption`)
    caption: m.text || undefined,
    captionEntities: m.entities,
  }
}

/** Окно сообщений → items вьювера + индекс кликнутого медиа.
 * Порядок — порядок окна (по возрастанию seq) → вьювер открывается с
 * reverse: true, как tweb bubbles.ts:3838. */
export function collectLightboxItems({ msgs, mediaId, ctx, findElement }: {
  msgs: Message[]
  mediaId: number
  ctx: LightboxCtx
  /** миниатюра сообщения в отрендеренных баблах (null — не отрендерено) */
  findElement?: (m: Message) => HTMLElement | null
}): { items: ViewerItem[]; index: number } {
  // Фото/видео чата + секретные (E2E) медиа того же вида; у секретного type в
  // сторе — 'encrypted', вид лежит в secretMedia.mediaType.
  const isViewable = (m: Message) =>
    m.mediaId != null && (m.type === 'photo' || m.type === 'video' ||
      m.secretMedia?.mediaType === 'photo' || m.secretMedia?.mediaType === 'video')
  const viewable = msgs.filter(isViewable)
  const index = viewable.findIndex((m) => m.mediaId === mediaId)
  if (index >= 0) {
    return { items: viewable.map((m) => messageToViewerItem(m, ctx, findElement?.(m) ?? null)), index }
  }

  // Медиа не в ленте фото/видео (сервисное сообщение смены фото группы — type
  // 'service'): одиночный просмотр именно этого фото (фолбэк useLightbox).
  const src = msgs.find((m) => m.mediaId === mediaId)
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

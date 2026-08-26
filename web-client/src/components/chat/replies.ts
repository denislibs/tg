// src/components/chat/replies.ts
//
// Тред под сообщением в бабле — порт двух узлов tweb:
//   • `components/chat/replies.ts` (кастомный элемент `replies-element`) — САМ
//     футер «N комментариев» под постом канала и его beside-вариант;
//   • `MessageRender.renderReplies` (messageRender.ts:395-416) — точка вставки:
//     выбор `footer`/`beside` и `bubbleContainer.append(...)`.
// Гейт «а есть ли тред вообще» живёт у ленты (`bubbles.ts`), как и в оригинале
// (bubbles.ts:7766-7772 → :9682).
//
// ─── Разметка (docs/tweb/comments.md §3, живой DOM `19-ch-02`) ──────────────
//   replies-element.replies.replies-footer [data-post-key="peerId_mid"]
//     div.stacked-avatars.replies-footer-avatars   ← ЛИБО
//     span.tgico.replies-footer-icon.replies-footer-icon-comments
//     span.replies-footer-text > span.i18n
//     span.tgico.replies-footer-icon.replies-footer-icon-next
//     div.rp                                       ← ripple-контейнер
// Стили уже портированы (`styles/tweb/_chatBubble.scss:2125-2225` — `.replies`,
// `.replies-beside`, `.replies-footer` со всеми модификаторами, и
// `_stackedAvatars.scss`), поэтому CSS здесь не заводится.
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • `is-unread` (синяя точка, replies.ts:105-116). Признак считается по
//    `replies.read_max_id < replies.max_id`, а этих параметров сервер не
//    производит вовсе (`backend/internal/domain/mtmessage.go:485-488`: горизонта
//    чтения У ТРЕДА у нас нет). Ставить класс, условие которого невычислимо,
//    значило бы объявить непрочитанность выдумкой.
//  • ключ `ViewInChat` (replies.ts:102) — ветка чата `Replies`
//    (`REPLIES_PEER_ID`), которого у нас нет как пира.
//  • `subscribeRepliesThread` + `updateMessage(..., 'replies_updated')`
//    (replies.ts:138-142) и глобальный слушатель `replies_updated`
//    (replies.ts:17-22) — отдельной актуализации счётчика у нас нет: тред
//    приезжает ВНУТРИ самого сообщения
//    (`backend/internal/usecase/chat/messagescontainer.go::hydrateThreads`), а
//    перерисовку футера объявляет `message_edit` — тот же путь, что у любой
//    другой правки сообщения.
//  • `ripple(rippleContainer)` (replies.ts:126) — ванильного `ripple` у нас нет
//    вовсе (React-порт живёт в `shared/ui/Ripple/useRipple.tsx`), поэтому узла
//    `.c-ripple` внутри `div.rp` нет; тот же вычет уже записан в
//    `components/AttachMenu.tsx:13`. Сам `div.rp` остаётся — на нём висит
//    область клика (`_chatBubble.scss:2131-2140`).
import Icon from '@components/icon'
import { avatarNew, type AvatarManagers } from '@components/avatar'
import type { Middleware } from '@helpers/middleware'
import { getPeerId, type Peer } from '@core/peers/peerId'
import type { MessageReplies } from '@core/models'
import { fmtViews } from '@core/format/fmtViews'
import { commentsLabel } from '@core/format/commentsLabel'
import { useI18nStore } from '../../i18n'

/** tweb replies.ts:15. */
const TAG_NAME = 'replies-element'

/** tweb replies.ts:63-69 — размер аватарки в стеке футера. */
const AVATAR_SIZE = 30

/**
 * Стек аватарок последних комментаторов — порт `StackedAvatars.render`
 * (tweb `components/stackedAvatars.ts:36-80`) в объёме ОДНОГО построения.
 *
 * В оригинале это отдельный переиспользуемый компонент (чип реакции,
 * закреплённое, бусты); у нас все прочие его потребители — React
 * (`components/messages/StackedAvatars.tsx`), а ванильный потребитель ровно
 * один — этот футер. Поэтому порт лежит здесь, а не заводит второй общий
 * модуль: разъезжаться двум копиям негде, пока копия одна.
 *
 * `reverse` и срез последних трёх — из оригинала (:38-41): в макете аватарки
 * накладываются в порядке, обратном порядку данных.
 */
function createStackedAvatars(
  peerIds: PeerId[],
  middleware: Middleware,
  managers: AvatarManagers,
): HTMLElement {
  const container = document.createElement('div')
  container.classList.add('stacked-avatars')
  container.style.setProperty('--avatar-size', AVATAR_SIZE + 'px')

  const ids = peerIds.slice().reverse().slice(-3)
  ids.forEach((peerId, idx) => {
    const avatarContainer = document.createElement('div')
    avatarContainer.classList.add('stacked-avatars-avatar-container')
    // tweb :69-70 — края стека помечены, по ним CSS снимает наложение.
    avatarContainer.classList.toggle('is-first', idx === 0)
    avatarContainer.classList.toggle('is-last', idx === ids.length - 1)

    const avatar = avatarNew({ peerId, size: AVATAR_SIZE, middleware, managers })
    avatar.node.classList.add('stacked-avatars-avatar')
    avatarContainer.append(avatar.node)
    container.append(avatarContainer)
  })

  return container
}

export interface RepliesElementOptions {
  /** тред, уже прошедший гейт `getMessageWithCommentReplies` */
  replies: MessageReplies
  /** ключ чата и номер сообщения, НЕСУЩЕГО тред (у альбома — главного) */
  peerId: PeerId
  mid: number
  /** tweb `repliesFooter.type` (messageRender.ts:409) */
  type: 'footer' | 'beside'
  middleware: Middleware
  managers: AvatarManagers
}

/**
 * `replies-element` целиком — порт `RepliesElement.init`/`render`
 * (tweb replies.ts:41-147) в объёме одного построения: ветки обновления НА
 * МЕСТЕ (`if(this.firstElementChild)`, `compareAndUpdate`) предмета не имеют —
 * у нас узел пересобирается вместе с правкой сообщения.
 */
export function createRepliesElement(options: RepliesElementOptions): HTMLElement {
  const { replies, peerId, mid, type, middleware, managers } = options

  const element = document.createElement(TAG_NAME)
  // tweb replies.ts:43-44.
  element.dataset.postKey = peerId + '_' + mid
  element.classList.add('replies', 'replies-' + type)

  if (type === 'beside') {
    // tweb replies.ts:132-135.
    element.classList.add('bubble-beside-button')
    const text = document.createElement('span')
    text.classList.add('replies-beside-text')
    // Оригинал берёт `formatNumber(n, 0)`; тот же компактный формат у нас
    // считает общий с просмотрами `fmtViews` (один знак после запятой) —
    // второго форматтера чисел не заводим.
    text.textContent = replies.replies ? fmtViews(replies.replies) : ''
    element.append(Icon('commentssticker'), text)
    return element
  }

  // Левая часть: аватарки комментаторов, а без них — иконка (tweb :56-84).
  const recent = replies.recent_repliers
  if (recent?.length) {
    const stack = createStackedAvatars(recent.map((peer: Peer) => getPeerId(peer)), middleware, managers)
    // tweb :69 — стек внутри футера несёт свой класс-модификатор.
    stack.classList.add('replies-footer-avatars')
    element.append(stack)
  } else {
    element.append(Icon('comments', 'replies-footer-icon', 'replies-footer-icon-comments'))
  }

  // Текст. Оригинал раздаёт ключи `Comments` (`%1$d Comment/Comments`) и
  // `LeaveAComment` (:96-100); второго у нас не заведено, и на нуле пишется
  // «Комментарии» — общий с React-лентой `commentsLabel`. Расхождение уже
  // записано в docs/tweb/comments.md:339.
  const textSpan = document.createElement('span')
  textSpan.classList.add('replies-footer-text')
  const i18n = document.createElement('span')
  i18n.classList.add('i18n')
  const { t, lang } = useI18nStore.getState()
  i18n.textContent = commentsLabel(replies.replies, lang, t)
  textSpan.append(i18n)

  // tweb :123-128 — стрелка и ripple-контейнер ПОСЛЕДНИМИ.
  const rippleContainer = document.createElement('div')
  rippleContainer.classList.add('rp')

  element.append(textSpan, Icon('next', 'replies-footer-icon', 'replies-footer-icon-next'), rippleContainer)
  return element
}

/**
 * Порт `MessageRender.renderReplies` (tweb messageRender.ts:395-416): выбрать
 * форму футера, собрать узел и повесить его в `bubbleContainer`.
 *
 * Возвращает `isFooter` — ровно то же, что оригинал, и по той же причине: на
 * ответе стоит развилка вызывающего (bubbles.ts:9692-9697) — футеру бабл
 * разрешает хвост, beside-варианту вешает класс `with-beside-replies`.
 */
export function renderReplies(options: Omit<RepliesElementOptions, 'type'> & {
  bubble: HTMLElement
  bubbleContainer: HTMLElement
}): boolean {
  const { bubble, bubbleContainer, ...rest } = options
  // tweb messageRender.ts:404-406.
  const isFooter = !bubble.classList.contains('sticker') &&
    !bubble.classList.contains('emoji-big') &&
    !bubble.classList.contains('round')

  bubbleContainer.append(createRepliesElement({ ...rest, type: isFooter ? 'footer' : 'beside' }))
  return isFooter
}

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
// Сам стек аватарок — общий компонент `components/stackedAvatars.ts` (порт tweb
// `components/stackedAvatars.ts`), как и в оригинале: у него потребителей
// несколько, и второй уже появился — чип реакции (`chat/reactions.ts`).
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • ключ `ViewInChat` (replies.ts:53, :107) — ветка чата `Replies`
//    (`REPLIES_PEER_ID`), которого у нас нет как пира: футер строится только за
//    прошедшим гейт тредом, `replies` есть всегда.
//  • `lazyLoadQueue`/`loadPromises` (replies.ts:28-29, :149-151) — у нашего
//    `StackedAvatars` очереди нет, аватарки грузятся сами.
//  • `ripple(rippleContainer)` (replies.ts:131) — ванильного `ripple` у нас нет
//    вовсе (React-порт живёт в `shared/ui/Ripple/useRipple.tsx`), поэтому узла
//    `.c-ripple` внутри `div.rp` нет; тот же вычет уже записан в
//    `components/AttachMenu.tsx:13`. Сам `div.rp` остаётся — на нём висит
//    область клика (`_chatBubble.scss:2131-2140`).
//  • `ensureButtonSemantics` (replies.ts:43) и `aria-label` (:51-53) — порта
//    помощника нет; кликом футер ведёт лента (`bubbles.ts`), как и прежде.
//
// Глобальный слушатель `replies_updated` (replies.ts:17-23) живёт у ленты
// (`bubbles.ts`), как и все прочие её подписки: событие приходит операцией окна
// с ключом хранилища, и ключ сверяет лента.
import Icon from '@components/icon'
import type { AvatarManagers } from '@components/avatar'
import StackedAvatars from '@components/stackedAvatars'
import type { Middleware } from '@helpers/middleware'
import { getPeerId, type Peer } from '@core/peers/peerId'
import type { MessageReplies } from '@core/models'
import { fmtViews } from '@core/format/fmtViews'
import { isLocalMessageId } from '@core/history/messageId'
import I18n from '@lib/langPack'

/** tweb replies.ts:16. */
const TAG_NAME = 'replies-element'

/** tweb replies.ts:68-72 — размер аватарки в стеке футера. */
const AVATAR_SIZE = 30

/** Перечитывание треда поста — менеджер сообщений воркера (tweb
 *  `appMessagesManager.subscribeRepliesThread`/`updateMessage`, :8772-8779,
 *  :11923-11937). Опционален: без него футер рисуется, но не обновляется. */
export interface RepliesManagers extends AvatarManagers {
  messages?: {
    subscribeRepliesThread?(peerId: number, mid: number): unknown
    updateMessage?(peerId: number, mid: number): unknown
  }
}

/** Пост, НЕСУЩИЙ тред (у альбома — главное сообщение), — `message` оригинала в
 *  нужном объёме. */
export interface RepliesMessage {
  peerId: PeerId
  mid: number
  /** тред, уже прошедший гейт `getMessageWithCommentReplies` */
  replies: MessageReplies
}

export interface RepliesElementOptions extends RepliesMessage {
  /** tweb `repliesFooter.type` (messageRender.ts:434) */
  type: 'footer' | 'beside'
  middleware: Middleware
  managers: RepliesManagers
}

/**
 * Ключ и аргументы текста футера — порт tweb `replies.ts:100-105`.
 */
function repliesTextOptions(count: number) {
  return count
    ? { key: 'Comments' as const, args: [count] }
    : { key: 'LeaveAComment' as const }
}

/**
 * `replies-element` — порт кастомного элемента `RepliesElement` (tweb
 * replies.ts:25-153): узел ПЕРЕЖИВАЕТ обновление треда, `render` идемпотентен
 * и переиспользует стек аватарок и текст (`compareAndUpdate`), — внутри футера
 * живут аватарки комментаторов, которые пересборка перезагрузила бы.
 */
export default class RepliesElement extends HTMLElement {
  public message!: RepliesMessage
  public type!: 'footer' | 'beside'
  public stackedAvatars?: StackedAvatars
  public text?: I18n.IntlElement
  public managers!: RepliesManagers
  public middleware!: Middleware

  private updated = false

  /** tweb :42-47 */
  public init() {
    this.render()
    this.dataset.postKey = this.message.peerId + '_' + this.message.mid
    this.classList.add('replies', 'replies-' + this.type)
  }

  /** tweb :49-152 */
  public render() {
    const replies = this.message.replies

    if (this.type === 'footer') {
      let leftPart = this.firstElementChild as HTMLElement | null

      if (replies.recent_repliers?.length) {
        if (leftPart && !leftPart.classList.contains('replies-footer-avatars')) {
          this.replaceChildren()
          leftPart = null
        }

        if (!this.stackedAvatars) {
          this.stackedAvatars = new StackedAvatars({ avatarSize: AVATAR_SIZE, middleware: this.middleware, managers: this.managers })
          // tweb :74 — стек внутри футера несёт свой класс-модификатор.
          this.stackedAvatars.container.classList.add('replies-footer-avatars')
        }

        leftPart = this.stackedAvatars.container
        void this.stackedAvatars.render(replies.recent_repliers.map((peer: Peer) => getPeerId(peer)))
      } else {
        if (leftPart && !leftPart.classList.contains('replies-footer-icon-comments')) {
          leftPart.remove()
          leftPart = null
        }

        if (!leftPart) {
          leftPart = Icon('comments', 'replies-footer-icon', 'replies-footer-icon-comments')
        }
      }

      if (!leftPart.parentElement) {
        this.prepend(leftPart)
      }

      // Текст — ЖИВОЙ УЗЕЛ ядра (`I18n.IntlElement`, tweb :95-108): язык
      // меняется на месте (`applyLangPack`), число — `compareAndUpdate`.
      if (!this.text) {
        this.text = new I18n.IntlElement(repliesTextOptions(replies.replies))
      } else {
        this.text.compareAndUpdate(repliesTextOptions(replies.replies))
      }

      // tweb :110-121 — синяя точка «есть новые комментарии»: горизонт треда
      // зрителя ниже последнего номера треда (оба едут в messageReplies).
      let isUnread = false
      if (replies.replies && replies.read_max_id !== undefined && replies.max_id !== undefined) {
        isUnread = replies.read_max_id < replies.max_id
      }
      this.classList.toggle('is-unread', isUnread)

      let textSpan = this.children[1] as HTMLElement | undefined
      if (!textSpan) {
        textSpan = document.createElement('span')
        textSpan.classList.add('replies-footer-text')

        const iconSpan = Icon('next', 'replies-footer-icon', 'replies-footer-icon-next')

        // tweb :130-131 — ripple-контейнер (без ripple, см. шапку).
        const rippleContainer = document.createElement('div')
        rippleContainer.classList.add('rp')

        this.append(textSpan, iconSpan, rippleContainer)
      }

      if (this.text.element.parentElement !== textSpan) textSpan.replaceChildren(this.text.element)
    } else {
      // tweb :138-140. Оригинал берёт `formatNumber(n, 0)`; тот же компактный
      // формат у нас считает общий с просмотрами `fmtViews` — второго
      // форматтера чисел не заводим.
      this.classList.add('bubble-beside-button')
      const text = document.createElement('span')
      text.classList.add('replies-beside-text')
      text.textContent = replies.replies ? fmtViews(replies.replies) : ''
      this.replaceChildren(Icon('commentssticker_filled'), text)
    }

    // tweb :143-147 — при первом показе подписаться на тред и перечитать пост:
    // тред в окне мог устареть (офлайн-кэш, пост пришёл страницей истории до
    // новых комментариев). Неотправленному посту — нечего (`is_outgoing`).
    if (!this.updated && !isLocalMessageId(this.message.mid)) {
      void this.managers.messages?.subscribeRepliesThread?.(this.message.peerId, this.message.mid)
      // отказ сети — футер остаётся с тем тредом, что есть
      void Promise.resolve(this.managers.messages?.updateMessage?.(this.message.peerId, this.message.mid)).catch(() => {})
      this.updated = true
    }
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, RepliesElement)
}

/** Сборка футера — тело `MessageRender.renderReplies` (messageRender.ts:432-437). */
function createRepliesElement(options: RepliesElementOptions): RepliesElement {
  const { replies, peerId, mid, type, middleware, managers } = options
  const element = new RepliesElement()
  element.message = { peerId, mid, replies }
  element.type = type
  element.managers = managers
  element.middleware = middleware.create().get()
  element.init()
  return element
}

/**
 * Порт `MessageRender.renderReplies` (tweb messageRender.ts:420-440): выбрать
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
  // tweb messageRender.ts:429-431.
  const isFooter = !bubble.classList.contains('sticker') &&
    !bubble.classList.contains('emoji-big') &&
    !bubble.classList.contains('round')
  const type = isFooter ? 'footer' : 'beside'

  // Пересборка бабла правкой (`onMessageEdit`) у нас идёт на ЛЮБОЙ патч
  // сообщения (реакция, опрос, прочтение медиа), а у оригинала футер
  // пересоздаёт только настоящая правка (`safeRenderMessage`): тот же футер
  // того же поста переживает её — `render` на месте, без нового `updateMessage`
  // (`updated`) и без перезагрузки аватарок.
  const existing = bubbleContainer.querySelector<RepliesElement>(`:scope > ${TAG_NAME}[data-post-key="${rest.peerId}_${rest.mid}"]`)
  if (existing instanceof RepliesElement && existing.type === type) {
    existing.message = { peerId: rest.peerId, mid: rest.mid, replies: rest.replies }
    existing.render()
    if (existing.nextElementSibling) bubbleContainer.append(existing)
    return isFooter
  }

  bubbleContainer.querySelector(':scope > .replies')?.remove()
  bubbleContainer.append(createRepliesElement({ ...rest, type }))
  return isFooter
}

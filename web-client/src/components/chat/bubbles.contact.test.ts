// КОНТАКТ (визитка) в императивной ленте — порт ветки `case
// 'messageMediaContact'` (tweb bubbles.ts:8706-8755) и её ветки клика (:3174-3190).
//
// Пин ровно на дефект, ради которого задача: `renderMedia` выходил на
// `getBubbleMedia` (визитка файла не несёт), узла не было вовсе, и бабл
// схлопывался в нулевую высоту — наружу торчали только абсолютно
// спозиционированное время и кнопка пересылки. Поэтому проверяется РЕЗУЛЬТАТ:
// что видно в DOM и что уходит наружу по клику, — а не форма вызова.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import rootScope from '@lib/rootScope'
import type { MessageMediaContact } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const clipboard = vi.hoisted(() => ({ copyTextToClipboard: vi.fn(async () => {}) }))
vi.mock('@helpers/clipboard', () => clipboard)

const toast = vi.hoisted(() => ({ toastNew: vi.fn(), toast: vi.fn() }))
vi.mock('@components/toast', () => toast)

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

/** Дать очереди рендера разобраться. */
async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const CHAT = 71

const openPeer = vi.fn((_peerId: number, _element: HTMLElement) => true)

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
  navigation: { openPeer },
})

/** Вложение визитки в форме схемы — ровно то, что кладёт на провод
 *  `domain.NewMessageMediaContact` (`backend/internal/domain/mtmedia.go:474`):
 *  все пять параметров обязательные и едут всегда, в том числе пустыми. */
const contactMedia = (over: Partial<MessageMediaContact> = {}): MessageMediaContact => ({
  _: 'messageMediaContact',
  phone_number: '+79261234567',
  first_name: 'Боб',
  last_name: '',
  vcard: '',
  user_id: 42,
  ...over,
})

const contactMessage = (media: MessageMediaContact, text = ''): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id: 1, text, createdAt: '2026-08-15T12:00:00Z', media })

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clipboard.copyTextToClipboard.mockClear()
  toast.toastNew.mockClear()
  openPeer.mockClear()
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

const contactOf = (b: ChatBubbles, mid = 1) =>
  bubbleOf(b, mid).querySelector<HTMLElement>('.contact')!

/** Открыть ленту с одной визиткой. Контейнер ленты кладём в документ: ветка
 *  клика делегирована на него (`attachContainerListeners`). */
async function feedWith(media: MessageMediaContact, text = '') {
  const ctx = chatContext()
  document.body.append(ctx.container)
  const feed = new ChatBubbles(ctx, managersWith([contactMessage(media, text)]))
  await openFeed(feed)
  await settle()
  return feed
}

describe('ChatBubbles — контакт в ленте', () => {
  describe('отрисовка', () => {
    it('бабл визитки НЕ пустой: несёт .contact с именем, номером и аватаркой', async () => {
      bubbles = await feedWith(contactMedia())

      const bubble = bubbleOf(bubbles, 1)
      // Класс вида ставит `bubbleClasses` (tweb bubbles.ts:8751).
      expect(bubble.classList.contains('contact-message')).toBe(true)

      const contact = contactOf(bubbles)
      expect(contact).not.toBeNull()
      // Узел лежит В ТЕЛЕ — `messageDiv.append(contactDiv)` (:8752).
      const messageDiv = bubble.querySelector<HTMLElement>('.message')!
      expect(contact.parentElement).toBe(messageDiv)

      expect(contact.dataset.peerId).toBe('42')
      expect(contact.querySelector('.contact-name')!.textContent).toBe('Боб')
      expect(contact.querySelector('.contact-number')).not.toBeNull()
      // Аватарка 54 px впереди деталей (:8740-8748).
      expect(contact.firstElementChild!.classList.contains('avatar-54')).toBe(true)
      expect(contact.firstElementChild!.nextElementSibling!.className).toBe('contact-details')

      // Ровно тот дефект, ради которого задача: тело перестало быть пустым.
      // Высоты в happy-dom нет, поэтому пинуем её причину — наличие содержимого.
      expect(messageDiv.childElementCount).toBeGreaterThan(0)
    })

    it('время стоит ВНУТРИ бабла, а не рядом с соседним сообщением', async () => {
      bubbles = await feedWith(contactMedia())

      const bubble = bubbleOf(bubbles, 1)
      const time = bubble.querySelector<HTMLElement>('.time')!
      expect(time).not.toBeNull()
      expect(bubble.contains(time)).toBe(true)
      // Визитка — `mediaRequiresMessageDiv` (tweb :8750): тело не снимается,
      // значит и «плавающего» времени поверх медиа быть не должно.
      expect(bubble.classList.contains('is-message-empty')).toBe(false)
      expect(bubble.classList.contains('has-floating-time')).toBe(false)
    })

    it('номер группируется по коду страны (tweb :8730-8734)', async () => {
      bubbles = await feedWith(contactMedia())
      expect(contactOf(bubbles).querySelector('.contact-number')!.textContent)
        .toBe('+7 926 123 4567')
    })

    it('номера нет вовсе — строка оригинала «Unknown phone number» (:8729)', async () => {
      bubbles = await feedWith(contactMedia({ phone_number: '' }))
      expect(contactOf(bubbles).querySelector('.contact-number')!.textContent)
        .toBe('Unknown phone number')
    })

    it('имя склеивается из first_name и last_name, пустые отбрасываются (:8719-8722)', async () => {
      bubbles = await feedWith(contactMedia({ first_name: 'Боб', last_name: 'Иванов' }))
      expect(contactOf(bubbles).querySelector('.contact-name')!.textContent).toBe('Боб Иванов')
    })

    it('имени нет вовсе — подставляется ключ AttachContact (:8724)', async () => {
      bubbles = await feedWith(contactMedia({ first_name: '', last_name: '' }))
      const name = contactOf(bubbles).querySelector('.contact-name')!
      expect(name.textContent).not.toBe('')
      // Строка приезжает из словаря, а не литералом — узел несёт `.i18n`.
      expect(name.querySelector('.i18n')).not.toBeNull()
    })

    it('подпись сообщения остаётся НАД карточкой: визитка текст себе не забирает', async () => {
      // В отличие от опроса (:8760 обнуляет `messageMessage`) визитка этого не
      // делает — `messageDiv.append(contactDiv)` кладёт карточку ПОСЛЕ текста.
      bubbles = await feedWith(contactMedia(), 'Вот его телефон')

      const messageDiv = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
      const contact = contactOf(bubbles)
      expect(messageDiv.textContent).toContain('Вот его телефон')
      expect(contact.textContent).not.toContain('Вот его телефон')
      // Подпись стоит РАНЬШЕ карточки по документу. Сверяем именно порядок
      // узлов: текст лежит текстовыми узлами, и сравнение по `children` его
      // просто не увидело бы.
      const before = Array.from(messageDiv.childNodes)
        .slice(0, Array.from(messageDiv.childNodes).indexOf(contact))
        .map((n) => n.textContent ?? '')
        .join('')
      expect(before).toContain('Вот его телефон')
    })

    it('карточка переживает перерисовку тела и не исчезает', async () => {
      // `renderMessageContent` сносит из `.message` всё, чего нет в
      // `BODY_NOT_CONTENT`. Не будь `.contact` в списке, бабл после любой
      // правки возвращался бы в тот самый пустой вид.
      const media = contactMedia()
      bubbles = await feedWith(media)
      expect(contactOf(bubbles)).not.toBeNull()

      rootScope.dispatchEventSingle('message_edit', {
        storageKey: String(CHAT),
        peerId: CHAT,
        mid: 1,
        message: contactMessage(media),
      })
      await settle()

      expect(contactOf(bubbles)).not.toBeNull()
      expect(contactOf(bubbles).querySelector('.contact-name')!.textContent).toBe('Боб')
    })
  })

  describe('клик по карточке (tweb bubbles.ts:3174-3190)', () => {
    it('есть ключ пира — открывает его профиль', async () => {
      bubbles = await feedWith(contactMedia())

      contactOf(bubbles).click()

      expect(openPeer).toHaveBeenCalledTimes(1)
      expect(openPeer.mock.calls[0][0]).toBe(42)
      expect(clipboard.copyTextToClipboard).not.toHaveBeenCalled()
    })

    it('ключа пира нет — копирует ЦИФРЫ номера и показывает тост', async () => {
      bubbles = await feedWith(contactMedia({ user_id: 0 }))

      contactOf(bubbles).click()

      expect(openPeer).not.toHaveBeenCalled()
      // Пробелы группировки в буфер не попадают (:3184).
      expect(clipboard.copyTextToClipboard).toHaveBeenCalledWith('+79261234567')
      expect(toast.toastNew).toHaveBeenCalledWith({ langPackKey: 'PhoneCopied' })
    })

    it('клик по карточке не уводит в медиавьювер и не роняет ленту', async () => {
      bubbles = await feedWith(contactMedia({ user_id: 0 }))
      // Клик по вложенному узлу приходит с него же — ветка ищет `closest`.
      contactOf(bubbles).querySelector<HTMLElement>('.contact-number')!.click()
      expect(clipboard.copyTextToClipboard).toHaveBeenCalledTimes(1)
    })
  })
})

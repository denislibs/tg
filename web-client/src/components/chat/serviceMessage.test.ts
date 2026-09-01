// src/components/chat/serviceMessage.test.ts
//
// Ванильные сервисные сообщения (`serviceMessage.ts`). Пины:
//   (1) каркас: у ЭКШЕН-бабла обёртка `.bubble-content-wrapper` есть, у
//       ДАТА-разделителя её нет (живой DOM tweb — `docs/tweb/dom/dumps/
//       03-service-round.json` и `03-bubbles-123.json`);
//   (2) каждый конструктор действия, который умеет `core/serviceMsg.ts::
//       serviceMsgSegs`, даёт ожидаемую последовательность узлов;
//   (3) имя пира — `span.peer-title[data-peer-id]`, ссылка на закреплённое —
//       `i[data-saved-from="peerId_mid"]`; ни у одного узла нет `on*`-атрибута
//       (клик вешает лента делегированием, как tweb bubbles.ts:3360-3395);
//   (4) пользовательский текст НЕ интерпретируется как разметка.
//
// Вход узла — САМО служебное сообщение (`messageService`), а не строка с JSON
// внутри текста: дискриминатор больше не подделан ни разу, ветвление идёт по
// `_`. Вместе с JSON у теста исчезли два кейса — «готовая строка (не JSON)» и
// «битый JSON»: разбирать больше нечего, разобранное объединение приезжает
// типом. Их место занял кейс `default` (конструктор, ветки для которого нет).
import { describe, expect, it } from 'vitest'
import I18n from '@lib/langPack'
import { dayLabel } from '@core/format/dayLabel'
import { createDateBubble, createServiceBubble, wrapMessageActionText } from './serviceMessage'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps } from '@core/peerCache'
import { UNSUPPORTED_ACTION } from '@core/serviceMsg'
import { makeServiceMessage } from '@core/messages/testMessage'
import type { MessageAction } from '@core/messages/messageAction'
import type { MessageService } from '@core/models'

const PEER = 50

// Имена пиров узел берёт из зеркала карточек — в действии их больше нет
// (в схеме едут ССЫЛКИ: `messageActionChatAddUser users:Vector<long>`). Поэтому
// фикстура ЗАСЕЛЯЕТ зеркало, а не подсовывает готовое имя: раньше тесты кормили
// поле `actor`, которого на проводе уже не существовало, и потому не краснели,
// когда пилюли в бою стали читаться «Пользователь добавил(а) пользователя».
applyPeerOps([
  { op: 'upsert', peers: [
    { _: 'user', id: 5, first_name: 'Аня', pFlags: {} },
    { _: 'user', id: 6, first_name: 'Боря', pFlags: {} },
    { _: 'channel', id: 8, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } },
  ] },
])

/** Зона актуальности узлов имени: в бою её даёт бабл, здесь — тест. */
const deps = () => ({
  middleware: getMiddleware().get(),
  managers: { peers: { fillMirror: async () => {} } },
})

/** Пилюля от Ани в чате PEER. `out` — «Вы …» вместо имени (флаг сервера). */
const pill = (action: MessageAction, over: { out?: boolean; replyToMsgId?: number } = {}): MessageService =>
  makeServiceMessage({ id: 7, peerId: PEER, fromId: 5, date: 1781898326, action, ...over })

/** Фраза как список узлов: `текст`, `peer#id:текст`, `msg#savedFrom:текст`. */
function phrase(message: MessageService, pinnedPreview?: string): string[] {
  const span = wrapMessageActionText({ message, pinnedPreview, peerId: PEER, ...deps() })
  expect(span.tagName).toBe('SPAN')
  expect(span.className).toBe('i18n')
  return Array.from(span.childNodes).map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    const el = node as HTMLElement
    if (el.classList.contains('peer-title')) return `peer#${el.dataset.peerId}:${el.textContent}`
    if (el.tagName === 'I') return `msg#${el.dataset.savedFrom ?? '-'}:${el.textContent}`
    return `${el.tagName.toLowerCase()}.${el.className}:${el.textContent}`
  })
}

/** Все элементы поддерева, включая корень. */
const allElements = (root: Element) => [root, ...Array.from(root.querySelectorAll('*'))]

describe('createServiceBubble — каркас экшен-бабла 1:1 с tweb', () => {
  const bubble = createServiceBubble({
    ...deps(),
    message: pill({ _: 'messageActionChatCreate', title: 'Наш чат', users: [5] }),
    peerId: PEER,
    mid: 7,
    timestamp: 1781898326,
  })

  it('корень — .bubble.service БЕЗ классов группировки (их вешает bubbleGroups)', () => {
    expect(bubble.className).toBe('bubble service')
  })

  it('вложенность .bubble-content-wrapper > .bubble-content > .service-msg > span.i18n', () => {
    const wrapper = bubble.firstElementChild!
    expect(bubble.children).toHaveLength(1)
    expect(wrapper.className).toBe('bubble-content-wrapper')

    const content = wrapper.firstElementChild!
    expect(wrapper.children).toHaveLength(1)
    expect(content.className).toBe('bubble-content')

    const serviceMsg = content.firstElementChild!
    expect(content.children).toHaveLength(1)
    expect(serviceMsg.className).toBe('service-msg')

    const i18n = serviceMsg.firstElementChild!
    expect(serviceMsg.children).toHaveLength(1)
    expect(i18n.tagName).toBe('SPAN')
    expect(i18n.className).toBe('i18n')
    expect(i18n.textContent).toBe('Аня создал(а) группу «Наш чат»')
  })

  it('data-mid / data-peer-id / data-timestamp несёт сам .bubble', () => {
    expect(bubble.dataset.mid).toBe('7')
    expect(bubble.dataset.peerId).toBe('50')
    expect(bubble.dataset.timestamp).toBe('1781898326')
  })

  it('необязательные атрибуты не выдумываются: без mid/timestamp их нет', () => {
    const bare = createServiceBubble({ ...deps(), message: pill({ _: 'messageActionChatLeave', user_id: 5 }), peerId: PEER })
    expect(bare.hasAttribute('data-mid')).toBe(false)
    expect(bare.hasAttribute('data-timestamp')).toBe(false)
    expect(bare.dataset.peerId).toBe('50')
  })
})

describe('createDateBubble — дата-разделитель 1:1 с tweb', () => {
  // Подпись приезжает сюда ГОТОВЫМ УЗЛОМ ядра, как у оригинала (:4789-4798), —
  // здесь берётся тот же `dayLabel`, что зовёт лента.
  const bubble = createDateBubble(dayLabel(new Date('2026-07-19T00:00:00').getTime()))

  it('.bubble.service.is-date, обёртки .bubble-content-wrapper НЕТ', () => {
    expect(bubble.className).toBe('bubble service is-date')
    expect(bubble.querySelector('.bubble-content-wrapper')).toBeNull()
  })

  it('вложенность .bubble-content > .service-msg > span.i18n с подписью дня', () => {
    const content = bubble.firstElementChild!
    expect(bubble.children).toHaveLength(1)
    expect(content.className).toBe('bubble-content')

    const serviceMsg = content.firstElementChild!
    expect(content.children).toHaveLength(1)
    expect(serviceMsg.className).toBe('service-msg')

    const label = serviceMsg.firstElementChild!
    expect(serviceMsg.children).toHaveLength(1)
    expect(label.tagName).toBe('SPAN')
    expect(label.className).toBe('i18n')
    // Класс НАСТОЯЩИЙ: узел записан в `weakMap`, и `applyLangPack` его найдёт и
    // перепишет. Прежде этот `span.i18n` создавал сам `createDateBubble` вокруг
    // строки — класс был, записи в `weakMap` не было, обход молча пропускал узел.
    expect(I18n.weakMap.get(label as HTMLElement)).toBeDefined()
    expect(label.textContent).toBe('July 19')
  })

  it('у экшен-бабла обёртка ЕСТЬ — это и есть разница двух сервисных баблов', () => {
    const actionBubble = createServiceBubble({ ...deps(), message: pill({ _: 'messageActionChatLeave', user_id: 5 }), peerId: PEER })
    expect(actionBubble.querySelector('.bubble-content-wrapper')).not.toBeNull()
    expect(actionBubble.querySelector('.bubble-content-wrapper > .bubble-content > .service-msg')).not.toBeNull()
  })
})

describe('wrapMessageActionText — по одному на конструктор действия', () => {
  it('messageActionChatCreate — название группы ЕДЕТ в действии', () => {
    expect(phrase(pill({ _: 'messageActionChatCreate', title: 'Наш чат', users: [6] })))
      .toEqual(['peer#5:Аня', ' создал(а) группу «Наш чат»'])
  })

  it('messageActionChatAddUser — два имени пиров', () => {
    expect(phrase(pill({ _: 'messageActionChatAddUser', users: [6] })))
      .toEqual(['peer#5:Аня', ' добавил(а) ', 'peer#6:Боря'])
  })

  it('messageActionChatDeleteUser', () => {
    expect(phrase(pill({ _: 'messageActionChatDeleteUser', user_id: 6 })))
      .toEqual(['peer#5:Аня', ' удалил(а) ', 'peer#6:Боря'])
  })

  it('messageActionChatLeave — синтетический конструктор уточнения', () => {
    expect(phrase(pill({ _: 'messageActionChatLeave', user_id: 5 })))
      .toEqual(['peer#5:Аня', ' покинул(а) группу'])
  })

  it('messageActionChatJoinedByLink — приглашающий едет ссылкой', () => {
    expect(phrase(pill({ _: 'messageActionChatJoinedByLink', inviter_id: 6 })))
      .toEqual(['peer#5:Аня', ' присоединился(ась) к группе по ссылке-приглашению от ', 'peer#6:Боря'])
  })

  it('messageActionChatEditPhoto', () => {
    expect(phrase(pill({ _: 'messageActionChatEditPhoto' })))
      .toEqual(['peer#5:Аня', ' обновил(а) фото группы'])
  })

  it('messageActionChatEditTitle — новое название ЕДЕТ', () => {
    expect(phrase(pill({ _: 'messageActionChatEditTitle', title: 'Новое' })))
      .toEqual(['peer#5:Аня', ' изменил(а) название группы на «Новое»'])
  })

  it('messageActionPinMessage с превью — превью едет узлом i[data-saved-from]', () => {
    // У самого действия параметров НЕТ ВОВСЕ: цель находится по `reply_to`,
    // превью собирает вызывающий (у него есть окно).
    expect(phrase(pill({ _: 'messageActionPinMessage' }, { replyToMsgId: 7 }), 'Привет'))
      .toEqual(['peer#5:Аня', ' закрепил(а) "', 'msg#50_7:Привет', '"'])
  })

  it('messageActionPinMessage без превью — узла ссылки нет вовсе', () => {
    expect(phrase(pill({ _: 'messageActionPinMessage' }, { replyToMsgId: 7 })))
      .toEqual(['peer#5:Аня', ' закрепил(а) сообщение'])
  })

  it('messageActionSetMessagesTTL — включение и отключение', () => {
    expect(phrase(pill({ _: 'messageActionSetMessagesTTL', period: 86400 })))
      .toEqual(['peer#5:Аня', ' включил(а) автоудаление сообщений через 1 день'])
    expect(phrase(pill({ _: 'messageActionSetMessagesTTL', period: 0 })))
      .toEqual(['peer#5:Аня', ' отключил(а) автоудаление сообщений'])
  })

  it('messageActionSuggestProfilePhoto — «Вы …» решает pFlags.out самого сообщения', () => {
    expect(phrase(pill({ _: 'messageActionSuggestProfilePhoto' }, { out: true })))
      .toEqual(['Вы предложили установить это фото профиля'])
    expect(phrase(pill({ _: 'messageActionSuggestProfilePhoto' })))
      .toEqual(['peer#5:Аня', ' предлагает вам установить это фото профиля'])
  })

  it('messageActionSuggestedPostApproval — канал едет ССЫЛКОЙ, имя берётся из зеркала', () => {
    // `channel_id` — ЗНАКОВЫЙ ключ пира (у чата он отрицательный), а не голый id.
    expect(phrase(pill({ _: 'messageActionSuggestedPostApproval', channel_id: -8 })))
      .toEqual(['Ваш предложенный пост одобрен в канале ', 'peer#-8:Канал'])
    expect(phrase(pill({ _: 'messageActionSuggestedPostApproval', pFlags: { rejected: true } })))
      .toEqual(['Ваш предложенный пост отклонён'])
  })

  it('конструктор без ветки — честная заглушка, а не служебная кишка в пилюле', () => {
    expect(phrase(pill({ _: 'messageActionTotallyUnknown' } as unknown as MessageAction)))
      .toEqual([UNSUPPORTED_ACTION])
  })

  it('имя без ссылки — data-peer-id = "0" (tweb NULL_PEER_ID), узел остаётся кликабельной целью', () => {
    const noAuthor = makeServiceMessage({ id: 7, peerId: PEER, action: { _: 'messageActionChatAddUser', users: [] } })
    expect(phrase(noAuthor)).toEqual(['peer#0:Пользователь', ' добавил(а) '])
  })

  it('эмодзи превью едет через ванильный rich-text, а не сырым текстом', () => {
    // Превью аудио начинается с 🎵 (его собирает вызывающий, messageForReply) —
    // узел эмодзи рисует wrapRichText (.emoji), как tweb рисует его wrapEmojiText.
    const span = wrapMessageActionText({
      message: pill({ _: 'messageActionPinMessage' }, { replyToMsgId: 7 }),
      pinnedPreview: '🎵 Song',
      peerId: PEER,
      ...deps(),
    })
    const link = span.querySelector('i')!
    expect(link.dataset.savedFrom).toBe('50_7')
    expect(link.querySelector('.emoji')).not.toBeNull()
  })
})

describe('клики — только data-разметка, ни одного inline-обработчика', () => {
  const message = pill({ _: 'messageActionPinMessage' }, { replyToMsgId: 7 })
  const opts = () => ({ message, pinnedPreview: 'Привет', peerId: PEER, ...deps() })

  it('имя пира несёт data-peer-id и dir="auto" (tweb PeerTitle)', () => {
    const peerTitle = createServiceBubble(opts()).querySelector<HTMLElement>('.peer-title')!
    expect(peerTitle.tagName).toBe('SPAN')
    expect(peerTitle.dataset.peerId).toBe('5')
    expect(peerTitle.getAttribute('dir')).toBe('auto')
  })

  it('ссылка на сообщение — i[data-saved-from="peerId_mid"] (tweb wrapLinkToMessage)', () => {
    const link = createServiceBubble(opts()).querySelector<HTMLElement>('i')!
    expect(link.dataset.savedFrom).toBe('50_7')
    expect(link.getAttribute('dir')).toBe('auto')
  })

  it('ни у одного узла бабла и разделителя нет атрибута on*', () => {
    for (const root of [createServiceBubble(opts()), createDateBubble(dayLabel(0))]) {
      for (const el of allElements(root)) {
        const inline = el.getAttributeNames().filter((name) => name.toLowerCase().startsWith('on'))
        expect(inline).toEqual([])
      }
    }
  })
})

describe('безопасность — пользовательский текст не разметка', () => {
  // Опасное имя приезжает КАРТОЧКОЙ ПИРА, а не полем действия: имён на проводе
  // действия больше нет, значит и проверять надо тот путь, по которому имя
  // реально попадает в узел.
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 9, first_name: '<script>alert(1)</script>', pFlags: {} }] }])
  const message = makeServiceMessage({
    id: 7, peerId: PEER, fromId: 9, replyToMsgId: 7,
    action: { _: 'messageActionPinMessage' },
  })
  const opts = () => ({ message, pinnedPreview: '<img src=x onerror=alert(2)>', peerId: PEER, ...deps() })

  it('имя пира с тегами остаётся текстом', () => {
    const bubble = createServiceBubble(opts())
    const peerTitle = bubble.querySelector<HTMLElement>('.peer-title')!

    expect(peerTitle.textContent).toBe('<script>alert(1)</script>')
    expect(Array.from(peerTitle.childNodes).every((n) => n.nodeType === Node.TEXT_NODE)).toBe(true)
    expect(bubble.querySelector('script')).toBeNull()
  })

  it('текст закреплённого с тегами остаётся текстом, обработчик не всплывает атрибутом', () => {
    const bubble = createServiceBubble(opts())
    const link = bubble.querySelector<HTMLElement>('i')!

    expect(link.textContent).toBe('<img src=x onerror=alert(2)>')
    expect(bubble.querySelector('img')).toBeNull()
    for (const el of allElements(bubble)) {
      expect(el.getAttributeNames().some((name) => name.toLowerCase().startsWith('on'))).toBe(false)
    }
  })

  // Прежний пин здесь проверял, что подпись дня с тегами остаётся текстом:
  // `createDateBubble` принимал СТРОКУ и клал её в `textContent`. Строкового
  // входа у него больше нет вовсе — аргумент это `HTMLElement`, который строит
  // ядро (`i18n`/`formatDate`), поэтому проверять стало нечего: поверхности, на
  // которой жил вопрос, не существует. Что подпись именно узел ядра, держит пин
  // в describe выше (`I18n.weakMap.get(label)`).
})

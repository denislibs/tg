// src/components/chat/serviceMessage.test.ts
//
// Ванильные сервисные сообщения (`serviceMessage.ts`). Пины:
//   (1) каркас: у ЭКШЕН-бабла обёртка `.bubble-content-wrapper` есть, у
//       ДАТА-разделителя её нет (живой DOM tweb — `docs/tweb/dom/dumps/
//       03-service-round.json` и `03-bubbles-123.json`);
//   (2) каждый тип экшена, который умеет `core/serviceMsg.ts::serviceMsgSegs`,
//       даёт ожидаемую последовательность узлов;
//   (3) имя пира — `span.peer-title[data-peer-id]`, ссылка на закреплённое —
//       `i[data-saved-from="peerId_mid"]`; ни у одного узла нет `on*`-атрибута
//       (клик вешает лента делегированием, как tweb bubbles.ts:3360-3395);
//   (4) пользовательский текст НЕ интерпретируется как разметка.
import { describe, expect, it } from 'vitest'
import { createDateBubble, createServiceBubble, wrapMessageActionText } from './serviceMessage'

const PEER = 50

const action = (a: Record<string, unknown>) => JSON.stringify(a)

/** Фраза как список узлов: `текст`, `peer#id:текст`, `msg#savedFrom:текст`. */
function phrase(raw: string, out?: boolean): string[] {
  const span = wrapMessageActionText({ raw, out, peerId: PEER })
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
    raw: action({ action: 'group_create', actor: 'Аня', actor_id: 5 }),
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
    expect(i18n.textContent).toBe('Аня создал(а) группу')
  })

  it('data-mid / data-peer-id / data-timestamp несёт сам .bubble', () => {
    expect(bubble.dataset.mid).toBe('7')
    expect(bubble.dataset.peerId).toBe('50')
    expect(bubble.dataset.timestamp).toBe('1781898326')
  })

  it('необязательные атрибуты не выдумываются: без mid/timestamp их нет', () => {
    const bare = createServiceBubble({ raw: 'Чат создан', peerId: PEER })
    expect(bare.hasAttribute('data-mid')).toBe(false)
    expect(bare.hasAttribute('data-timestamp')).toBe(false)
    expect(bare.dataset.peerId).toBe('50')
  })
})

describe('createDateBubble — дата-разделитель 1:1 с tweb', () => {
  const bubble = createDateBubble('19 июля')

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

    const i18n = serviceMsg.firstElementChild!
    expect(serviceMsg.children).toHaveLength(1)
    expect(i18n.tagName).toBe('SPAN')
    expect(i18n.className).toBe('i18n')
    expect(i18n.textContent).toBe('19 июля')
  })

  it('у экшен-бабла обёртка ЕСТЬ — это и есть разница двух сервисных баблов', () => {
    const actionBubble = createServiceBubble({ raw: 'Чат создан', peerId: PEER })
    expect(actionBubble.querySelector('.bubble-content-wrapper')).not.toBeNull()
    expect(actionBubble.querySelector('.bubble-content-wrapper > .bubble-content > .service-msg')).not.toBeNull()
  })
})

describe('wrapMessageActionText — по одному на тип экшена serviceMsgSegs', () => {
  it('group_create', () => {
    expect(phrase(action({ action: 'group_create', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' создал(а) группу'])
  })

  it('add_user — два имени пиров', () => {
    expect(phrase(action({ action: 'add_user', actor: 'Аня', actor_id: 5, user: 'Боря', user_id: 6 })))
      .toEqual(['peer#5:Аня', ' добавил(а) ', 'peer#6:Боря'])
  })

  it('kick_user', () => {
    expect(phrase(action({ action: 'kick_user', actor: 'Аня', actor_id: 5, user: 'Боря', user_id: 6 })))
      .toEqual(['peer#5:Аня', ' удалил(а) ', 'peer#6:Боря'])
  })

  it('leave', () => {
    expect(phrase(action({ action: 'leave', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' покинул(а) группу'])
  })

  it('joined_by_link', () => {
    expect(phrase(action({ action: 'joined_by_link', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' присоединился(ась) к группе по ссылке-приглашению'])
  })

  it('edit_photo', () => {
    expect(phrase(action({ action: 'edit_photo', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' обновил(а) фото группы'])
  })

  it('edit_title', () => {
    expect(phrase(action({ action: 'edit_title', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' изменил(а) название группы'])
  })

  it('pin_message с превью — превью едет узлом i[data-saved-from]', () => {
    expect(phrase(action({
      action: 'pin_message', actor: 'Аня', actor_id: 5,
      msg_id: 7, msg_seq: 12, msg_type: 'text', msg_text: 'Привет',
    }))).toEqual(['peer#5:Аня', ' закрепил(а) "', 'msg#50_7:Привет', '"'])
  })

  it('pin_message без превью — узла ссылки нет вовсе', () => {
    expect(phrase(action({ action: 'pin_message', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' закрепил(а) сообщение'])
  })

  it('set_ttl — включение и отключение', () => {
    expect(phrase(action({ action: 'set_ttl', actor: 'Аня', actor_id: 5, ttl: 86400 })))
      .toEqual(['peer#5:Аня', ' включил(а) автоудаление сообщений через 1 день'])
    expect(phrase(action({ action: 'set_ttl', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' отключил(а) автоудаление сообщений'])
  })

  it('suggest_photo — «Вы …» у себя, имя пира у получателя', () => {
    expect(phrase(action({ action: 'suggest_photo', actor: 'Аня', actor_id: 5 }), true))
      .toEqual(['Вы предложили установить это фото профиля'])
    expect(phrase(action({ action: 'suggest_photo', actor: 'Аня', actor_id: 5 })))
      .toEqual(['peer#5:Аня', ' предлагает вам установить это фото профиля'])
  })

  it('suggest_post_approved / suggest_post_rejected — одним текстовым узлом', () => {
    expect(phrase(action({ action: 'suggest_post_approved', chat: 'Канал' })))
      .toEqual(['Ваш предложенный пост одобрен в канале «Канал»'])
    expect(phrase(action({ action: 'suggest_post_rejected' })))
      .toEqual(['Ваш предложенный пост отклонён'])
  })

  it('готовая строка (не JSON) и битый JSON — текст как есть', () => {
    expect(phrase('Чат создан')).toEqual(['Чат создан'])
    expect(phrase('{битый')).toEqual(['{битый'])
  })

  it('неизвестный экшен — тоже текст, без выдуманных узлов', () => {
    const raw = action({ action: 'no_such_action' })
    expect(phrase(raw)).toEqual([raw])
  })

  it('имя без peerId — data-peer-id = "0" (tweb NULL_PEER_ID), узел остаётся кликабельной целью', () => {
    expect(phrase(action({ action: 'add_user', actor: 'Аня' })))
      .toEqual(['peer#0:Аня', ' добавил(а) ', 'peer#0:пользователя'])
  })

  it('эмодзи превью едет через ванильный rich-text, а не сырым текстом', () => {
    // Превью аудио начинается с 🎵 (core/serviceMsg::pinPreview) — узел эмодзи
    // рисует wrapRichText (.emoji), как tweb рисует его через wrapEmojiText.
    const span = wrapMessageActionText({
      raw: action({ action: 'pin_message', actor: 'Аня', actor_id: 5, msg_id: 7, msg_type: 'audio', msg_name: 'Song' }),
      peerId: PEER,
    })
    const link = span.querySelector('i')!
    expect(link.dataset.savedFrom).toBe('50_7')
    expect(link.querySelector('.emoji')).not.toBeNull()
  })
})

describe('клики — только data-разметка, ни одного inline-обработчика', () => {
  const raw = action({
    action: 'pin_message', actor: 'Аня', actor_id: 5,
    msg_id: 7, msg_seq: 12, msg_type: 'text', msg_text: 'Привет',
  })

  it('имя пира несёт data-peer-id и dir="auto" (tweb PeerTitle)', () => {
    const peerTitle = createServiceBubble({ raw, peerId: PEER }).querySelector<HTMLElement>('.peer-title')!
    expect(peerTitle.tagName).toBe('SPAN')
    expect(peerTitle.dataset.peerId).toBe('5')
    expect(peerTitle.getAttribute('dir')).toBe('auto')
  })

  it('ссылка на сообщение — i[data-saved-from="peerId_mid"] (tweb wrapLinkToMessage)', () => {
    const link = createServiceBubble({ raw, peerId: PEER }).querySelector<HTMLElement>('i')!
    expect(link.dataset.savedFrom).toBe('50_7')
    expect(link.getAttribute('dir')).toBe('auto')
  })

  it('ни у одного узла бабла и разделителя нет атрибута on*', () => {
    for (const root of [createServiceBubble({ raw, peerId: PEER }), createDateBubble('19 июля')]) {
      for (const el of allElements(root)) {
        const inline = el.getAttributeNames().filter((name) => name.toLowerCase().startsWith('on'))
        expect(inline).toEqual([])
      }
    }
  })
})

describe('безопасность — пользовательский текст не разметка', () => {
  const raw = action({
    action: 'pin_message',
    actor: '<script>alert(1)</script>',
    actor_id: 5,
    msg_id: 7,
    msg_type: 'text',
    msg_text: '<img src=x onerror=alert(2)>',
  })

  it('имя пира с тегами остаётся текстом', () => {
    const bubble = createServiceBubble({ raw, peerId: PEER })
    const peerTitle = bubble.querySelector<HTMLElement>('.peer-title')!

    expect(peerTitle.textContent).toBe('<script>alert(1)</script>')
    expect(Array.from(peerTitle.childNodes).every((n) => n.nodeType === Node.TEXT_NODE)).toBe(true)
    expect(bubble.querySelector('script')).toBeNull()
  })

  it('текст закреплённого с тегами остаётся текстом, обработчик не всплывает атрибутом', () => {
    const bubble = createServiceBubble({ raw, peerId: PEER })
    const link = bubble.querySelector<HTMLElement>('i')!

    expect(link.textContent).toBe('<img src=x onerror=alert(2)>')
    expect(bubble.querySelector('img')).toBeNull()
    for (const el of allElements(bubble)) {
      expect(el.getAttributeNames().some((name) => name.toLowerCase().startsWith('on'))).toBe(false)
    }
  })

  it('подпись дня с тегами остаётся текстом', () => {
    const bubble = createDateBubble('<b>19 июля</b>')
    expect(bubble.textContent).toBe('<b>19 июля</b>')
    expect(bubble.querySelector('b')).toBeNull()
  })
})

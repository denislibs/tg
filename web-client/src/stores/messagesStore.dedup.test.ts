// Пины `dedupAsc` (messagesStore.ts:54-58): окно схлопывает список по seq через
// Map ("побеждает последний вставленный") и сортирует по возрастанию seq. Это
// поведение — один из инвариантов, который обязан пережить переезд домена
// сообщений на replay операций из воркера (порт mirror-протокола tweb). Тесты
// фиксируют ТЕКУЩЕЕ поведение как оно читается из кода, а не желаемое.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore, winKey } from './messagesStore'
import type { Message } from '../core/models'

const CHAT = 11

function msg(seq: number, id: number, text = `m${seq}`): Message {
  return {
    id, chatId: CHAT, seq, senderId: 1, type: 'text', text,
    replyToId: null, mediaId: null, createdAt: '2026-08-10T10:00:00Z', threadRootId: null,
  }
}

function bubbles() {
  return useMessagesStore.getState().byKey[winKey(CHAT)].msgs
}

describe('messagesStore: пины дедупа окна по seq (dedupAsc)', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
  })

  // Что ломается, если гарантия нарушена: если бы Map(seq -> Message) отдавал
  // приоритет ПЕРВОЙ вставке (а не последней), в окне после setWindow осталось
  // бы "старое" сообщение (id=1) вместо "нового" (id=2) — сообщение, реально
  // пришедшее последним с сервера, потерялось бы молча.
  it('setWindow: два сообщения с одинаковым seq, разными id → остаётся ПОСЛЕДНЕЕ вставленное', () => {
    const a = msg(5, 1, 'first')
    const b = msg(5, 2, 'second')
    useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: [a, b], reachedTop: true, reachedBottom: true })
    const msgs = bubbles()
    expect(msgs).toHaveLength(1)
    // Осознанно пинится текущая семантика Map: bySeq.set(m.seq, m) в порядке
    // прохода массива — выигрывает ПОСЛЕДНИЙ элемент с этим seq (b), не первый (a).
    expect(msgs[0].id).toBe(2)
    expect(msgs[0].text).toBe('second')
  })

  // Что ломается, если гарантия нарушена: без дедупа append/prepend с
  // пересекающимся диапазоном seq дал бы дубли бабла на экране (одно и то же
  // сообщение дважды — например, после reconnect и повторной подгрузки страницы
  // истории, которая частично перекрывает уже загруженную).
  it('append/prepend с пересечением по seq → без дублей, порядок по возрастанию seq', () => {
    const store = useMessagesStore.getState()
    store.setWindow(winKey(CHAT), { msgs: [msg(3, 3), msg(4, 4), msg(5, 5)], reachedTop: false, reachedBottom: true })
    // append: dedupAsc([...w.msgs, ...msgs]) — новые сообщения идут ПОСЛЕ окна
    // в проходе Map, значит на пересечении побеждает новая версия (append несёт
    // более свежую версию сообщения этого seq, напр. дозагрузку с сервера).
    store.append(winKey(CHAT), [msg(5, 50, 'server-5'), msg(6, 6)], true)
    // prepend: dedupAsc([...msgs, ...w.msgs]) — новые сообщения идут ПЕРЕД окном,
    // значит на пересечении побеждает уже бывшее в окне (обратная асимметрия —
    // пин именно этого порядка, а не «более свежая версия всегда побеждает»).
    store.prepend(winKey(CHAT), [msg(1, 1), msg(2, 2), msg(3, 30, 'older-page-3')], true)
    const msgs = bubbles()
    expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(msgs.find((m) => m.seq === 5)!.text).toBe('server-5')
    expect(msgs.find((m) => m.seq === 3)!.text).toBe('m3')
  })

  // Что ломается, если гарантия нарушена: appendLocal используется для локальной
  // вставки одного сообщения (напр. эхо своей отправки без прохода через
  // applyIncoming); если бы дедуп по seq не работал здесь, повторная вставка с
  // уже занятым seq создавала бы дубль-бабл вместо замены существующего.
  it('appendLocal с уже существующим seq → замена, а не дубль', () => {
    const store = useMessagesStore.getState()
    store.setWindow(winKey(CHAT), { msgs: [msg(3, 3, 'old')], reachedTop: true, reachedBottom: true })
    store.appendLocal(winKey(CHAT), msg(3, 33, 'new'))
    const msgs = bubbles()
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(33)
    expect(msgs[0].text).toBe('new')
  })

  // Что ломается, если гарантия нарушена: если бы dedupAsc не сортировал (или
  // сортировал по чему-то другому, напр. по порядку вставки), лента сообщений
  // отрисовывалась бы вперемешку — сообщения не по хронологии.
  it('вставка вперемешку → на выходе строго возрастающий seq', () => {
    const store = useMessagesStore.getState()
    store.setWindow(winKey(CHAT), { msgs: [msg(5, 5), msg(1, 1), msg(3, 3)], reachedTop: true, reachedBottom: true })
    const seqs = bubbles().map((m) => m.seq)
    expect(seqs).toEqual([1, 3, 5])
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
  })
})

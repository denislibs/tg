// Task 4 (страховочная сетка перед replay-рефактором): пины tentativeSeq —
// appendOptimistic присваивает баблу seq = maxSeq + 1 (messagesStore.ts:~224),
// dedupAsc схлопывает список по seq, где последний вставленный побеждает
// (messagesStore.ts:~54). Один тест здесь фиксирует ИЗВЕСТНЫЙ ДЕФЕКТ (не
// желаемое поведение!) — коллизия tentativeSeq с seq чужого входящего съедает
// оптимистичный бабл; чинит это задача 5. Остальные два — пины на здоровые
// сценарии (два оптимистичных подряд, ack одного не ломает другой).
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { Message } from '../core/models'

const CHAT = 9
const ME = 1
const OTHER = 2

function seedMsg(seq: number, id: number): Message {
  return {
    id, chatId: CHAT, seq, senderId: OTHER, type: 'text', text: 'seed',
    replyToId: null, mediaId: null, createdAt: '2026-08-10T09:00:00Z', threadRootId: null,
  }
}

// Чужое входящее (НЕ эхо своей отправки) — без clientId, как реальный new_message
// от другого пользователя.
function foreignIncoming(seq: number, id: number): Message {
  return {
    id, chatId: CHAT, seq, senderId: OTHER, type: 'text', text: 'their message',
    replyToId: null, mediaId: null, createdAt: '2026-08-10T09:00:05Z', threadRootId: null,
  }
}

function bubbles() {
  return useMessagesStore.getState().byKey[String(CHAT)].msgs
}

describe('tentativeSeq pins', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
  })

  it('ДЕФЕКТ (см. задачу 5): чужое входящее с тем же tentativeSeq стирает оптимистичный бабл', () => {
    const st = useMessagesStore.getState()
    st.setWindow(String(CHAT), { msgs: [seedMsg(10, 500)], reachedTop: true, reachedBottom: true })
    st.appendOptimistic(String(CHAT), 'my draft', ME, 'c-opt')

    // До коллизии: seed(seq=10) + оптимистичный бабл (tentativeSeq=11).
    expect(bubbles()).toHaveLength(2)
    expect(bubbles().some((m) => m.clientId === 'c-opt')).toBe(true)

    // Чужое входящее занимает тот же seq=11, что и tentativeSeq оптимистичного бабла.
    st.applyIncoming(CHAT, foreignIncoming(11, 501))

    // ФАКТИЧЕСКИЙ (дефектный) результат: dedupAsc схлопывает по seq — последний
    // вставленный (чужое входящее) побеждает над оптимистичным баблом. Проверяем
    // не просто длину окна, а КТО именно остался на месте seq=11.
    expect(bubbles()).toHaveLength(2)
    const atSeq11 = bubbles().find((m) => m.seq === 11)
    expect(atSeq11?.id).toBe(501) // выжило чужое входящее...
    expect(atSeq11?.clientId).toBeUndefined() // ...а не оптимистичный бабл
    expect(bubbles().some((m) => m.clientId === 'c-opt')).toBe(false) // бабл потерян

    // Наблюдаемо для пользователя: он отправил сообщение, оно на миг появилось,
    // а затем БЕЗ ack/error молча исчезло с экрана — заменено чужим сообщением.
  })

  it('два оптимистичных подряд без ack между ними: оба присутствуют, seq различны', () => {
    const st = useMessagesStore.getState()
    st.appendOptimistic(String(CHAT), 'first', ME, 'c1')
    st.appendOptimistic(String(CHAT), 'second', ME, 'c2')

    const list = bubbles()
    expect(list).toHaveLength(2)
    const c1 = list.find((m) => m.clientId === 'c1')
    const c2 = list.find((m) => m.clientId === 'c2')
    expect(c1).toBeTruthy()
    expect(c2).toBeTruthy()
    // что ломается: если appendOptimistic перестанет учитывать уже добавленный
    // первый бабл при расчёте maxSeq — второй получит тот же tentativeSeq, что и
    // первый, и dedupAsc схлопнет их в один (тот же класс бага, что и в тесте выше,
    // только между двумя СВОИМИ баблами).
    expect(c2!.seq).toBe(c1!.seq + 1)
  })

  it('ack первого не ломает второй: второй бабл на месте, его clientId цел', () => {
    const st = useMessagesStore.getState()
    st.appendOptimistic(String(CHAT), 'first', ME, 'c1')
    st.appendOptimistic(String(CHAT), 'second', ME, 'c2')

    st.reconcileAckByClient('c1', { msgId: 900, seq: 50, createdAt: '2026-08-10T09:00:10Z' })

    const list = bubbles()
    // что ломается: если reconcileAckByClient задевал бы соседние бабла (например,
    // матчился не строго по clientId, а по позиции/seq) — второй бабл пропал бы
    // или потерял clientId, ломая React-ключ и подхват последующего ack/echo.
    expect(list).toHaveLength(2)
    const c2 = list.find((m) => m.clientId === 'c2')
    expect(c2).toBeTruthy()
    expect(c2!.id).toBeLessThan(0) // всё ещё оптимистичный (временный отрицательный id)

    const acked = list.find((m) => m.clientId === 'c1')
    expect(acked?.id).toBe(900)
    expect(acked?.seq).toBe(50)
  })
})

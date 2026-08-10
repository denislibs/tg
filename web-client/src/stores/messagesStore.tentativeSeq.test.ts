// Task 4/5 (страховочная сетка перед replay-рефактором): пины tentativeSeq —
// appendOptimistic присваивает баблу seq = maxSeq + 1 (messagesStore.ts:~224).
// Раньше dedupAsc ключевал ВЕСЬ список по seq (последний вставленный побеждает,
// messagesStore.ts:~54), и коллизия tentativeSeq с seq чужого входящего съедала
// оптимистичный бабл молча (без ack/error) — задача 5 это починила: оптимистичный
// бабл (clientId + временный id < 0) ключуется по clientId, серверные сообщения —
// по seq, так что пространства ключей не пересекаются. Тест ниже пинит ИСПРАВНОЕ
// поведение: бабл переживает коллизию seq. Остальные два теста — пины на здоровые
// сценарии (два оптимистичных подряд, ack одного не ломает другой).
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { Message } from '../core/models'

const CHAT = 9
const ME = 1
const OTHER = 2

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

  it('чужое входящее с тем же tentativeSeq не вытесняет оптимистичный бабл (задача 5)', () => {
    const st = useMessagesStore.getState()
    st.appendOptimistic(String(CHAT), 'my draft', ME, 'c-opt')

    // Пустое окно → tentativeSeq бабла = maxSeq(0) + 1 = 1.
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0]!.clientId).toBe('c-opt')

    // Чужое входящее занимает тот же seq=1, что и tentativeSeq оптимистичного бабла.
    st.applyIncoming(CHAT, foreignIncoming(1, 501))

    // ИСПРАВНОЕ поведение: оптимистичный бабл (ключ дедупа — clientId, у него нет
    // серверного id) и чужое входящее (ключ дедупа — seq) не конкурируют за одну
    // ячейку — оба остаются в окне.
    const list = bubbles()
    expect(list).toHaveLength(2)
    expect(list.some((m) => m.clientId === 'c-opt')).toBe(true)
    expect(list.some((m) => m.id === 501)).toBe(true)
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

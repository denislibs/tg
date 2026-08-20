// Долг 1B.1: applyIncoming пишет сообщение с threadRootId и в основное окно
// чата, и в окно треда (messagesStore.ts:~319-344), но до этого теста ни один
// пин на это не держал — все тестовые сообщения раньше шли с threadRootId: null.
// Этот путь (new_message) переезжает на операционный протокол первым, поэтому
// пин нужен ДО правок — фиксирует ТЕКУЩЕЕ поведение, продакшн-код не трогается.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore, winKey } from './messagesStore'
import { makeMessage } from '../core/messages/testMessage'
import { generateTempMessageId } from '../core/history/messageId'
import type { MessageReal } from '../core/models'

const CHAT = 21
const ROOT = 100
const ME = 1

function threadMsg(id: number, randomId?: string): MessageReal {
  return makeMessage({ id, peerId: CHAT, fromId: ME, text: `m${id}`, threadRootId: ROOT, randomId })
}

function mainMsg(id: number): MessageReal {
  return makeMessage({ id, peerId: CHAT, fromId: ME, text: `m${id}` })
}

function win(key: string) {
  return useMessagesStore.getState().byKey[key]
}

describe('applyIncoming: маршрутизация по основному окну и окну треда', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
  })

  // Что ломается: если бы applyIncoming писал только в первое совпавшее окно
  // (или матчил ключи неверно), сообщение с threadRootId пропало бы из одного
  // из двух окон при том, что оба загружены.
  it('оба окна загружены → сообщение с threadRootId попадает в оба', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    st.setWindow(winKey(CHAT, ROOT), { msgs: [], reachedTop: true, reachedBottom: true })

    st.applyIncoming(CHAT, threadMsg(501))

    const main = win(winKey(CHAT)).msgs
    const thread = win(winKey(CHAT, ROOT)).msgs
    expect(main).toHaveLength(1)
    expect(main[0].id).toBe(501)
    expect(thread).toHaveLength(1)
    expect(thread[0].id).toBe(501)
  })

  // Что ломается: если applyIncoming заводил бы окно треда «на лету» (patch()
  // подставляет EMPTY_WINDOW для отсутствующего ключа), незагруженное окно
  // треда появилось бы в byKey с одним сообщением вместо отсутствия ключа —
  // при следующем открытии треда это подменило бы честный fetch неполными данными.
  it('загружено только основное окно → сообщение попало в него, окно треда не заводится', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })

    st.applyIncoming(CHAT, threadMsg(502))

    expect(win(winKey(CHAT)).msgs).toHaveLength(1)
    expect(win(winKey(CHAT)).msgs[0].id).toBe(502)
    expect(win(winKey(CHAT, ROOT))).toBeUndefined()
  })

  // Что ломается: симметричный случай — если бы applyIncoming при отсутствующем
  // основном окне всё равно заводил его (или пропускал вставку в загруженный
  // тред из-за неверного порядка проверки ключей).
  it('загружено только окно треда → сообщение попало в него, основное не заводится', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT, ROOT), { msgs: [], reachedTop: true, reachedBottom: true })

    st.applyIncoming(CHAT, threadMsg(503))

    expect(win(winKey(CHAT, ROOT)).msgs).toHaveLength(1)
    expect(win(winKey(CHAT, ROOT)).msgs[0].id).toBe(503)
    expect(win(winKey(CHAT))).toBeUndefined()
  })

  // Что ломается: если бы applyIncoming всегда писал в оба ключа независимо от
  // threadRootId (а не строил список keys условно), сообщение без треда попало
  // бы и в какое-то «окно треда» (в данном случае не заведённое, но по коду
  // messagesStore.ts:~323 keys вообще не включал бы второй ключ) — здесь пин
  // на обратное: без threadRootId второй ключ не участвует, даже если он загружен.
  it('сообщение без threadRootId при загруженных обоих окнах → только в основное', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
    st.setWindow(winKey(CHAT, ROOT), { msgs: [], reachedTop: true, reachedBottom: true })

    st.applyIncoming(CHAT, mainMsg(504))

    expect(win(winKey(CHAT)).msgs).toHaveLength(1)
    expect(win(winKey(CHAT)).msgs[0].id).toBe(504)
    expect(win(winKey(CHAT, ROOT)).msgs).toHaveLength(0)
  })

  // Что ломается: если слияние с оптимистикой (матч по clientId, перенос
  // clientId/localUrl/secret) применялось бы только к основному окну, а окно
  // треда обрабатывалось отдельной (упрощённой) веткой — бабл в треде остался
  // бы дублирован либо потерял бы clientId/серверный id.
  it('слияние с оптимистикой в треде: эхо с тем же clientId → один элемент с серверным id, без дубля', () => {
    const st = useMessagesStore.getState()
    st.setWindow(winKey(CHAT, ROOT), { msgs: [], reachedTop: true, reachedBottom: true })
    // Неотправленный бабл заводит владелец (менеджер воркера) и присылает
    // операцией; здесь предмет — только слияние в СТОРЕ, поэтому кладём такой же
    // объект (дробный клиентский номер + random_id) напрямую.
    st.appendLocal(winKey(CHAT, ROOT), { ...threadMsg(generateTempMessageId(1), 'c-thread'), message: 'draft' })

    st.applyIncoming(CHAT, threadMsg(900, 'c-thread'))

    const thread = win(winKey(CHAT, ROOT)).msgs
    expect(thread).toHaveLength(1)
    expect(thread[0].id).toBe(900)
    expect(thread[0].random_id).toBe('c-thread')
  })
})

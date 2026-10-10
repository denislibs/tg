// Граница пространств номеров — порт tweb `appMessagesIdsManager.ts:15-35`
// и констант `lib/appManagers/constants.ts:23,26`.
import { describe, expect, it } from 'vitest'
import { GENERAL_TOPIC_ID, MESSAGE_ID_OFFSET, generateMessageId, getServerMessageId } from './messageId'

describe('messageId', () => {
  // tweb constants.ts:23 — порог буквально тот же: порты сравнивают
  // клиентские номера с константами оригинала (П-1 спеки Ф-5).
  it('MESSAGE_ID_OFFSET равен tweb 0x100000000', () => {
    expect(MESSAGE_ID_OFFSET).toBe(0x100000000)
  })

  // tweb constants.ts:26: GENERAL_TOPIC_ID = MESSAGE_ID_OFFSET + 1 — серверный 1
  it('GENERAL_TOPIC_ID — клиентская форма серверного номера 1', () => {
    expect(GENERAL_TOPIC_ID).toBe(0x100000001)
    expect(generateMessageId(1)).toBe(GENERAL_TOPIC_ID)
    expect(getServerMessageId(GENERAL_TOPIC_ID)).toBe(1)
  })

  it('перевод туда-обратно и идемпотентность приведения к серверному', () => {
    expect(getServerMessageId(generateMessageId(42))).toBe(42)
    expect(getServerMessageId(42)).toBe(42)
  })
})

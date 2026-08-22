// src/core/managers/draftsManager.test.ts
//
// Черновик на проводе — объединение `DraftMessage`, и оба конструктора значат
// разное: `draftMessage` это черновик, `draftMessageEmpty` — что его СНЯЛИ.
// Прежде отсутствие выражалось `null` под тем же ключом, и различие «нет
// черновика» / «поле не заполнено» стиралось.
//
// Витрина `/drafts` при этом отвечает ТЕМИ ЖЕ кадрами, что приезжают живыми
// (у оригинала `messages.getAllDrafts` — контейнер `Updates`), поэтому разбор
// у списка и у кадра один.
import { describe, it, expect, vi } from 'vitest'
import { newDraftsManager } from './draftsManager'
import type { RestClient } from '../net/restClient'

describe('DraftsManager', () => {
  it('list разбирает кадры витрины: пир из конструктора, текст из message', async () => {
    const rest = {
      get: vi.fn(async () => ({
        drafts: [{
          _: 'updateDraftMessage',
          peer: { _: 'peerUser', user_id: 7 },
          draft: {
            _: 'draftMessage',
            message: 'набросок',
            entities: [{ _: 'messageEntityBold', offset: 0, length: 4 }],
            reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 12 },
            date: 1785578400,
          },
        }],
      })),
    } as unknown as RestClient

    expect(await newDraftsManager({ rest }).list()).toEqual([{
      peerId: 7,
      text: 'набросок',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 4 }],
      replyToId: 12,
      date: 1785578400,
    }])
  })

  it('save с пустым текстом получает draftMessageEmpty — и это НЕ черновик', async () => {
    const rest = {
      put: vi.fn(async () => ({ draft: { _: 'draftMessageEmpty' } })),
    } as unknown as RestClient

    expect(await newDraftsManager({ rest }).save(7, '')).toBeNull()
  })

  it('save возвращает черновик с датой в СЕКУНДАХ — тех же единицах, что у сообщения', async () => {
    const rest = {
      put: vi.fn(async () => ({ draft: { _: 'draftMessage', message: 'x', date: 1785578400 } })),
    } as unknown as RestClient

    expect(await newDraftsManager({ rest }).save(7, 'x')).toEqual({
      peerId: 7, text: 'x', entities: undefined, replyToId: null, date: 1785578400,
    })
  })
})

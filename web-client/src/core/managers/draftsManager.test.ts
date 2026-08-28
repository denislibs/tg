// src/core/managers/draftsManager.test.ts
//
// Черновик на проводе — объединение `DraftMessage`, и оба конструктора значат
// разное: `draftMessage` это черновик, `draftMessageEmpty` — что его СНЯЛИ.
// Прежде отсутствие выражалось `null` под тем же ключом, и различие «нет
// черновика» / «поле не заполнено» стиралось.
//
// Витрина `/drafts` при этом отвечает ТЕМИ ЖЕ кадрами, что приезжают живыми, и
// КОНТЕЙНЕРОМ `updates` (у оригинала `messages.getAllDrafts` объявлен
// возвращающим `Updates`), поэтому разбор у списка и у кадра один — и своей
// проекции у менеджера НЕТ: форма провода и форма модели совпали, черновик
// едет в диалог как есть. Сохранение отвечает тем же кадром.
import { describe, it, expect, vi } from 'vitest'
import { newDraftsManager } from './draftsManager'
import type { RestClient } from '../net/restClient'

const FRAME = {
  _: 'updateDraftMessage',
  peer: { _: 'peerUser', user_id: 7 },
  draft: {
    _: 'draftMessage',
    message: 'набросок',
    entities: [{ _: 'messageEntityBold', offset: 0, length: 4 }],
    reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 12 },
    date: 1785578400,
  },
}

describe('DraftsManager', () => {
  it('list отдаёт кадры витрины как есть — своего маппера у менеджера нет', async () => {
    const rest = { get: vi.fn(async () => ({ _: 'updates', updates: [FRAME], users: [], chats: [] })) } as unknown as RestClient

    expect(await newDraftsManager({ rest }).list()).toEqual([FRAME])
  })

  it('пустая витрина — пустой список, а не падение на отсутствующем поле', async () => {
    const rest = { get: vi.fn(async () => ({})) } as unknown as RestClient

    expect(await newDraftsManager({ rest }).list()).toEqual([])
  })

  it('save с пустым текстом получает draftMessageEmpty — «снят», а не null', async () => {
    // Ответ сохранения — тот же КАДР, что едет списком: конструктор черновика
    // лежит внутри него, а не под голым ключом `draft`.
    const put = vi.fn(async () => ({ ...FRAME, draft: { _: 'draftMessageEmpty' } }))
    const rest = { put } as unknown as RestClient

    expect(await newDraftsManager({ rest }).save(7, '')).toEqual({ _: 'draftMessageEmpty' })
    expect(put).toHaveBeenCalledWith('/chats/7/draft', { text: '', entities: null, reply_to_id: null })
  })

  it('save возвращает конструктор черновика с датой в СЕКУНДАХ — тех же единицах, что у сообщения', async () => {
    const rest = {
      put: vi.fn(async () => ({ ...FRAME, draft: { _: 'draftMessage', message: 'x', date: 1785578400 } })),
    } as unknown as RestClient

    expect(await newDraftsManager({ rest }).save(7, 'x')).toEqual({
      _: 'draftMessage', message: 'x', date: 1785578400,
    })
  })
})

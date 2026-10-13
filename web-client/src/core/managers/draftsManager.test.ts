// src/core/managers/draftsManager.test.ts
//
// Черновики — порт tweb `appDraftsManager` (812502980): ключ «пир + тред»
// (`:88-90`), тред в `reply_to` на проводе (`syncDraft` `:296-303`), приём
// `updateDraftMessage` (`:44-71`) с ИСПРАВЛЕННЫМ багом `:66` (серверный
// `top_msg_id` переводится в клиентский номер), `getAllDrafts` один раз за
// сессию (`addMissedDialogs` `:109-139`), местное снятие (`clearDraft` `:353-371`).
import { describe, it, expect, vi } from 'vitest'
import { newDraftsManager, type DraftsDeps } from './draftsManager'
import type { DraftMessageReal, RawDraft } from '../models'
import { GENERAL_TOPIC_ID, generateMessageId } from '../history/messageId'

const cid = generateMessageId
const FORUM = -50

function setup(rest: Partial<Record<'get' | 'put' | 'del', ReturnType<typeof vi.fn>>> = {}) {
  const deps = {
    rest: { get: vi.fn(async () => ({})), put: vi.fn(async () => true), del: vi.fn(async () => true), ...rest } as unknown as DraftsDeps['rest'],
    applyDialogDraft: vi.fn(),
    applyTopicDraft: vi.fn(),
    onDraftUpdated: vi.fn(),
  }
  return { mgr: newDraftsManager(deps), ...deps, put: deps.rest.put as unknown as ReturnType<typeof vi.fn> }
}

/** черновик поля ввода — `pFlags` у него всегда (`ChatInput.getCurrentInputAsDraft`) */
const local = (message: string, replyTo?: number, threadId?: number): DraftMessageReal => ({
  _: 'draftMessage', pFlags: {}, message, date: 1,
  ...(replyTo ? { reply_to: { _: 'inputReplyToMessage' as const, reply_to_msg_id: replyTo, top_msg_id: threadId } } : {}),
})

describe('DraftsManager: приём updateDraftMessage (tweb :44-71)', () => {
  it('черновик треда ложится по КЛИЕНТСКОМУ номеру треда — исправленный баг tweb :66', () => {
    const { mgr, onDraftUpdated, applyTopicDraft, applyDialogDraft } = setup()
    const frame: RawDraft = {
      _: 'updateDraftMessage', peer: { _: 'peerChannel', channel_id: 50 }, top_msg_id: 10,
      draft: { _: 'draftMessage', message: 'тема', date: 5, reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 12, top_msg_id: 10 } },
    }
    mgr.applyUpdate(frame)

    const expected = { _: 'draftMessage', pFlags: {}, message: 'тема', date: 5, reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: cid(12), top_msg_id: cid(10) } }
    expect(mgr.getDraft(FORUM, cid(10))).toEqual(expected)
    expect(onDraftUpdated).toHaveBeenCalledWith({ peerId: FORUM, threadId: cid(10), draft: expected, force: undefined })
    expect(applyTopicDraft).toHaveBeenCalledWith(FORUM, cid(10), expected)
    expect(applyDialogDraft).not.toHaveBeenCalled()
  })

  it('General — `top_msg_id: 1` → `GENERAL_TOPIC_ID`', () => {
    const { mgr } = setup()
    mgr.applyUpdate({ _: 'updateDraftMessage', peer: { _: 'peerChannel', channel_id: 50 }, top_msg_id: 1, draft: { _: 'draftMessage', message: 'g', date: 5 } })
    expect(mgr.getDraft(FORUM, GENERAL_TOPIC_ID)?.message).toBe('g')
  })

  it('снятый черновик треда — из словаря, вкладкам `draft: undefined`', () => {
    const { mgr, onDraftUpdated } = setup()
    mgr.saveTopicDraft(FORUM, cid(10), { _: 'draftMessage', message: 'x', date: 1 })
    mgr.applyUpdate({ _: 'updateDraftMessage', peer: { _: 'peerChannel', channel_id: 50 }, top_msg_id: 10, draft: { _: 'draftMessageEmpty' } })
    expect(mgr.getDraft(FORUM, cid(10))).toBeUndefined()
    expect(onDraftUpdated).toHaveBeenCalledWith({ peerId: FORUM, threadId: cid(10), draft: undefined, force: undefined })
  })

  it('черновик чата — полю диалога (расхождение 1), словарь его не держит', () => {
    const { mgr, onDraftUpdated, applyDialogDraft } = setup()
    const draft = { _: 'draftMessage' as const, message: 'чат', date: 5 }
    mgr.applyUpdate({ _: 'updateDraftMessage', peer: { _: 'peerUser', user_id: 7 }, draft })
    expect(applyDialogDraft).toHaveBeenCalledWith(7, draft)
    expect(onDraftUpdated).not.toHaveBeenCalled()
  })
})

describe('DraftsManager.syncDraft (tweb :216-330)', () => {
  it('тред без ответа — `reply_to_msg_id = тред` серверным номером; местная запись и `draft_updated`', async () => {
    const { mgr, put, onDraftUpdated, applyTopicDraft } = setup()
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: local('привет') })
    expect(put).toHaveBeenCalledWith(`/chats/${FORUM}/draft`, { message: 'привет', reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 10 } })
    expect(mgr.getDraft(FORUM, cid(10))?.message).toBe('привет')
    expect(onDraftUpdated).toHaveBeenCalledTimes(1)
    expect(applyTopicDraft).toHaveBeenCalledTimes(1)
  })

  it('тред с ответом — `top_msg_id = тред`', async () => {
    const { mgr, put } = setup()
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: local('a', cid(15), cid(10)) })
    expect(put).toHaveBeenCalledWith(`/chats/${FORUM}/draft`, { message: 'a', reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 15, top_msg_id: 10 } })
  })

  it('тот же черновик треда — сервер не зовётся', async () => {
    const { mgr, put } = setup()
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: local('a') })
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: { ...local('a'), date: 99 } })
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('пустой черновик треда — снятие: `message: ""` с тредом, словарь пуст', async () => {
    const { mgr, put, onDraftUpdated } = setup()
    mgr.saveTopicDraft(FORUM, cid(10), local('был'))
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: undefined })
    expect(put).toHaveBeenCalledWith(`/chats/${FORUM}/draft`, { message: '', reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 10 } })
    expect(mgr.getDraft(FORUM, cid(10))).toBeUndefined()
    expect(onDraftUpdated).toHaveBeenLastCalledWith({ peerId: FORUM, threadId: cid(10), draft: undefined, force: false })
  })

  it('черновик чата — только сервер (строку ведёт кадр, расхождение 1)', async () => {
    const { mgr, put, onDraftUpdated, applyDialogDraft } = setup()
    await mgr.syncDraft({ peerId: 7, localDraft: local('x', cid(3)) })
    expect(put).toHaveBeenCalledWith('/chats/7/draft', { message: 'x', reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 3 } })
    expect(onDraftUpdated).not.toHaveBeenCalled()
    expect(applyDialogDraft).not.toHaveBeenCalled()
  })
})

describe('DraftsManager: решение превью ссылки (tweb syncDraft :280-290)', () => {
  it('no_webpage / invert_media / media уходят в saveDraft; ложных флагов нет', async () => {
    const { mgr, put } = setup()
    const media = { _: 'inputMediaWebPage' as const, url: 'https://ex.com', pFlags: { force_small_media: true as const, optional: true as const } }
    await mgr.syncDraft({ peerId: 7, localDraft: { ...local('https://ex.com'), pFlags: { invert_media: true }, media } })
    await mgr.syncDraft({ peerId: 7, localDraft: { ...local('https://ex.com x'), pFlags: { no_webpage: true } } })
    await mgr.syncDraft({ peerId: 7, localDraft: local('y') })
    expect(put.mock.calls.map((c) => c[1])).toEqual([
      { message: 'https://ex.com', invert_media: true, media },
      { message: 'https://ex.com x', no_webpage: true },
      { message: 'y' },
    ])
  })

  it('черновик треда с провода: pFlags заводится, media доезжает (сравнение с полем ввода)', () => {
    const { mgr } = setup()
    const media = { _: 'inputMediaWebPage' as const, url: 'https://ex.com', pFlags: { optional: true as const } }
    mgr.applyUpdate({ _: 'updateDraftMessage', peer: { _: 'peerChannel', channel_id: 50 }, top_msg_id: 10, draft: { _: 'draftMessage', message: 'a', date: 5, media } })
    expect(mgr.getDraft(FORUM, cid(10))).toEqual({ _: 'draftMessage', pFlags: {}, message: 'a', date: 5, media })
  })
})

describe('DraftsManager: прочее', () => {
  it('clearDraft — местно, `force`, без сервера (tweb :353-371)', () => {
    const { mgr, put, onDraftUpdated } = setup()
    mgr.saveTopicDraft(FORUM, cid(10), local('был'))
    mgr.clearDraft(FORUM, cid(10))
    expect(mgr.getDraft(FORUM, cid(10))).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(onDraftUpdated).toHaveBeenCalledWith({ peerId: FORUM, threadId: cid(10), draft: undefined, force: true })
  })

  it('saveTopicDraft — черновик строки темы в словарь без `draft_updated` (dialogs.ts:1692-1697)', () => {
    const { mgr, onDraftUpdated } = setup()
    const d = mgr.saveTopicDraft(FORUM, cid(10), { _: 'draftMessage', message: 't', date: 1, reply_to: { _: 'inputReplyToMessage', reply_to_msg_id: 11 } })
    expect(d?.reply_to?.reply_to_msg_id).toBe(cid(11))
    expect(mgr.getDraft(FORUM, cid(10))).toEqual(d)
    expect(onDraftUpdated).not.toHaveBeenCalled()
  })

  it('addMissedDialogs — `GET /drafts` один раз, кадры тем же приёмом', async () => {
    const get = vi.fn(async () => ({ _: 'updates', updates: [
      { _: 'updateDraftMessage', peer: { _: 'peerChannel', channel_id: 5 }, top_msg_id: 200, draft: { _: 'draftMessage', message: 'к', date: 1 } },
    ] }))
    const { mgr } = setup({ get })
    await mgr.addMissedDialogs()
    await mgr.addMissedDialogs()
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/drafts')
    expect(mgr.getDraft(-5, cid(200))?.message).toBe('к')
  })

  it('clearAll — `DELETE /drafts`, черновики тредов сняты местно (tweb :332-351)', async () => {
    const { mgr, rest, onDraftUpdated } = setup()
    mgr.saveTopicDraft(FORUM, cid(10), local('был'))
    await mgr.clearAll()
    expect(rest.del).toHaveBeenCalledWith('/drafts')
    expect(mgr.getDraft(FORUM, cid(10))).toBeUndefined()
    expect(onDraftUpdated).toHaveBeenCalledWith({ peerId: FORUM, threadId: cid(10), draft: undefined, force: undefined })
  })
})

// Расхождение 5: эхо своего сохранения (кадр едет всем устройствам владельца).
describe('DraftsManager: эхо своего сохранения', () => {
  const frame = (message: string | null): RawDraft => ({
    _: 'updateDraftMessage', peer: { _: 'peerChannel', channel_id: 50 }, top_msg_id: 10,
    draft: message === null ? { _: 'draftMessageEmpty' } : { _: 'draftMessage', message, date: 7 },
  })

  it('эхо равного черновика ничего не объявляет', async () => {
    const { mgr, onDraftUpdated } = setup()
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: local('abc') })
    onDraftUpdated.mockClear()
    mgr.applyUpdate(frame('abc'))
    expect(onDraftUpdated).not.toHaveBeenCalled()
  })

  it('эхо черновика, снятого отправкой, его не возвращает; очистка сервера — тишина; новый чужой — применяется', async () => {
    const { mgr, onDraftUpdated } = setup()
    await mgr.syncDraft({ peerId: FORUM, threadId: cid(10), localDraft: local('abc') })
    mgr.clearDraft(FORUM, cid(10))
    onDraftUpdated.mockClear()

    mgr.applyUpdate(frame('abc'))
    expect(mgr.getDraft(FORUM, cid(10))).toBeUndefined()
    mgr.applyUpdate(frame(null))
    expect(onDraftUpdated).not.toHaveBeenCalled()

    mgr.applyUpdate(frame('abc'))
    expect(mgr.getDraft(FORUM, cid(10))?.message).toBe('abc')
    expect(onDraftUpdated).toHaveBeenCalledTimes(1)
  })

  it('clearDraft без черновика — тишина (tweb syncDraft гасит равное, :219-222)', () => {
    const { mgr, onDraftUpdated } = setup()
    mgr.clearDraft(FORUM, cid(10))
    expect(onDraftUpdated).not.toHaveBeenCalled()
  })
})

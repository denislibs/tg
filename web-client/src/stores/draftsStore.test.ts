import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { setDraft, removeDraft, setAllDrafts, draftFor, loadDrafts } from './draftsStore'
import type { Draft } from '../core/models'

const stateKey = vi.fn().mockResolvedValue(undefined)
const draft: Draft = { chatId: 3, text: 'привет', replyToId: null, updatedAt: '2026-08-09T00:00:00Z' }

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('draftsStore поверх State', () => {
  it('черновик пишется в State и персистится', () => {
    setDraft(draft)

    expect(draftFor(3)).toEqual(draft)
    expect(stateKey).toHaveBeenCalledWith('drafts', [draft])
  })

  it('удаление убирает черновик из State', () => {
    setDraft(draft)
    stateKey.mockClear()

    removeDraft(3)

    expect(draftFor(3)).toBeUndefined()
    expect(stateKey).toHaveBeenCalledWith('drafts', [])
  })

  it('повторная запись того же чата заменяет, а не дублирует', () => {
    setDraft(draft)
    setDraft({ ...draft, text: 'пока' })

    expect(useAppStateStore.getState().drafts).toHaveLength(1)
    expect(draftFor(3)?.text).toBe('пока')
  })

  it('setAllDrafts перезаписывает набор целиком', () => {
    setDraft(draft)

    setAllDrafts([])

    expect(useAppStateStore.getState().drafts).toEqual([])
  })

  it('загрузка с сети кладёт черновики в State', async () => {
    await loadDrafts({ drafts: { list: () => Promise.resolve([draft]) } })

    expect(useAppStateStore.getState().drafts).toEqual([draft])
    expect(stateKey).toHaveBeenCalledWith('drafts', [draft])
  })

  it('оффлайн: сеть упала — черновики из State остаются', async () => {
    useAppStateStore.setState({ drafts: [draft] })

    await loadDrafts({ drafts: { list: () => Promise.reject(new Error('offline')) } })

    expect(useAppStateStore.getState().drafts).toEqual([draft])
  })
})

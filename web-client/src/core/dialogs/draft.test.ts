// Черновик с провода против черновика поля ввода: `draftsAreEqual` глубокий, и
// `pFlags` провод опускает (omitempty) — `processApiDraft` заводит объект.
import { describe, expect, it } from 'vitest'
import { draftsAreEqual, processApiDraft } from './draft'
import type { DraftMessageReal } from '../models'

/** черновик, как его собирает `ChatInput.getCurrentInputAsDraft` (tweb input.ts:2280-2310) */
const local = (): DraftMessageReal => ({
  _: 'draftMessage', date: 1, message: 'смотри https://ex.com', entities: undefined,
  pFlags: { no_webpage: undefined, invert_media: true },
  media: { _: 'inputMediaWebPage', url: 'https://ex.com', pFlags: { force_large_media: undefined, force_small_media: true, optional: true } },
})

describe('processApiDraft: pFlags и решение превью', () => {
  it('черновик без pFlags получает {} — и равен черновику поля без флагов', () => {
    const wire = { _: 'draftMessage', date: 2, message: 'x' } as DraftMessageReal
    const got = processApiDraft(wire)
    expect(got.pFlags).toEqual({})
    expect(draftsAreEqual(got, { _: 'draftMessage', date: 9, message: 'x', pFlags: { no_webpage: undefined, invert_media: undefined } })).toBe(true)
  })

  it('круг «поле → провод (JSON, omitempty) → поле» сохраняет равенство', () => {
    const roundTrip = processApiDraft(JSON.parse(JSON.stringify(local())) as DraftMessageReal)
    expect(draftsAreEqual(roundTrip, local())).toBe(true)
  })

  it('решение превью различает черновики: другой размер — не равны', () => {
    const other = local()
    other.media!.pFlags = { optional: true }
    expect(draftsAreEqual(local(), other)).toBe(false)
  })
})

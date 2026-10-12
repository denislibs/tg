// Порт tweb `getInputMediaWebPage` (appMessagesManager.ts:4866-4880),
// `generateOutgoingWebPage` (:4882-4910) и полей превью `editMessage` (:2216-2220).
import { describe, expect, it } from 'vitest'
import { editWebPageWireFields, generateOutgoingWebPageMedia, getInputMediaWebPage, sendWebPageWireFields } from './webPage'
import type { WebPage } from '../../media/messageMedia'

const wp: WebPage = { _: 'webPage', pFlags: { has_large_media: true }, url: 'https://ex.com/a', display_url: 'ex.com/a' }

describe('превью ссылки на проводе', () => {
  it('getInputMediaWebPage: url карточки и force_* из webPageOptions; без карточки — ничего', () => {
    expect(getInputMediaWebPage({ webPage: wp, webPageOptions: { largeMedia: true, optional: true } })).toEqual({
      _: 'inputMediaWebPage', url: 'https://ex.com/a',
      pFlags: { force_large_media: true, force_small_media: undefined, optional: true },
    })
    expect(getInputMediaWebPage({ noWebPage: true })).toBeUndefined()
  })

  it('отправка: при карточке — media (без no_webpage), иначе no_webpage; invert_media — флагом', () => {
    expect(sendWebPageWireFields({ webPage: wp, webPageOptions: { smallMedia: true }, invertMedia: true, noWebPage: true })).toEqual({
      media: { _: 'inputMediaWebPage', url: 'https://ex.com/a', pFlags: { force_large_media: undefined, force_small_media: true, optional: undefined } },
      invert_media: true,
    })
    expect(sendWebPageWireFields({ noWebPage: true })).toEqual({ no_webpage: true })
    expect(sendWebPageWireFields({})).toEqual({})
  })

  it('правка: оба флага как есть и media при карточке (tweb :2216-2220)', () => {
    expect(editWebPageWireFields({ noWebPage: true, invertMedia: true })).toEqual({ no_webpage: true, invert_media: true })
    expect(editWebPageWireFields({ webPage: wp })).toEqual({ media: expect.objectContaining({ url: 'https://ex.com/a' }) })
  })

  it('бабл до эха: messageMediaWebPage с карточкой плашки и force_* (tweb :4893-4900)', () => {
    expect(generateOutgoingWebPageMedia({ webPage: wp, webPageOptions: { largeMedia: true } })).toEqual({
      _: 'messageMediaWebPage', pFlags: { force_large_media: true, force_small_media: undefined }, webpage: wp,
    })
    expect(generateOutgoingWebPageMedia({ noWebPage: true })).toBeUndefined()
  })
})

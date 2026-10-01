import { describe, expect, it } from 'vitest'
import { DEFAULT_TME_ORIGIN, readTmeOrigin } from '@config/app'
import {
  publicLinkFromTelegramPath,
  publicLinkHostname,
  publicPrivatePostLink,
  publicStickerSetLink,
  publicUsernameLink,
} from './publicLink'

// В тестах VITE_TME_ORIGIN не задан — действует дефолт.
const TME = DEFAULT_TME_ORIGIN

describe('publicLink — аналог t.me на своём хосте, пути 1:1', () => {
  it('юзернейм и пост', () => {
    expect(publicUsernameLink('durov')).toBe(`${TME}/durov`)
    expect(publicUsernameLink('durov', 12)).toBe(`${TME}/durov/12`)
  })

  it('пост чата без юзернейма — /c/<id>/<post>', () => {
    expect(publicPrivatePostLink(1234, 5)).toBe(`${TME}/c/1234/5`)
  })

  it('набор: addstickers / addemoji — как tweb popups/stickers.tsx', () => {
    expect(publicStickerSetLink('Cats', false)).toBe(`${TME}/addstickers/Cats`)
    expect(publicStickerSetLink('Smile', true)).toBe(`${TME}/addemoji/Smile`)
  })

  it('голый t.me/<путь> — тот же путь на нашем хосте', () => {
    expect(publicLinkFromTelegramPath('+hash')).toBe(`${TME}/+hash`)
    expect(publicLinkFromTelegramPath('durov/1')).toBe(`${TME}/durov/1`)
  })

  it('имя хоста — из настройки', () => {
    expect(publicLinkHostname()).toBe(new URL(TME).hostname)
  })
})

describe('readTmeOrigin', () => {
  it('значение из VITE_TME_ORIGIN, завершающий «/» снят', () => {
    expect(readTmeOrigin({ VITE_TME_ORIGIN: 'https://links.example/' } as ImportMetaEnv)).toBe('https://links.example')
  })

  it('без переменной — дефолт', () => {
    expect(readTmeOrigin({} as ImportMetaEnv)).toBe(DEFAULT_TME_ORIGIN)
  })
})

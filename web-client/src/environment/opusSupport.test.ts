// Гейт «играет ли платформа ogg сама» (порт tweb `src/environment/opusSupport.ts:2`).
//
// Стенд подменяет РОВНО ОДНУ возможность — ответ `HTMLMediaElement.canPlayType`
// — и ничего больше. Это не педантизм: в прошлый заход мутация в соседнем гейте
// пережила тест ровно потому, что фейк снимал сразу все способности платформы, и
// ветки перестали различаться. Здесь различать нечего, кроме ответа движка.
//
// Значение считается на импорте, поэтому каждый кейс — свой `resetModules` +
// свежий динамический импорт.
import { afterEach, describe, expect, it, vi } from 'vitest'

const proto = HTMLMediaElement.prototype as unknown as { canPlayType?: unknown }
const original = Object.getOwnPropertyDescriptor(proto, 'canPlayType')

function restore(): void {
  if (original) Object.defineProperty(proto, 'canPlayType', original)
  else delete proto.canPlayType
}

async function gateWith(canPlayType: unknown): Promise<boolean> {
  Object.defineProperty(proto, 'canPlayType', { configurable: true, writable: true, value: canPlayType })
  vi.resetModules()
  return (await import('./opusSupport')).default
}

afterEach(restore)

describe('IS_OPUS_SUPPORTED', () => {
  it('движок отвечает пустой строкой (WebKit ниже 18.4) — гейт закрыт', async () => {
    expect(await gateWith(() => '')).toBe(false)
  })

  it('«maybe» (Safari 18.4+, Firefox) — гейт открыт', async () => {
    expect(await gateWith(() => 'maybe')).toBe(true)
  })

  it('«probably» (Chrome) — гейт открыт', async () => {
    expect(await gateWith(() => 'probably')).toBe(true)
  })

  it('спрашивают именно про ogg-контейнер, а не про что попало', async () => {
    const asked: string[] = []
    await gateWith((type: string) => { asked.push(type); return 'maybe' })
    expect(asked).toEqual(['audio/ogg;'])
  })

  it('древний движок без canPlayType — гейт закрыт, а не падение', async () => {
    expect(await gateWith(undefined)).toBe(false)
  })
})

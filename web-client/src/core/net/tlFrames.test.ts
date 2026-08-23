// Клиентская сторона провода TL — на тех же ЭТАЛОННЫХ байтах, которые собрал
// кодек на Go и прочитал неизменённый десериализатор tweb.
import { describe, expect, it } from 'vitest'

import golden from '../../../../schema/testdata/tl-golden.json'
import { decodeTLFrame } from './tlFrames'

interface GoldenVector { name: string; type: string; hex: string }
const vectorOf = (name: string) => {
  const v = (golden.vectors as GoldenVector[]).find((x) => x.name === name)
  if (!v) throw new Error(`вектора ${name} нет в эталоне`)
  return v
}
const toBytes = (hex: string) => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; ++i) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

describe('decodeTLFrame', () => {
  it('updateShort: апдейт один, курсор внутри него', () => {
    const got = decodeTLFrame(toBytes(vectorOf('updateShortNewMessage').hex))

    expect(got).toHaveLength(1)
    expect(got[0].update._).toBe('updateNewMessage')
    // Курсора от КОНТЕЙНЕРА нет — он параметр самого конструктора.
    expect(got[0].seq).toBeUndefined()
    expect(got[0].update.pts).toBe(41)
  })

  it('updates: курсор кадра без своего pts приезжает из seq контейнера', () => {
    const got = decodeTLFrame(toBytes(vectorOf('updatesDialogPinned').hex))

    expect(got).toHaveLength(1)
    expect(got[0].update._).toBe('updateDialogPinned')
    expect(got[0].seq).toBe(42)
    // «Закреплено» — бит маски: ключа `pinned: false` не бывает.
    expect((got[0].update as { pFlags?: { pinned?: true } }).pFlags?.pinned).toBe(true)
  })

  // Байты `bytes` схемы разбор отдаёт Uint8Array, а модель клиента фазы 0
  // держит их base64-строкой. Пока модель не переведена, кадр обязан приезжать
  // вкладке В ОДНОЙ форме независимо от флага провода — иначе флаг перестаёт
  // быть переключателем и становится вторым поведением.
  it('bytes приезжают в той же форме, что и по JSON-проводу', () => {
    const [{ update }] = decodeTLFrame(toBytes(vectorOf('updateShortNewMessage').hex))
    const seen: unknown[] = []
    const walk = (v: unknown) => {
      if (v instanceof Uint8Array) seen.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(update)
    expect(seen).toEqual([])
  })

  it('чужая оболочка — ошибка, а не молчаливый пропуск кадра', () => {
    // updatesTooLong#e317af7e — конструктор объединения Updates, которого наш
    // сервер не производит: догон у нас свой.
    expect(() => decodeTLFrame(toBytes('7eaf17e3'))).toThrow(/оболочк/)
  })
})

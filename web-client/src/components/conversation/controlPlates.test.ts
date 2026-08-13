// Дефект: вход в канал через сайдбар дёргал композер. Карточка канала едет
// отдельным REST-запросом, и до её приезда прав нет — цепочка плашек читала это
// как «нельзя писать», ставила channelMute, а по ответу сети снимала обратно:
// первая раскладка _center уходила в control, вторая возвращалась (замер на
// стенде — `rows-wrapper-wrapper is-centering-to-control` ×6 против 0 в личке).
// Плашка канала обязана требовать ТОЧНО известные права.
import { describe, it, expect } from 'vitest'
import { computeControlPlates, type ControlPlateInput } from './controlPlates'

const base: ControlPlateInput = {
  composerUsable: true, permissionsKnown: true, isGroup: false, canSendText: true,
  botStart: false, secretLocked: false, threadClosed: false,
}

describe('computeControlPlates: плашка канала ждёт права', () => {
  it('права канала ещё не приехали — плашки НЕТ (иначе футер мигает на каждом входе)', () => {
    expect(computeControlPlates({ ...base, composerUsable: false, permissionsKnown: false }).channelMutePlate).toBe(false)
  })

  it('права приехали и писать нельзя — плашка есть', () => {
    expect(computeControlPlates({ ...base, composerUsable: false, permissionsKnown: true }).channelMutePlate).toBe(true)
  })

  it('писать можно — плашки нет', () => {
    expect(computeControlPlates(base).channelMutePlate).toBe(false)
  })

  // Ожидание прав не должно молча гасить остальные плашки: у них свои источники,
  // карточки канала они не ждут.
  it('бот без истории / секретный чат / закрытый тред не зависят от готовности прав', () => {
    const pending = { ...base, composerUsable: false, permissionsKnown: false }
    expect(computeControlPlates({ ...pending, botStart: true }).botStartPlate).toBe(true)
    expect(computeControlPlates({ ...pending, secretLocked: true }).secretPlate).toBe(true)
    expect(computeControlPlates({ ...pending, threadClosed: true }).channelMutePlate).toBe(false)
    expect(computeControlPlates({ ...pending, isGroup: true, canSendText: false }).groupRestricted).toBe(true)
  })

  // Приоритет цепочки (tweb haveSomethingInControl): сработавшая ветка съедает флаг.
  it('приоритет: botStart > secret > groupRestricted > channelMute', () => {
    const all = { ...base, composerUsable: false, isGroup: true, canSendText: false, botStart: true, secretLocked: true }
    const p = computeControlPlates(all)
    expect([p.botStartPlate, p.secretPlate, p.groupRestricted, p.channelMutePlate]).toEqual([true, false, false, false])
  })
})

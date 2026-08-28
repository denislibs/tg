// Стек слоёв под кнопку «Назад». Пин вето (`onPop` → false): слой отказывается
// сниматься и обязан вернуться на своё место вместе со своей записью истории —
// порт tweb appNavigationController.handleItem (:290-303).
//
// Дефект, ради которого написан файл: вето не было вовсе, и Back во время
// полёта мувера медиавьювера снимал его слой НАВСЕГДА — вьювер при этом
// оставался открытым (его close() во время полёта отклоняется), а следующий
// Back уходил уже в навигацию чата.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pushLayer, removeLayer, setBaseHandler } from './navigationStack'

const pop = () => window.dispatchEvent(new PopStateEvent('popstate'))

beforeEach(() => {
  // Базовый слой — чтобы было видно, когда Back «проваливается» мимо оверлеев.
  setBaseHandler(() => {})
})

describe('navigationStack — вето на снятие слоя', () => {
  it('onPop → false: слой остаётся, повторный Back зовёт его снова', () => {
    let veto = true
    const onPop = vi.fn(() => (veto ? false : undefined))
    pushLayer(onPop)

    pop()
    expect(onPop).toHaveBeenCalledTimes(1)

    // Слой на месте: следующий Back снова достаётся ему, а не базовому слою.
    veto = false
    pop()
    expect(onPop).toHaveBeenCalledTimes(2)

    // Теперь он снят — третий Back до него уже не доходит.
    pop()
    expect(onPop).toHaveBeenCalledTimes(2)
  })

  it('вето возвращает и запись истории — чужую removeLayer потом не откусит', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    const pushState = vi.spyOn(history, 'pushState')

    const layer = pushLayer(() => false)
    pushState.mockClear()

    pop()
    // Запись истории, съеденную этим popstate, стек вернул сам.
    expect(pushState).toHaveBeenCalledTimes(1)

    // Программное снятие того же слоя «съедает» РОВНО свою запись.
    removeLayer(layer)
    expect(back).toHaveBeenCalledTimes(1)

    // history.back() замокан, значит popstate «съедания» не придёт — гасим
    // взведённый ignorePop вручную, иначе он проглотит Back следующего теста.
    pop()

    back.mockRestore()
    pushState.mockRestore()
  })

  it('вето нижнего слоя не путает порядок: верхний снимается первым', () => {
    const bottom = vi.fn(() => false as const)
    const top = vi.fn()
    pushLayer(bottom)
    const topLayer = pushLayer(top)

    pop()
    expect(top).toHaveBeenCalledTimes(1)
    expect(bottom).not.toHaveBeenCalled()

    pop()
    expect(bottom).toHaveBeenCalledTimes(1)
    // …и вернулся на своё место
    pop()
    expect(bottom).toHaveBeenCalledTimes(2)

    removeLayer(topLayer) // уже снят Back'ом — no-op
  })
})

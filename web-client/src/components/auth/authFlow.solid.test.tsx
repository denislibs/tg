/** @jsxImportSource solid-js */
/**
 * Пины каркаса роутинга шага входа (`authFlow.solid.tsx`, порт tweb
 * `src/pages/authFlow.tsx`). Три факта — устройство ОРИГИНАЛА, а не наша
 * привычка (React-хост держит шаг в `useState`, см. `AuthFlow.tsx:203`):
 *
 *  1. шаг живёт в СОБСТВЕННОМ модульном корне — `navigateAuth`, вызванный
 *     снаружи любого Solid-дерева, двигает то, что видно ЛЮБОМУ читателю;
 *  2. `matchCard` сужает тип текущего шага и отдаёт null для чужого;
 *  3. стартовый шаг можно поставить ДО того, как что-либо его прочитает —
 *     порт `mountAuthFlow.tsx:29` (`navigateAuth` вызывается ДО `render`).
 *
 * Модульный сигнал существует один раз на процесс — каждый кейс поднимает
 * СВЕЖИЙ модуль (`vi.resetModules()` + динамический импорт ПОСЛЕ сброса),
 * иначе тесты делили бы один и тот же `currentCard`, и результат зависел бы
 * от порядка запуска (тот же приём, что `core/mediaUrl.reset.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'

let m: typeof import('./authFlow.solid')

beforeEach(async () => {
  vi.resetModules()
  m = await import('./authFlow.solid')
})

describe('authFlow.solid — каркас роутинга', () => {
  it('шаг живёт в собственном корне: navigateAuth снаружи компонента двигает current', () => {
    expect(m.currentCard()).toBeNull()

    m.navigateAuth({ name: 'signIn' })
    expect(m.currentCard()).toEqual({ name: 'signIn' })

    m.navigateAuth({ name: 'signQR' })
    expect(m.currentCard()).toEqual({ name: 'signQR' })
  })

  it('matchCard сужает тип и отдаёт null для чужого шага', () => {
    m.navigateAuth({ name: 'authCode', payload: { phone: '+79001234567' } })

    expect(m.matchCard('authCode')()).toEqual({ name: 'authCode', payload: { phone: '+79001234567' } })
    expect(m.matchCard('signIn')()).toBeNull()
    expect(m.matchCard('password')()).toBeNull()
  })

  it('стартовый шаг можно поставить ДО монтирования хоста', () => {
    // Порт mountAuthFlow.tsx:29 — navigateAuth зовётся ДО render(). "Монтирование"
    // здесь — любое НОВОЕ обращение к сигналу изнутри Solid-дерева; ловит
    // регресс "сигнал создаётся внутри компонента" — тогда до первого такого
    // обращения переход, случившийся раньше, этому дереву был бы не виден.
    m.navigateAuth({ name: 'signImport', payload: { webAuthToken: 'tok-1' } })

    const seenInsideRoot = createRoot((dispose) => {
      const value = m.currentCard()
      dispose()
      return value
    })

    expect(seenInsideRoot).toEqual({ name: 'signImport', payload: { webAuthToken: 'tok-1' } })
  })
})

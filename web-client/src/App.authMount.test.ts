// Пин точки монтирования экрана входа в App.tsx::ThemedApp (задача 6 волны 3:
// точка монтирования переехала с React <AuthFlow> на Solid mountAuthFlow()).
//
// Почему СКАН ИСХОДНИКА, а не рендер компонента — тот же приём и то же
// обоснование, что у `Chat.feedMount.test.ts` (см. её докблок): `App.tsx`
// нельзя отрендерить в vitest без реальных менеджеров/воркера/сокета, а норма
// покрытия проводки (web-client/CLAUDE.md, «Тесты») требует ЛИБО теста, ЛИБО
// пометки с причиной для КАЖДОЙ строки, которая создаёт точку монтирования.
//
// ── Ревью задачи 6, находка 4: скан краснел на ЗАКОННОЙ правке ──────────────
// Прежняя редакция сверяла точную ФОРМУ вызова регэкспом
// (`useLayoutEffect(() => { if (authed) return\n return mountAuthFlow({...})
// }, [...])` дословно) — поведение-сохраняющий рефактор
// (`const dispose = mountAuthFlow({...}); return dispose`) красил тест на
// исправном коде. Тот же класс дефекта, что уже осуждён в докблоке
// `shared/solid/boundary.test.ts` («прежняя редакция сверяла исходник
// регэкспами и краснела бы на законной правке»). Здесь смотрим на ПРЕДМЕТ —
// вызов существует, лежит внутри `useLayoutEffect` (а не в теле рендера
// безусловно — иначе остров пересоздавался бы на каждый рендер), и между
// объявлением эффекта и вызовом есть слово `authed` (гейт никуда не делся) —
// а не на точный текст вызова. Точную форму вызова (managers/onComplete)
// проверяет `tsc --noEmit`: `mountAuthFlow` типизирован `AuthCardsHostProps`
// (managers/onComplete обязательны), пропуск любого из них — ошибка типов,
// а не предмет текстового скана.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP_TSX = readFileSync(join(__dirname, 'App.tsx'), 'utf8')

/** Тело именованной функции — балансом фигурных скобок, а не regex до `}`. */
function extractFunctionBody(src: string, name: string): string {
  const marker = `function ${name}(`
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`функция ${name} не найдена`)
  const braceStart = src.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  throw new Error(`не сбалансированы скобки функции ${name}`)
}

const THEMED_APP = extractFunctionBody(APP_TSX, 'ThemedApp')

describe('App.tsx — точка монтирования экрана входа (Solid, не React)', () => {
  it('импортирует mountAuthFlow из Solid-моста, а не React AuthFlow', () => {
    expect(APP_TSX).toContain("from './components/auth/mountAuthFlow.solid'")
    // Второй, React-версии, в дереве больше нет — ни импорта, ни JSX-ветки.
    expect(APP_TSX).not.toMatch(/from '\.\/components\/auth\/AuthFlow'/)
    expect(APP_TSX).not.toContain('<AuthFlow')
  })

  it('mountAuthFlow вызывается внутри ThemedApp, а не только импортируется', () => {
    expect(THEMED_APP).toMatch(/\bmountAuthFlow\s*\(/)
  })

  // Вызов обязан лежать ВНУТРИ эффекта (не в теле рендера безусловно —
  // иначе остров пересоздавался бы на каждый рендер), и между объявлением
  // эффекта и вызовом обязано остаться слово `authed` — гейт монтирования.
  // Форма самого гейта (`if (authed) return`, `!authed &&`, …) — не предмет:
  // важно, что УСЛОВИЕ на authed вообще есть между этими двумя точками.
  it('mountAuthFlow вызывается внутри useLayoutEffect, гейтированного authed', () => {
    const effectIdx = THEMED_APP.indexOf('useLayoutEffect(')
    const callIdx = THEMED_APP.indexOf('mountAuthFlow(')
    expect(effectIdx, 'useLayoutEffect не найден в ThemedApp').toBeGreaterThanOrEqual(0)
    expect(callIdx, 'mountAuthFlow не найден в ThemedApp').toBeGreaterThanOrEqual(0)
    expect(callIdx, 'mountAuthFlow вызывается ДО ближайшего useLayoutEffect').toBeGreaterThan(effectIdx)

    const between = THEMED_APP.slice(effectIdx, callIdx)
    expect(between, 'между useLayoutEffect и mountAuthFlow нет условия на authed').toContain('authed')
  })

  it('Shell по-прежнему рендерится (второй ветки на AuthFlow не осталось)', () => {
    expect(THEMED_APP).toContain('<Shell')
  })
})

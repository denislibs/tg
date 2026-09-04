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
// регэкспами и краснела бы на законной правке»).
//
// ── Повторное ревью, ОБЯЗАТЕЛЬНО 1: индекс — не вложенность ─────────────────
// Первая правка на находку 4 сравнивала только ПОРЯДОК индексов
// (`indexOf('useLayoutEffect(') < indexOf('mountAuthFlow(')`), а не то, что
// вызов лежит ВНУТРИ ТЕЛА эффекта — хотя название теста заявляло именно
// вложенность. Ревьюер вынес вызов ИЗ эффекта в тело рендера:
//
//   useLayoutEffect(() => { if (authed) return }, [authed, managers])
//   if (!authed) mountAuthFlow({ managers, onComplete: login })
//
// — индекс `mountAuthFlow(` по-прежнему шёл ПОСЛЕ индекса `useLayoutEffect(`,
// а слово `authed` по-прежнему лежало МЕЖДУ ними (в самом эффекте) — оба
// прежних ассерта проходили, полный прогон 528/4486 оставался зелёным, хотя
// это настоящий дефект: остров пересоздаётся на каждый рендер `ThemedApp` и
// никогда не диспозится (эффект без `mountAuthFlow` внутри — no-op, cleanup
// снимать нечего). Теперь тело эффекта извлекается БАЛАНСОМ ФИГУРНЫХ СКОБОК —
// тем же приёмом, что уже применён здесь для тела `ThemedApp` (см.
// `extractBraceBalanced`/`extractFunctionBody` ниже), и `mountAuthFlow(`
// обязана найтись ВНУТРИ этого извлечённого блока, а не где-то дальше по
// тексту функции.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP_TSX = readFileSync(join(__dirname, 'App.tsx'), 'utf8')

/** Блок `{...}`, начинающийся на `src[braceStart]` (обязана быть `{`) — балансом скобок. */
function extractBraceBalanced(src: string, braceStart: number): string {
  if (src[braceStart] !== '{') {
    throw new Error(`ожидалась '{' на позиции ${braceStart}, найдено: ${JSON.stringify(src[braceStart])}`)
  }
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  throw new Error('не сбалансированы скобки')
}

/** Тело именованной функции — балансом фигурных скобок, а не regex до `}`. */
function extractFunctionBody(src: string, name: string): string {
  const marker = `function ${name}(`
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`функция ${name} не найдена`)
  return extractBraceBalanced(src, src.indexOf('{', start))
}

/**
 * Тела ВСЕХ callback'ов `useLayoutEffect(...)` внутри `src` — балансом скобок
 * от первой `{` после каждого маркера, а не индексом до произвольной точки
 * дальше по тексту. Именно это закрывает находку 1: раньше скан проверял
 * лишь порядок индексов двух подстрок («useLayoutEffect раньше mountAuthFlow
 * где-то по тексту»), теперь — что вызов реально лежит МЕЖДУ открывающей и
 * СВОЕЙ закрывающей скобкой КОНКРЕТНОГО эффекта. Собираются ВСЕ эффекты (а
 * не только первый) — предмет пина «существует эффект, который монтирует
 * auth-экран», а не «это именно первый по счёту эффект `ThemedApp`»: второе
 * было бы случайной привязкой к сегодняшнему порядку хуков.
 */
function extractUseLayoutEffectBodies(src: string): string[] {
  const marker = 'useLayoutEffect('
  const bodies: string[] = []
  let searchFrom = 0
  for (;;) {
    const start = src.indexOf(marker, searchFrom)
    if (start === -1) break
    const braceStart = src.indexOf('{', start)
    if (braceStart === -1) throw new Error('открывающая { тела эффекта не найдена')
    const body = extractBraceBalanced(src, braceStart)
    bodies.push(body)
    searchFrom = braceStart + body.length
  }
  if (bodies.length === 0) throw new Error('useLayoutEffect не найден')
  return bodies
}

const THEMED_APP = extractFunctionBody(APP_TSX, 'ThemedApp')

describe('App.tsx — точка монтирования экрана входа (Solid, не React)', () => {
  it('импортирует mountAuthFlow из Solid-моста, а не React AuthFlow', () => {
    expect(APP_TSX).toContain("from './components/auth/mountAuthFlow.solid'")
    // Второй, React-версии, в дереве больше нет — ни импорта, ни JSX-ветки.
    expect(APP_TSX).not.toMatch(/from '\.\/components\/auth\/AuthFlow'/)
    expect(APP_TSX).not.toContain('<AuthFlow')
  })

  // Вызов обязан лежать ВНУТРИ ТЕЛА эффекта (не в теле рендера безусловно, и
  // не просто «где-то дальше по файлу после слова useLayoutEffect» — иначе
  // остров пересоздавался бы на каждый рендер и никогда не диспозился), а
  // внутри этого же тела обязано остаться слово `authed` — гейт монтирования
  // никуда не делся. Форма самого гейта (`if (authed) return`, `!authed &&`,
  // …) — не предмет: важно, что УСЛОВИЕ на authed вообще есть в теле эффекта,
  // а не только рядом с ним по тексту.
  it('mountAuthFlow вызывается ВНУТРИ ТЕЛА useLayoutEffect, гейтированного authed', () => {
    const bodies = extractUseLayoutEffectBodies(THEMED_APP)
    const mountingEffect = bodies.find((body) => /\bmountAuthFlow\s*\(/.test(body))
    expect(mountingEffect, 'ни один useLayoutEffect в ThemedApp не вызывает mountAuthFlow внутри своего тела').not.toBeUndefined()
    expect(mountingEffect, 'внутри тела эффекта, вызывающего mountAuthFlow, нет условия на authed').toContain('authed')
  })

  it('Shell по-прежнему рендерится (второй ветки на AuthFlow не осталось)', () => {
    expect(THEMED_APP).toContain('<Shell')
  })
})

// Троттлинг (`helpers/schedulers/throttle.ts`, порт tweb
// `helpers/schedulers/throttle.ts`).
//
// Пиним ДВА разных предмета:
//  1. поведение обоих режимов оригинала. Сквозной («вызвал — исполнилось»)
//     троттлинг обязан красить эти тесты: на нём держится и таймкод видео
//     (`timeupdate` летит ~4 Гц, перерисовка раз в секунду), и персист ширины
//     колонок (запись настроек на каждый тик драга), и выбор пина по скроллу;
//  2. отсутствие локальных копий — сканом исходников (по образцу
//     `core/scrollWriters.test.ts`): копии уже расходились с оригиналом
//     (`wrappers/video.ts` — trailing-only на setTimeout, `usePinnedBar` —
//     свой leading, `core/dom/updateColumnWidths.ts` — свой leading+trailing).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import throttle from './throttle'

describe('throttle — leading + trailing (shouldRunFirst по умолчанию)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('первый вызов исполняется сразу', () => {
    const fn = vi.fn()
    throttle(fn, 100)()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('пачка вызовов внутри окна схлопывается в ОДИН отложенный — с ПОСЛЕДНИМИ аргументами', () => {
    const fn = vi.fn<(v: number) => void>()
    const throttled = throttle(fn, 100)

    throttled(1)
    throttled(2)
    throttled(3)
    expect(fn.mock.calls).toEqual([[1]])

    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [3]])

    // окно прошло без новых вызовов — интервал снимается, следующий вызов снова ведущий
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    throttled(4)
    expect(fn.mock.calls).toEqual([[1], [3], [4]])
  })

  it('поток вызовов исполняется не чаще, чем раз в ms', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)

    for (let i = 0; i < 50; ++i) {
      throttled()
      vi.advanceTimersByTime(10)
    }

    // 500 мс потока: ведущий + один на каждое окно
    expect(fn).toHaveBeenCalledTimes(6)
  })
})

describe('throttle — trailing-only (shouldRunFirst = false)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('первый вызов НЕ исполняется сразу — только через ms', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 1000, false)

    throttled()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(999)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('частые вызовы (timeupdate видео) дают один запуск на окно, с последними аргументами', () => {
    const fn = vi.fn<(v: number) => void>()
    const throttled = throttle(fn, 1000, false)

    // ~4 Гц в течение двух секунд
    for (let i = 1; i <= 8; ++i) {
      throttled(i)
      vi.advanceTimersByTime(250)
    }

    expect(fn.mock.calls).toEqual([[4], [8]])
  })
})

describe('throttle — clear()', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('снимает отложенный запуск (снятие листенера на размонтировании)', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100, false)

    throttled()
    throttled.clear()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('после clear() троттлинг снова рабочий', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100, false)

    throttled()
    throttled.clear()
    throttled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ── Пин: одна реализация троттлинга ─────────────────────────────────────────
const SRC = join(__dirname, '..', '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Объявление собственного троттлинга: `function throttle[Something](`/`<` или
 * `const throttle[Something] =`. Имя обязано начинаться со `throttle` и
 * продолжаться заглавной (`throttleMeasurement`, `throttleTrailing`) либо
 * заканчиваться — так переменные вызова (`const throttledTimeUpdate = throttle(...)`)
 * в скан не попадают: они потребители, а не вторая реализация.
 */
const DECL_RE = /(?:function|const)\s+throttle(?:[A-Z_]\w*)?\s*[<(=]/g

/**
 * Обоснованные объявления вне общего порта — путь относительно `src/` → число.
 * Рост числа/новый файл = вернулась локальная копия: правь список руками.
 */
const ALLOWED: Record<string, number> = {
  // Сам порт.
  'helpers/schedulers/throttle.ts': 1,
  // `throttleMeasurement` — ЛОКАЛЬНЫЙ хелпер самого tweb, а не копия общего
  // троттлинга: он ставит одиночный `setTimeout` на измерение скролла и живёт
  // прямо в файле скроллера. В tweb он тоже продублирован в двух скроллерах
  // (`components/scrollable.ts:53`, `components/scrollable2.tsx:11`) — наши два
  // вхождения повторяют оригинал файл-в-файл.
  'components/scrollable.ts': 1,
  'components/virtual/VerticalVirtualList.tsx': 1,
}

describe('троттлинг: единственная реализация — helpers/schedulers/throttle.ts', () => {
  it('локальных копий нет, число объявлений у известных не выросло', () => {
    const actual: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      const count = (codeOf(file).match(DECL_RE) ?? []).length
      if (count > 0) actual[rel] = count
    }

    expect(actual).toEqual(ALLOWED)
  })

  it('потребители берут троттлинг из общего модуля', () => {
    for (const rel of [
      'components/wrappers/video.ts',
      'core/dom/updateColumnWidths.ts',
      'core/hooks/usePinnedBar.ts',
    ]) {
      expect(codeOf(join(SRC, rel))).toContain("from '@helpers/schedulers/throttle'")
    }
  })
})

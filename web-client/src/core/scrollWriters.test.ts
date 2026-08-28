// src/core/scrollWriters.test.ts
//
// Инвариант этапа 2.1 (scroll helpers): позицией скролла владеют портированные
// `components/scrollable.ts` (Scrollable) и `helpers/scrollSaver.ts` (ScrollSaver).
// Оба пишут `scrollTop` НЕ буквальным `.scrollTop = `, а через динамическое свойство
// (`this.container[this.scrollPositionProperty] = value` в Scrollable — tweb-приём,
// один класс обслуживает и вертикальный, и горизонтальный скролл), поэтому сами в
// этот скан не попадают — весь буквальный `.scrollTop <op>= ` вне их периметра.
//
// СКОУП: только ПРЯМАЯ числовая запись поля (`=`/`+=`/`-=`/`*=`/`/=`) — та форма,
// которой писала САМОДЕЛЬНАЯ база до порта (`sc.scrollTop += d`, живой пример —
// см. `git log`/task-report'ы предыдущих задач). `scrollTo(...)`/`scrollIntoView(...)`
// сознательно НЕ сканируются — это другая категория: нативные API, которые сами
// порождают настоящие 'scroll'-события по ходу анимации, поэтому Scrollable.onScroll
// видит их как обычный скролл (throttled onAdditionalScroll/checkForTriggers
// отрабатывают штатно) — они не тихие и не конкурируют с
// setScrollPositionSilently/ScrollSaver за корректирующую запись, которая тихая
// по построению. Отсюда и число вызовов `scrollTo`/`scrollIntoView` по всему
// приложению НЕ фиксируется этим пином — они не тот класс писателя, который этот
// тест обязан ловить.
//
// Форма — по образцу `core/state/noAdHocReads.test.ts` и `stores/noManualOrder.test.ts`:
// читаем исходники текстом, а не импортируем модули (импорт ничего не скажет о ТОМ,
// КАК записан scrollTop). Каждый писатель ниже разобран и обоснован (Задача 5,
// task-5-report.md); список — в web-client/CLAUDE.md, раздел «Скролл». Появление
// нового писателя или рост числа записей у уже известного — осознанное решение:
// правь список руками, а не подгоняй код под тест.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

/**
 * Прямая числовая запись `.scrollTop` — `=`/`+=`/`-=`/`*=`/`/=`, не `==`/`===`/
 * `>=`/`<=` (negative lookahead на `=` ловит сравнения). Компаунд-операторы
 * обязательны: `sc.scrollTop += d` — реальная форма, которой писала база до
 * порта (не гипотетическая) и самый вероятный способ тихо вернуть писателя.
 */
const WRITE_RE = /\.scrollTop\s*[-+*/]?=(?!=)/g

/**
 * Обоснованные прямые писатели `scrollTop` вне Scrollable/ScrollSaver. Путь
 * относительно `src/` → ожидаемое число записей.
 */
const ALLOWED: Record<string, number> = {
  // Вендор tweb (Задача 3, `helpers/scrollSaver.ts`) — 1:1 порт, не наш код:
  // `save()` читает через деструктуризацию (не пишет), `restore()`/конструктор
  // пишут поле `this.scrollTop` (снапшот позиции, ОДНОимённое с DOM-свойством,
  // но это поле класса, не DOM) — 3 присваивания.
  'helpers/scrollSaver.ts': 3,
  // components/DatePickerPopup.tsx:195 — одноразовая начальная позиция при
  // открытии попапа календаря (месяц initDate), ДО первого показа. Попап, не
  // лента; нет ни подгрузки контента, ни необходимости восстанавливать позицию.
  'components/DatePickerPopup.tsx': 1,
  // components/conversation/TopbarSearch.tsx:219 — центрирование активной строки
  // выдачи поиска по стрелкам, формула 1:1 из tweb (topbarSearch.tsx:678-681).
  // Изолированный дропдаун, не лента сообщений.
  'components/conversation/TopbarSearch.tsx': 1,
  // components/virtual/useShouldAnimate.ts (createScrollShiftCompensator) — порт
  // побочного эффекта `verticalVirtualList.tsx:49-53`: когда ВСЕ видимые строки
  // виртуального списка чатов сдвинулись на одинаковое число позиций,
  // `useShouldAnimate` отменяет их анимацию `top` и ВМЕСТО неё компенсирует
  // scrollTop на ту же величину — список визуально стоит на месте. Список чатов
  // не ходит через Scrollable/ScrollSaver: у него нет ни подгрузки контента НАД
  // вьюпортом (новое приходит сверху, но окно строк считается арифметикой от
  // `scrollTop`, а не восстановлением позиции), ни второго писателя, с которым
  // эта тихая запись могла бы конкурировать. Функция экспортирована здесь же (не в будущем
  // `VerticalVirtualList.tsx`, Task 5) — это парный механизм самого
  // `useShouldAnimate`: тот решает КОГДА компенсировать, эта функция — КАК.
  'components/virtual/useShouldAnimate.ts': 1,
}

describe('scrollTop: единственный владелец — Scrollable/ScrollSaver', () => {
  it('прямых писателей вне allow-list нет, число записей у известных не выросло', () => {
    const actual: Record<string, number> = {}
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      const raw = readFileSync(file, 'utf8')
      // Комментарии выкидываем: и вендорные закомментированные ветки
      // (fastSmoothScroll.ts хранит неиспользуемый набросок с `container.scrollTop =`
      // внутри /* */ — код не исполняется), и наши собственные пояснения не должны
      // фальшиво засчитываться как запись.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
      const count = (code.match(WRITE_RE) ?? []).length
      if (count > 0) actual[rel] = count
    }

    expect(actual).toEqual(ALLOWED)
  })
})

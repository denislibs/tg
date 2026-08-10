// src/core/scrollWriters.test.ts
//
// Инвариант этапа 2.1 (scroll helpers): позицией скролла владеют портированные
// `components/scrollable.ts` (Scrollable) и `helpers/scrollSaver.ts` (ScrollSaver).
// Оба пишут `scrollTop` НЕ буквальным `.scrollTop = `, а через динамическое свойство
// (`this.container[this.scrollPositionProperty] = value` в Scrollable — tweb-приём,
// один класс обслуживает и вертикальный, и горизонтальный скролл), поэтому сами в
// этот скан не попадают — весь буквальный `.scrollTop = ` вне их периметра.
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

/** Прямая запись `.scrollTop = ...` — не `==`/`===`/`>=`/`<=` (negative lookahead на `=`). */
const WRITE_RE = /\.scrollTop\s*=(?!=)/g

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
  // core/hooks/useChatScroll.ts:95 — фолбэк внутри setScrollTopSilently на то
  // единственное окно между монтированием React-узла и коммитом эффекта, который
  // создаёт Scrollable (scrollableRef.current ещё null): как только Scrollable
  // смонтирован, вся корректирующая запись идёт через его
  // setScrollPositionSilently, эта ветка больше не исполняется.
  'core/hooks/useChatScroll.ts': 1,
  // core/dom/smoothScrollToElement.ts:15 — одноразовый cap-прыжок перед нативным
  // `container.scrollTo({behavior:'smooth'})` при центрировании бабла
  // (jump-to-message). Не дублирует ScrollSaver (тот хранит и восстанавливает
  // позицию при пересчёте контента над вьюпортом, тут разовая анимация к цели) и
  // не портируется на вендорный `fastSmoothScroll` — перевод плавных скроллов
  // приложения на него вне периметра этого этапа (см. task-5-brief.md, Self-Review).
  'core/dom/smoothScrollToElement.ts': 1,
  // core/hooks/useSidebarFolders.tsx:59 — сброс списка чатов на верх при смене
  // таба папки. У нас один общий скролл-контейнер на все папки (ChatList.tsx,
  // комментарий над `<div ref={setScrollRef}>`), а не отдельный
  // `.folders-scrollable` на каждую, как в tweb, — эта строка замещает то, что
  // tweb получает бесплатно (свежий контейнер новой папки стартует с
  // scrollTop=0). Список чатов не ходит через Scrollable/ScrollSaver — это не
  // лента с динамической подгрузкой контента сверху/снизу.
  'core/hooks/useSidebarFolders.tsx': 1,
  // components/DatePickerPopup.tsx:195 — одноразовая начальная позиция при
  // открытии попапа календаря (месяц initDate), ДО первого показа. Попап, не
  // лента; нет ни подгрузки контента, ни необходимости восстанавливать позицию.
  'components/DatePickerPopup.tsx': 1,
  // components/conversation/TopbarSearch.tsx:219 — центрирование активной строки
  // выдачи поиска по стрелкам, формула 1:1 из tweb (topbarSearch.tsx:678-681).
  // Изолированный дропдаун, не лента сообщений.
  'components/conversation/TopbarSearch.tsx': 1,
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

import { describe, expect, it } from 'vitest'
import { SOLID_FILE_PATTERN, isSolidFile } from './fileRuntime'

// Ревью задачи 1 нашёл Critical: `react({exclude:[/\.solid\.tsx?$/]})` не
// исключал `*.solid.test.tsx` (регэксп требовал `solid` прямо перед `.tsx`,
// а в этом имени перед `.tsx` стоит `test`), хотя `solid({include:[...]})`
// такой файл БРАЛ. Файл, попавший под оба плагина, преобразуется дважды —
// ровно то, что комментарий у блока `plugins` объявлял недопустимым.
//
// Тест проверяет не два независимых текста, а ОДИН экспортируемый паттерн,
// который vite.config.ts подставляет и в `solid({include})`, и в
// `react({exclude})` — поэтому совпадение/несовпадение здесь равно
// совпадению/несовпадению в обеих конфигурациях сразу.
describe('SOLID_FILE_PATTERN — маска взаимоисключающих JSX-рантаймов', () => {
  it('простое имя *.solid.tsx принадлежит Solid-рантайму', () => {
    expect(isSolidFile('mountSolid.solid.tsx')).toBe(true)
  })

  it('тестовое имя *.solid.test.tsx тоже принадлежит Solid-рантайму', () => {
    // Это ровно тот файл, на котором падала прежняя маска.
    expect(isSolidFile('transform.solid.test.tsx')).toBe(true)
  })

  it('обычный React-файл не попадает под маску Solid', () => {
    expect(isSolidFile('MessageBubble.tsx')).toBe(false)
    expect(isSolidFile('useSomething.ts')).toBe(false)
  })

  it('регрессия Critical-находки: старый паттерн /\\.solid\\.tsx?$/ пропускал *.solid.test.tsx мимо react-исключения', () => {
    const buggyPattern = /\.solid\.tsx?$/

    // Старый паттерн не видел файл — react() его НЕ исключал, а solid() уже
    // включал через отдельный список '**/*.solid.test.tsx': файл попадал под оба.
    expect(buggyPattern.test('transform.solid.test.tsx')).toBe(false)

    // Текущий паттерн видит оба варианта имени — исключение react() и
    // включение solid() описывают одно и то же множество файлов.
    expect(SOLID_FILE_PATTERN.test('mountSolid.solid.tsx')).toBe(true)
    expect(SOLID_FILE_PATTERN.test('transform.solid.test.tsx')).toBe(true)
  })
})

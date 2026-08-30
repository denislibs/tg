// Ядро локализации проверяется ПОВЕДЕНИЕМ: что показал узел, тот ли это узел и
// какую форму числа выбрал язык. Сверять поля объекта строки бессмысленно —
// такая проверка зеленеет и на сломанном выборе формы.
//
// Строки берутся из настоящего `lang.ts` через `formatLocalStrings` — тем же
// путём, каким они попадут в ядро в бою (задача 5), а не выдуманным фикстурным
// словарём: иначе тест проверял бы фикстуру.
import { beforeEach, describe, expect, it } from 'vitest'

import type { LangPackString } from '@layer'
import lang, { type LangPackKey } from '@/lang'

import I18n, { i18n, join } from './langPack'

/** Применение языка — единственный вход, каким строки попадают в ядро. Через него
 *  же приходят ПРАВИЛА ЧИСЛА: они берутся из кода языка, а не из ключа. */
function apply(langCode: string, overrides: LangPackString[] = []) {
  const strings = I18n.formatLocalStrings(lang)
  strings.push(...overrides)
  I18n.setLangCode(langCode)
  I18n.applyLangPack({ _: 'langPackDifference', lang_code: langCode, from_version: 0, version: 1, strings })
}

const s = (key: string, value: string): LangPackString => ({ _: 'langPackString', key, value })

/** Ключей ссылки и порядковых аргументов в `lang.ts` пока нет — такие строки
 *  появятся при разборе склеенных предложений (задача 6). Разбору всё равно,
 *  объявлен ли ключ, поэтому здесь ключ приводится к типу ключа. */
const testKey = (key: string) => key as LangPackKey

beforeEach(() => {
  document.body.replaceChildren()
  apply('en')
  I18n.setTimeFormat('h23')
})

describe('аргументы подстановки', () => {
  it('подставляет число', () => {
    expect(i18n('DeleteMessagesCount', [3]).textContent).toBe('Delete 3 messages')
  })

  it('сохраняет узел узлом, а не превращает его в текст', () => {
    const badge = document.createElement('b')
    badge.textContent = 'Денис'

    const el = i18n('StorageQuota.ClearConfirmation', [badge])
    // Тот же САМЫЙ узел, а не копия и не `[object HTMLElement]`.
    expect(el.querySelector('b')).toBe(badge)
    expect(el.textContent).toBe('Are you sure you want to clear Денис of cached data?')
  })

  it('берёт аргумент по номеру, а не по порядку встречи', () => {
    apply('en', [s('Chat.Forwarded', 'From %2$s to %1$s')])
    expect(i18n(testKey('Chat.Forwarded'), ['Денис', 'Аня']).textContent).toBe('From Аня to Денис')
  })

  it('неизвестный ключ показывает сам ключ, а не пустоту', () => {
    expect(i18n(testKey('Chat.NoSuchKey')).textContent).toBe('Chat.NoSuchKey')
  })
})

describe('разметка строки словаря', () => {
  it('собирает жирный узлом и вставляет иконку вместо стрелки', () => {
    // 'Go to **Settings** > **Devices** > **Add Device**'
    const el = i18n('Login.QR.Help2')
    expect(Array.from(el.querySelectorAll('b')).map((b) => b.textContent))
      .toEqual(['Settings', 'Devices', 'Add Device'])
    expect(el.querySelectorAll('span.tgico.inline-icon').length).toBe(2)
  })

  it('переводит курсив и перенос строки в узлы', () => {
    apply('en', [s('Chat.Markup', '__italic__\nnext')])

    const el = i18n(testKey('Chat.Markup'))
    expect(el.querySelector('i')?.textContent).toBe('italic')
    expect(el.querySelector('br')).not.toBeNull()
  })

  it('ссылку собирает якорем с адресом, а не текстом со скобками', () => {
    apply('en', [s('Chat.Link', 'Read the [rules](https://telegram.org/tos)')])

    const a = i18n(testKey('Chat.Link')).querySelector('a')
    expect(a?.textContent).toBe('rules')
    expect(a?.getAttribute('href')).toBe('https://telegram.org/tos')
  })
})

// Формы числа — ГЛАВНОЕ отличие ядра от нашего прежнего способа, где суффикс стоял
// в ключе и форму выбирал вызывающий (`client/appBadge.ts:41`). Здесь форму выбирает
// ЯЗЫК, поэтому и проверяется она вызовом `i18n()` на разных числах.
describe('формы числа', () => {
  const RU_COUNT: LangPackString = {
    _: 'langPackStringPluralized',
    key: 'Notifications.Count',
    one_value: '%d уведомление',
    few_value: '%d уведомления',
    many_value: '%d уведомлений',
    other_value: '%d уведомления',
  }

  const count = (n: number) => i18n('Notifications.Count', [n]).textContent

  it('русский различает одну, несколько и много', () => {
    apply('ru', [RU_COUNT])

    expect(count(1)).toBe('1 уведомление')
    expect(count(3)).toBe('3 уведомления')
    expect(count(7)).toBe('7 уведомлений')
    // 21 — снова «one» по правилам русского: выбирает правило языка, а не «n === 1».
    expect(count(21)).toBe('21 уведомление')
  })

  it('английский различает одну и остальные', () => {
    apply('en')

    expect(count(1)).toBe('1 notification')
    expect(count(2)).toBe('2 notifications')
  })

  // Число 7 выбрано намеренно: у английского это `other`, у русского — `many`.
  // На числе 3 обе формы дали бы один и тот же текст, и тест прошёл бы зелёным
  // на правилах, оставшихся от прошлого языка.
  it('форма выбирается по языку пакета, а не по прошлому языку', () => {
    apply('en')
    expect(count(7)).toBe('7 notifications')

    apply('ru', [RU_COUNT])
    expect(count(7)).toBe('7 уведомлений')
  })
})

describe('IntlElement', () => {
  const el = (args?: number[]) => new I18n.IntlElement({ key: 'DeleteMessagesCount', args })

  it('compareAndUpdate не перестраивает содержимое при том же ключе и аргументах', () => {
    const instance = el([3])
    const before = Array.from(instance.element.childNodes)

    instance.compareAndUpdate({ key: 'DeleteMessagesCount', args: [3] })

    // Те же САМЫЕ узлы — не равные по тексту, а те же по ссылке.
    const after = Array.from(instance.element.childNodes)
    expect(after.length).toBe(before.length)
    after.forEach((node, i) => expect(node).toBe(before[i]))
    expect(instance.element.textContent).toBe('Delete 3 messages')
  })

  it('compareAndUpdate перестраивает содержимое, когда аргумент изменился', () => {
    const instance = el([3])
    instance.compareAndUpdate({ key: 'DeleteMessagesCount', args: [4] })

    expect(instance.element.textContent).toBe('Delete 4 messages')
  })

  it('compareAndUpdateBool сообщает, была ли перерисовка', () => {
    const instance = el([3])
    expect(instance.compareAndUpdateBool({ key: 'DeleteMessagesCount', args: [3] })).toBe(false)
    expect(instance.compareAndUpdateBool({ key: 'DeleteMessagesCount', args: [4] })).toBe(true)
  })

  it('в не-innerHTML свойство кладёт плоскую строку, а не узлы', () => {
    const input = document.createElement('input')
    // 'Hide my views from the past **%s**.'
    I18n._i18n(input, 'Stories.StealthMode.Row1.Subtitle', ['7 days'], 'placeholder')

    expect(input.placeholder).toBe('Hide my views from the past 7 days.')
    expect(input.childNodes.length).toBe(0)
  })
})

describe('применение языка к живым узлам', () => {
  it('узел, уже стоящий в документе, перерисовывается на месте', () => {
    const el = i18n('CurrentSession')
    document.body.append(el)
    expect(el.textContent).toBe('This device')

    apply('ru', [s('CurrentSession', 'Это устройство')])

    // ТОТ ЖЕ узел, не пересозданный.
    expect(el.parentElement).toBe(document.body)
    expect(el.textContent).toBe('Это устройство')
  })
})

// `IntlDateElement` сегодня без вызывающих: его позовёт `helpers/date.ts` задачей 7.
// Тесты тут не «на будущее»: в 12-часовой ветке живёт арифметика (`(hours % 12) || 12`,
// ведущий ноль, выбор am/pm по `hours < 12`), и полночь с полднем — ровно то место,
// где ошибаются на единицу. Без этих проверок ветка отработала бы в бою впервые.
describe('IntlDateElement', () => {
  const HHMM: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  // 31 августа 2026 — понедельник. Дата локальная, как и `getHours()` внутри.
  const at = (h: number, m: number) => new Date(2026, 7, 31, h, m)
  const time = (date: Date) => new I18n.IntlDateElement({ date, options: HHMM }).element.textContent
  const weekday = (date: Date) => new I18n.IntlDateElement({ date, options: { weekday: 'short' } }).element.textContent

  it('24-часовой формат печатает час как есть, с ведущим нулём', () => {
    I18n.setTimeFormat('h23')

    expect(time(at(0, 5))).toBe('00:05')
    expect(time(at(9, 5))).toBe('09:05')
    expect(time(at(13, 5))).toBe('13:05')
    expect(time(at(23, 59))).toBe('23:59')
  })

  it('12-часовой формат печатает полночь и полдень как 12, а не как 0', () => {
    I18n.setTimeFormat('h12')

    expect(time(at(0, 5))).toBe('12:05 AM')
    expect(time(at(12, 5))).toBe('12:05 PM')
    expect(time(at(11, 59))).toBe('11:59 AM')
    expect(time(at(13, 5))).toBe('01:05 PM')
    expect(time(at(23, 59))).toBe('11:59 PM')
  })

  it('смена формата времени перерисовывает живой узел на месте', () => {
    const el = new I18n.IntlDateElement({ date: at(13, 5), options: HHMM }).element
    document.body.append(el)
    expect(el.textContent).toBe('13:05')

    I18n.setTimeFormat('h12')

    expect(el.parentElement).toBe(document.body)
    expect(el.textContent).toBe('01:05 PM')
  })

  it('установка того же формата узел не трогает', () => {
    const el = new I18n.IntlDateElement({ date: at(13, 5), options: HHMM }).element
    document.body.append(el)
    const before = el.firstChild

    I18n.setTimeFormat('h23')

    // Тот же САМЫЙ текстовый узел: `textContent` при перерисовке создал бы новый.
    expect(el.firstChild).toBe(before)
  })

  it('прочие наборы опций идут через Intl, с заглавной буквы и на языке пакета', () => {
    expect(weekday(at(12, 0))).toBe('Mon')

    apply('ru')

    // «пн» от Intl — со строчной; метка стоит первой в ячейке, поэтому заглавная.
    // Заодно: формат не взят из кэша, оставшегося от английского.
    expect(weekday(at(12, 0))).toBe('Пн')
  })
})

describe('join', () => {
  it('перечисляет через разделители словаря', () => {
    expect(join(['a', 'b', 'c'], true, true)).toBe('a, b and c')
    expect(join(['a', 'b', 'c'], false, true)).toBe('a, b, c')
  })

  it('узлами перечисляет теми же узлами', () => {
    const first = document.createElement('b')
    const joined = join([first, 'b'], true) as (string | Node)[]
    expect(joined[0]).toBe(first)
    expect((joined[1] as HTMLElement).textContent).toBe(' and ')
  })
})

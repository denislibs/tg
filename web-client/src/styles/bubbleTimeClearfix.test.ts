// Резерв под время бабла, когда тело кончается БЛОКОМ (цитата, код).
//
// `span.time` — невидимая копия времени с `float: right`
// (tweb `_chatBubble.scss:1714-1731`), видимая `.time-inner` — абсолютная, с
// `bottom` от низа `.message` (там же, `:1771-1785`). Пока время влезает в
// последнюю строку текста, float встаёт в неё справа. Если тело кончается
// блоком, float уходит строкой НИЖЕ — но плавающий узел в высоту `.message` не
// входит, и `.time-inner` ложится поверх текста цитаты (дефект стенда: «в
// маленьком бабле с цитатой время наезжает на текст»).
//
// Высоту возвращает распорка: лента кладёт за временем `span.clearfix`
// (tweb `bubbles.ts:9029` `messageDiv.append(timeSpan, clearfix())`, пин
// разметки — `components/chat/bubbles.meta.test.ts`), а работает она двумя
// правилами оригинала:
//  • глобальным `.clearfix { clear: both; display: table }` (tweb
//    `base.scss:2328-2331`) — именно `clear` сносит распорку под float;
//  • баббловым `.clearfix { display: none }` + `.time + .clearfix
//    { display: table }` (`_chatBubble.scss:1858-1865`) — в бабле распорка
//    живёт только сразу за временем.
// Пин разметки остаётся зелёным без глобального правила (узел на месте,
// `clear` нет — время снова на цитате), поэтому здесь — НАСТОЯЩИЙ
// скомпилированный `styles/index.scss`, как в `timePart.test.ts`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/**
 * Тело бабла с цитатой в конце — цепочка из живого дампа tweb
 * (`docs/tweb/dom/dumps/03-bubbles-123.json`: `div.bubble` →
 * `div.bubble-content-wrapper` → `div.bubble-content` →
 * `div.message.spoilers-container` → … `span.time` → `span.clearfix`).
 */
function mountBody(): { message: HTMLElement, clearfix: HTMLElement } {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const bubble = document.createElement('div')
  bubble.className = 'bubble is-in'
  const wrapper = document.createElement('div')
  wrapper.className = 'bubble-content-wrapper'
  const content = document.createElement('div')
  content.className = 'bubble-content'
  const message = document.createElement('div')
  message.className = 'message spoilers-container'

  const quote = document.createElement('blockquote')
  quote.className = 'quote quote-block quote-like quote-like-border quote-like-icon'
  quote.textContent = 'цитата'
  const time = document.createElement('span')
  time.className = 'time'
  time.textContent = '12:34'
  const clearfix = document.createElement('span')
  clearfix.className = 'clearfix'

  message.append(quote, time, clearfix)
  content.append(message)
  wrapper.append(content)
  bubble.append(wrapper)
  document.body.append(bubble)
  return { message, clearfix }
}

describe('распорка за временем бабла (tweb base.scss:2328, _chatBubble.scss:1858-1865)', () => {
  it('за временем распорка — таблица с clear: both: float времени входит в высоту тела', () => {
    const { clearfix } = mountBody()
    const cs = getComputedStyle(clearfix)
    expect(cs.display).toBe('table')
    expect(cs.clear).toBe('both')
  })

  it('распорка НЕ за временем в бабле скрыта (у ряда реакций время внутри ряда)', () => {
    const { message, clearfix } = mountBody()
    message.querySelector('.time')!.remove()
    expect(getComputedStyle(clearfix).display).toBe('none')
  })
})

/** @jsxImportSource solid-js */
/**
 * Пины порта `badge.solid.tsx` (tweb `src/components/badge.tsx`).
 *
 * Проверяется узел в DOM: тег, набор классов и `is-badge-empty` — тот самый
 * класс, что гасит пустой счётчик папки (`styles/tweb/_badge.scss:21`, дамп
 * `docs/tweb/dom/dumps/14-left-01-chatlist.json:71` — вкладка без
 * непрочитанных несёт `div.badge.badge-20.badge-primary.is-badge-empty`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import Badge from './badge.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

describe('badge.solid', () => {
  it('счётчик папки: div.badge.badge-20.badge-primary с числом внутри, без is-badge-empty', () => {
    const el = mount(() => <Badge tag="div" size={20} color="primary">{3}</Badge>)

    const badge = el.firstElementChild as HTMLElement
    expect(badge.tagName).toBe('DIV')
    expect(badge.className).toBe('badge badge-20 badge-primary')
    expect(badge.textContent).toBe('3')
  })

  it('ноль непрочитанных — is-badge-empty (дамп :71): `!props.children` у оригинала ловит и 0', () => {
    const el = mount(() => <Badge tag="div" size={20} color="primary">{0}</Badge>)

    expect((el.firstElementChild as HTMLElement).className).toBe('badge badge-20 badge-primary is-badge-empty')
  })

  it('тег, размер, цвет и внешний класс берутся из пропов', () => {
    const el = mount(() => <Badge tag="span" size={24} color="gray" class="extra">{7}</Badge>)

    const badge = el.firstElementChild as HTMLElement
    expect(badge.tagName).toBe('SPAN')
    expect(badge.className).toBe('badge badge-24 badge-gray extra')
  })

  it('класс реактивен: счётчик 0 → 5 снимает is-badge-empty, цвет следует за muted', () => {
    const [count, setCount] = createSignal(0)
    const [muted, setMuted] = createSignal(false)
    const el = mount(() => (
      <Badge tag="div" size={20} color={muted() ? 'gray' : 'primary'}>{count()}</Badge>
    ))
    const badge = el.firstElementChild as HTMLElement
    expect(badge.classList.contains('is-badge-empty')).toBe(true)

    setCount(5)
    setMuted(true)

    expect(badge.className).toBe('badge badge-20 badge-gray')
    expect(badge.textContent).toBe('5')
  })
})

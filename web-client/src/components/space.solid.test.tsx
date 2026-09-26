/** @jsxImportSource solid-js */
// Порт tweb `src/components/space.tsx` (812502980) — вертикальный отступ
// экранов настроек (квота хранилища, автоудаление, код-пароль).
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import Space from './space.solid'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('Space', () => {
  it('отступ — padding-top ровно amount, без перехода по умолчанию', () => {
    dispose = render(() => <Space amount="1.125rem" />, document.body)
    const div = document.body.firstElementChild as HTMLDivElement

    expect(div.tagName).toBe('DIV')
    expect(div.style.paddingTop).toBe('1.125rem')
    expect(div.style.transition).toBe('')
  })

  it('withTransition даёт переход .2s; прочие атрибуты div доезжают до узла', () => {
    dispose = render(() => <Space amount="2rem" withTransition class="x" data-a="1" />, document.body)
    const div = document.body.firstElementChild as HTMLDivElement

    expect(div.style.transition).toBe('.2s')
    expect(div.className).toBe('x')
    expect(div.dataset.a).toBe('1')
    expect(div.hasAttribute('amount')).toBe(false)
  })
})

/** @jsxImportSource solid-js */
/**
 * Пины на два живых регресса, найденных на стенде в поле телефона Solid-версии
 * экрана входа (волна 3, этап 1): их не было у React-версии (`ceec28b2^`), она
 * работала правильно.
 *
 * Оба свелись к ОДНОМУ структурному дефекту в отражении `props.value` внутрь
 * contenteditable-узла: реакция `createEffect(on(() => props.value, …))`
 * (и симметричный код в `InputField.solid.tsx`) сверялась ГОЛЫМ
 * `el.textContent === value` — строковым равенством, а не структурой узла.
 * Chrome/Safari, удаляя ПОСЛЕДНИЙ символ contenteditable, оставляют внутри
 * одинокий `<br>` (`el.textContent` при этом всё равно `''` — известный квирк,
 * из-за которого rich-text-редакторы вроде Slate/ProseMirror отдельно чистят
 * такой «anchor `<br>`»). Guard видел совпадение строк и НИКОГДА не трогал DOM —
 * `<br>` оставался внутри поля навсегда:
 *   — дефект 1 (поле «пустое, без +»): реальное значение при этом СХЛОПЫВАЛОСЬ
 *     в тот же `'+'` через `SignInCard.solid.tsx::onPhoneInput` — то есть Solid-
 *     сигнал `phone` не менялся (уже был `'+'`), нижестоящий эффект по
 *     `props.value` не перезапускался, а `<br>` оставлял поле визуально пустым;
 *   — дефект 2 (поле выросло вдвое): `<br>` — настоящий перевод строки внутри
 *     ОДНОстрочного поля, второй (пустой) строки хватает, чтобы удвоить высоту.
 *
 * Исправление — `syncContentEditableValue` (`shared/lib/caret.ts`): сверяет не
 * строку, а структуру (единственный текстовый узел или вовсе никакого при
 * пустом значении), и вызывается ДВАЖДЫ внутри `onInput` — ДО передачи `raw`
 * владельцу (чистит структурный мусор, который уже мог принести браузер) и
 * ПОСЛЕ (синхронно подхватывает авторитетное значение владельца, даже если оно
 * совпало со старым и Solid-сигнал не подал вида).
 *
 * Высоту в happy-dom не измерить — пины ловят ПРИЧИНУ (структуру DOM), а не
 * симптом (число строк).
 */
import { describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import TelInput from './TelInput.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function unmount() {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
}

/** Мини-владелец: тот же контракт, что `SignInCard.solid.tsx::onPhoneInput` —
 *  одинокий «+» и полностью пустой ввод остаются/нормализуются к «+». */
function mount() {
  unmount()
  const [value, setValue] = createSignal('+7')
  const onInput = (raw: string) => {
    setValue(raw === '' || raw.replace(/\++/, '+') === '+' ? '+' : raw)
  }
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => <TelInput value={value()} leftPattern="" label="Phone" onInput={onInput} onEnter={() => {}} />,
    host,
  )
  return { el: () => host!.querySelector('[contenteditable]') as HTMLDivElement, value }
}

/** Симулирует Chrome/Safari-квирк: удаление последнего символа оставляет узел
 *  с одиноким `<br>` (не с настоящей пустотой). `el.textContent` при этом уже
 *  `''`, ровно как после реальной клавиши Backspace в браузере. */
function simulateNativeFullDelete(el: HTMLDivElement) {
  el.replaceChildren(document.createElement('br'))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('TelInput.solid: полное удаление значения (дефекты 1 и 2)', () => {
  it('пин 1 — после удаления всего значения поле не остаётся без «+»', () => {
    const { el, value } = mount()

    simulateNativeFullDelete(el())

    expect(value()).toBe('+')
    expect(el().textContent).toBe('+')
  })

  it('пин 2 — после удаления DOM не несёт лишних узлов (ни <br>, ни второго текстового узла, ни <div>)', () => {
    const { el } = mount()

    simulateNativeFullDelete(el())

    const node = el()
    // Один-единственный child — текстовый узел; никакого <br>/<div>/второго
    // текстового узла рядом, то есть узел не может дать вторую строку.
    expect(node.childNodes).toHaveLength(1)
    expect(node.firstChild!.nodeType).toBe(Node.TEXT_NODE)
    expect(node.querySelector('br')).toBeNull()
    expect(node.querySelector('div')).toBeNull()
  })

  it('пин 2 (регрессия при совпавшем значении) — <br> не переживает даже когда владелец вернул ТО ЖЕ значение, что уже было', () => {
    // Отдельно от пина 1: тут владелец УЖЕ на «+» (типизируем «+7»→«+» первым
    // Backspace), поэтому второе удаление — переход «+»→'' с ТЕМ ЖЕ конечным
    // «+» — ровно тот случай, где Solid-сигнал не меняется и голый reflect-
    // эффект по `props.value` не перезапускается.
    const { el, value } = mount()
    el().textContent = '+'
    el().dispatchEvent(new Event('input', { bubbles: true }))
    expect(value()).toBe('+')

    simulateNativeFullDelete(el())

    expect(value()).toBe('+')
    expect(el().textContent).toBe('+')
    expect(el().childNodes).toHaveLength(1)
    expect(el().firstChild!.nodeType).toBe(Node.TEXT_NODE)
  })
})

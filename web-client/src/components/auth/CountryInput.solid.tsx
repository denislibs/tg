/** @jsxImportSource solid-js */
// CountryInput — поле выбора страны на экране входа. Solid-порт нашего React
// `auth/CountryInput.tsx`, который сам — порт tweb `components/countryInputField.ts`
// (306 строк) поверх `components/inputField.ts`; дерево 1:1 с живым оригиналом
// (dom-референс §4.1/§4.2):
//
//   div.input-field.input-select
//     div.input-field-input[contenteditable]      ← НЕ <input>: InputField без plainText
//       span                                      ← имя страны кладётся элементом
//     div.input-field-border
//     label > span
//     span.arrow.arrow-down                       ← шеврон рисует CSS (border + rotate)
//     div.select-wrapper.z-depth-3(.hide|.active)
//       div.scrollable.scrollable-y > ul > li
//
// Своего CSS-модуля у компонента нет — как и у React-версии: всё глобальные
// партиалы tweb (`styles/tweb/_input.scss`, `_bridge.scss`, `_scrollable.scss`).
import { createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { i18n } from '@lib/langPack'
import { selectElementContents } from '@shared/lib/caret'
import { COUNTRIES, countryFlag, filterCountries, type Country } from './countries'

// tweb `hidePicker`: сначала снимается `.active` (проигрывается 200 мс переход
// opacity/transform), и только потом вешается `.hide` (`display: none`).
const HIDE_DELAY_MS = 200

export type CountryInputSolidProps = {
  value: Country | null
  onChange: (c: Country) => void
}

export default function CountryInput(props: CountryInputSolidProps): JSX.Element {
  let inputEl!: HTMLDivElement
  let wrapperEl!: HTMLDivElement
  let hideTimer = 0

  // Три состояния списка, как в tweb: `hide` (свёрнут) → без классов (кадр на
  // reflow) → `active` (раскрыт). Снятие `.hide` и навешивание `.active` в один
  // кадр убило бы переход, поэтому между ними — rAF (у tweb это `void offsetWidth`).
  const [hidden, setHidden] = createSignal(true)
  const [active, setActive] = createSignal(false)
  // null — фильтр не набран, показываем весь список.
  const [filter, setFilter] = createSignal<string | null>(null)
  const [empty, setEmpty] = createSignal(!props.value)

  // Значение поля — императивно: contenteditable мутирует браузер. Синхронизируем
  // на каждой отрисовке пропа, но только когда поле НЕ в фокусе — так набранный
  // фильтр не затирается, а `override` из поля телефона (tweb
  // `countryInputField.override`) возвращает имя страны на место.
  const syncValue = () => {
    if (!inputEl || document.activeElement === inputEl) return
    const name = props.value?.name ?? ''
    if (inputEl.textContent === name) return
    if (name) {
      // tweb `this.value = i18n(default_name)`: у него имя страны — ЛАНГ-КЛЮЧ.
      // У нас имя приходит данными (`Country.name`), ключа под ним нет — как и
      // у React-версии, просто текст, а не поддельный `i18n`-узел.
      const span = document.createElement('span')
      span.textContent = name
      inputEl.replaceChildren(span)
    } else {
      inputEl.replaceChildren()
    }
    setEmpty(!name)
  }

  // Пересчитывается на каждую смену `props.value` (аналог React-эффекта без
  // списка зависимостей — сверка идёт с ФАКТИЧЕСКИМ содержимым поля, а не
  // слепо перезаписывает его, поэтому цикла обновлений не будет).
  createEffect(() => { void props.value; syncValue() })

  const openPicker = () => {
    window.clearTimeout(hideTimer)
    hideTimer = 0
    setHidden(false)
    requestAnimationFrame(() => setActive(true))
  }

  const hidePicker = () => {
    if (hideTimer) return
    setActive(false)
    hideTimer = window.setTimeout(() => {
      hideTimer = 0
      setHidden(true)
    }, HIDE_DELAY_MS)
  }

  onCleanup(() => window.clearTimeout(hideTimer))

  // tweb: закрытие — `mousedown` в capture-фазе по документу, если цель не внутри
  // `.input-select`. Слушатель живёт на весь срок жизни компонента (проще, чем
  // React-версия с условным навешиванием по `hidden`, — снятие лишний раз не
  // страшно, `hidePicker()` внутри уже идемпотентен через `hideTimer`).
  onMount(() => {
    const onDown = (e: MouseEvent) => {
      if (hidden()) return
      if (wrapperEl.contains(e.target as Node)) return
      hidePicker()
    }
    document.addEventListener('mousedown', onDown, { capture: true })
    onCleanup(() => document.removeEventListener('mousedown', onDown, { capture: true }))
  })

  const pick = (c: Country) => {
    const span = document.createElement('span')
    span.textContent = c.name
    inputEl.replaceChildren(span)
    setEmpty(false)
    setFilter(null)
    props.onChange(c)
    hidePicker()
  }

  // tweb `onKeyPress` (keyup, плюс keydown ради Enter): фильтрует список; если
  // не совпало ничего — показывает всё; если осталась одна страна и нажат
  // Enter — выбирает её.
  const runFilter = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.key === 'Control') return
    const text = inputEl.textContent ?? ''
    const matched = filterCountries(text)
    setFilter(matched.length ? text : null)
    if (!matched.length) return
    const isos = new Set(matched.map((c) => c.iso2))
    if (isos.size === 1 && e.key === 'Enter') {
      e.preventDefault()
      pick(matched[0])
    }
  }

  // tweb прячет несовпавшие `li` стилем, а не удаляет — список не виртуализирован.
  const visibleIso = createMemo(() => {
    const f = filter()
    if (f === null) return null
    return new Set(filterCountries(f).map((c) => c.iso2))
  })

  return (
    <div ref={wrapperEl} class="input-field input-select">
      <div
        ref={inputEl}
        class={classNames('input-field-input', empty() ? 'is-empty' : '')}
        contentEditable
        data-no-linebreaks="1"
        onFocus={() => {
          setFilter(null)
          openPicker()
          if (inputEl.textContent) selectElementContents(inputEl)
        }}
        onInput={() => setEmpty(!inputEl.textContent)}
        onKeyUp={runFilter}
        onKeyDown={(e) => {
          // InputField: перевода строки в поле быть не должно.
          if (e.key === 'Enter') {
            e.preventDefault()
            runFilter(e)
          }
        }}
      />
      <div class="input-field-border" />
      <label style={{ visibility: 'visible' }}>
        <span>{i18n('Country')}</span>
      </label>
      <span
        class="arrow arrow-down"
        onMouseDown={(e) => {
          if (inputEl === document.activeElement) {
            hidePicker()
            inputEl.blur()
          } else {
            e.preventDefault()
            inputEl.focus()
          }
        }}
      />
      <div class={classNames('select-wrapper', 'z-depth-3', hidden() ? 'hide' : '', active() ? 'active' : '')}>
        <div class="scrollable scrollable-y">
          <ul>
            {COUNTRIES.map((c) => (
              <li
                style={visibleIso() && !visibleIso()!.has(c.iso2) ? { display: 'none' } : undefined}
                onMouseDown={(e) => {
                  if (e.button !== 0) return // tweb: только левая кнопка
                  pick(c)
                }}
              >
                <span>
                  <span class="emoji emoji-native">{countryFlag(c.iso2)}</span>
                </span>
                <span>{c.name}</span>
                <span class="phone-code">{c.code}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// CountryInput — поле выбора страны на экране входа. Порт tweb
// `components/countryInputField.ts` поверх `components/inputField.ts`; дерево 1:1
// с живым оригиналом (dom-референс §4.1/§4.2):
//
//   div.input-field.input-select
//     div.input-field-input[contenteditable]      ← НЕ <input>: InputField без plainText
//       span.i18n                                 ← имя страны кладётся элементом i18n
//     div.input-field-border
//     label > span.i18n
//     span.arrow.arrow-down                       ← шеврон рисует CSS (border + rotate)
//     div.select-wrapper.z-depth-3(.hide|.active)
//       div.scrollable.scrollable-y > ul > li
//
// Своего CSS-модуля у компонента нет: всё — глобальные партиалы tweb
// (`styles/tweb/_input.scss`, `_bridge.scss` — блок `.select-wrapper`/`.phone-code`/
// `.emoji-native`, `_scrollable.scss`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import classNames from '../../shared/lib/classNames'
import { selectElementContents } from '../../shared/lib/caret'
import { useT } from '../../i18n'
import { COUNTRIES, countryFlag, filterCountries, type Country } from './countries'

// tweb `hidePicker`: сначала снимается `.active` (проигрывается 200 мс переход
// opacity/transform), и только потом вешается `.hide` (`display: none`).
const HIDE_DELAY_MS = 200

export default function CountryInput({
  value,
  onChange,
}: {
  value: Country | null
  onChange: (c: Country) => void
}) {
  const t = useT()
  const inputRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef(0)

  // Три состояния списка, как в tweb: `hide` (свёрнут) → без классов (кадр на
  // reflow) → `active` (раскрыт). Снятие `.hide` и навешивание `.active` в один
  // кадр убило бы переход, поэтому между ними — rAF (у tweb это `void offsetWidth`).
  const [hidden, setHidden] = useState(true)
  const [active, setActive] = useState(false)
  // null — фильтр не набран, показываем весь список (tweb на focus сбрасывает display у всех li).
  const [filter, setFilter] = useState<string | null>(null)
  const [empty, setEmpty] = useState(!value)

  // Значение поля — императивно: contenteditable мутирует браузер, React его
  // детей не держит. Синхронизируем на каждой отрисовке, но только когда поле НЕ
  // в фокусе: так набранный фильтр не затирается, а `override` из поля телефона
  // (tweb `countryInputField.override`) возвращает имя страны на место.
  // Списка зависимостей нет намеренно: сверка идёт с ФАКТИЧЕСКИМ содержимым поля,
  // а не с пропсом, поэтому цикла обновлений не будет (setState вызывается только
  // когда содержимое реально разошлось).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el || document.activeElement === el) return
    const name = value?.name ?? ''
    if (el.textContent === name) return
    if (name) {
      // tweb `this.value = i18n(default_name)`: у него `default_name` страны — это
      // ЛАНГ-КЛЮЧ, поэтому и узел выходит настоящим `span.i18n` из ядра. У нас имя
      // страны приходит данными (`Country.name`), ключа под ним нет, и класс
      // `i18n` здесь был бы поддельным якорем — узла в `weakMap` нет, обход
      // `applyLangPack` его молча пропустит. Поэтому просто текст.
      const span = document.createElement('span')
      span.textContent = name
      el.replaceChildren(span)
    } else {
      el.replaceChildren()
    }
    setEmpty(!name)
  })

  const openPicker = () => {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = 0
    setHidden(false)
    requestAnimationFrame(() => setActive(true))
  }

  const hidePicker = () => {
    if (hideTimerRef.current) return
    setActive(false)
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0
      setHidden(true)
    }, HIDE_DELAY_MS)
  }

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), [])

  // tweb: закрытие — `mousedown` в capture-фазе по документу, если цель не внутри
  // `.input-select`. Слушатель живёт только пока список раскрыт.
  useEffect(() => {
    if (hidden) return
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return
      hidePicker()
    }
    document.addEventListener('mousedown', onDown, { capture: true })
    return () => document.removeEventListener('mousedown', onDown, { capture: true })
  }, [hidden]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (c: Country) => {
    const el = inputRef.current
    if (el) {
      const span = document.createElement('span')
      span.textContent = c.name
      el.replaceChildren(span)
    }
    setEmpty(false)
    setFilter(null)
    onChange(c)
    hidePicker()
  }

  // tweb `onKeyPress` (вешается на keyup, плюс на keydown ради Enter): фильтрует
  // список; если не совпало ничего — показывает всё; если осталась одна страна и
  // нажат Enter — выбирает её.
  const runFilter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.key === 'Control') return
    const text = inputRef.current?.textContent ?? ''
    const matched = filterCountries(text)
    setFilter(matched.length ? text : null)
    if (!matched.length) return
    const isos = new Set(matched.map((c) => c.iso2))
    if (isos.size === 1 && e.key === 'Enter') {
      e.preventDefault()
      pick(matched[0])
    }
  }

  // tweb прячет несовпавшие `li` стилем (`li.style.display='none'`), а не удаляет
  // их: список не виртуализирован, все строки всегда в DOM.
  const visibleIso = useMemo(() => {
    if (filter === null) return null
    return new Set(filterCountries(filter).map((c) => c.iso2))
  }, [filter])

  return (
    <div ref={wrapperRef} className="input-field input-select">
      <div
        ref={inputRef}
        className={classNames('input-field-input', empty ? 'is-empty' : '')}
        contentEditable
        suppressContentEditableWarning
        data-no-linebreaks="1"
        onFocus={() => {
          setFilter(null)
          openPicker()
          if (inputRef.current?.textContent) selectElementContents(inputRef.current)
        }}
        onInput={() => setEmpty(!inputRef.current?.textContent)}
        onKeyUp={runFilter}
        onKeyDown={(e) => {
          // InputField: перевода строки в поле быть не должно.
          if (e.key === 'Enter') {
            e.preventDefault()
            runFilter(e)
          }
        }}
      />
      <div className="input-field-border" />
      <label style={{ visibility: 'visible' }}>
        <span>{t('Country')}</span>
      </label>
      <span
        className="arrow arrow-down"
        onMouseDown={(e) => {
          if (inputRef.current === document.activeElement) {
            hidePicker()
            inputRef.current?.blur()
          } else {
            e.preventDefault()
            inputRef.current?.focus()
          }
        }}
      />
      <div
        className={classNames(
          'select-wrapper',
          'z-depth-3',
          hidden ? 'hide' : '',
          active ? 'active' : '',
        )}
      >
        <div className="scrollable scrollable-y">
          <ul>
            {COUNTRIES.map((c) => (
              <li
                key={`${c.iso2}${c.code}`}
                style={visibleIso && !visibleIso.has(c.iso2) ? { display: 'none' } : undefined}
                onMouseDown={(e) => {
                  if (e.button !== 0) return // tweb: только левая кнопка
                  pick(c)
                }}
              >
                <span>
                  <span className="emoji emoji-native">{countryFlag(c.iso2)}</span>
                </span>
                <span>{c.name}</span>
                <span className="phone-code">{c.code}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

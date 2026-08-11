import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import classNames from '../../lib/classNames'
import { setTransition } from '../../../core/dom/setTransition'
import TgIcon from '../../../components/TgIcon'
import IconButton from '../IconButton'
import s from './InputSearch.module.scss'

/** `ConnectionStatusComponent.ANIMATION_DURATION` (tweb connectionStatus.ts:20).
 *  У tweb `inputSearch.ts` импортирует её из самого компонента статуса; у нас
 *  направление зависимости обратное (автомат — потребитель этого модуля), чтобы
 *  общий `shared/ui` не тянул за собой компонент сайдбара. */
export const CONNECTION_ANIMATION_DURATION = 250

/** Три возможности tweb `InputSearch` (inputSearch.ts:143-198), которыми
 *  пользуется автомат состояния соединения. */
export interface InputSearchStatus {
  /** tweb :143-145 */
  isLoading(): boolean
  /** tweb :147-173 — спиннер вместо лупы + `is-connecting` на контейнере */
  toggleLoading(loading: boolean): void
  /**
   * tweb :175-198 — кросс-фейд плейсхолдера.
   * `key` — ключ дедупликации (у tweb это `LangPackKey`): повторный вызов с тем
   * же ключом ничего не делает, иначе анимация перезапускалась бы на каждом тике
   * обратного отсчёта. `content` — готовый узел (у tweb его строит `i18n(key, args)`,
   * и внутрь попадает живой `<span>` с секундами, который автомат мутирует сам,
   * НЕ трогая setPlaceholder). Без `content` содержимым становится сам `key`.
   */
  setPlaceholder(key: string, content?: Node): void
}

interface InputSearchProps {
  value: string
  onChange: (v: string) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  /** accent border/icon (parent's persistent "searching" state) */
  focused?: boolean
  onClear?: () => void
  className?: string
  /**
   * Хэндл трёх методов выше. Отдельный ref, а НЕ основной: основной `ref`
   * компонента — сам `HTMLInputElement`, на нём висят `focus()`/`blur()`
   * (`useSidebarSearch`), `parentElement` (`EmoticonsTab`) и `foldInto`
   * (`StoriesRow`). Слить их в один объект можно только расширив тип-параметр
   * `forwardRef`, а тогда `useRef<HTMLInputElement>` и
   * `RefObject<HTMLInputElement | null>` у существующих вызывающих перестают
   * подходить по типу — правка ради удобства нового API, которой здесь не место.
   */
  statusRef?: Ref<InputSearchStatus>
}

// Разметка прелоадера — tweb `ProgressivePreloader.constructContainer({color:
// 'transparent', bold: true})` (preloader.ts:50-68) + `construct()` при
// `cancelable: false`: тело крутилки `:94-100`, класс `preloader-swing` — ветка
// `else` от `if(this.cancelable)`, `:108` и `:125-127`.
//
// Строится императивно, а не через `shared/ui/Spinner`, и это не долг, а решение
// с двумя независимыми причинами:
//   1) узел живёт вне рендера React — он добавляется при входе в загрузку и
//      удаляется только по окончании ОБРАТНОЙ анимации (tweb inputSearch.ts:168-170),
//      то есть в момент, когда React ничего не рендерит;
//   2) `Spinner.module.scss` намеренно ломает позиционирование tweb-контейнера
//      (`position: relative; inset: auto; margin: 0`), потому что рассчитан на
//      поток, а `_inputSearch.scss:156-161` ставит `.preloader-container`
//      абсолютом по `inset-inline-start: var(--icon-left-offset)` — поверх лупы.
//      Там же `opacity: 1; transform: none; transition: none` гасят состояние
//      покоя `.preloader-container` из `_preloader.scss:43-44` и его переход `:46-47`.
// Свести к одному владельцу разметки можно было бы только через `innerHTML`/
// `renderToStaticMarkup` (против правила безопасности «DOM строить через
// createElement») либо превратив чистый презентационный `Spinner` в
// эффект-монтируемую обёртку над императивной фабрикой ради четырёх статических
// узлов. Оба хуже дубля из четырёх `createElement`.
function createStatusPreloader(): HTMLDivElement {
  const preloader = document.createElement('div')
  preloader.classList.add('preloader-container', 'preloader-transparent', 'preloader-bold', 'preloader-swing')

  const round = document.createElement('div')
  round.className = 'you-spin-me-round'

  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'preloader-circular')
  svg.setAttribute('viewBox', '27 27 54 54')

  const circle = document.createElementNS(NS, 'circle')
  circle.setAttribute('class', 'preloader-path-new')
  circle.setAttribute('cx', '54')
  circle.setAttribute('cy', '54')
  circle.setAttribute('r', '24')
  circle.setAttribute('fill', 'none')
  circle.setAttribute('stroke-miterlimit', '10')

  svg.append(circle)
  round.append(svg)
  preloader.append(round)
  return preloader
}

// Поле поиска — разметка tweb `.input-search.old-style` (живой DOM §2):
//   input.input-field-input.input-search-input[.is-empty] + .input-field-border
//   + span.tgico.input-search-part.input-search-icon
//   + button.btn-icon.input-search-clear.input-search-part.input-search-button
//   + span.i18n.input-search-placeholder.will-animate
// В снимке живого DOM у лупы есть ещё и `will-animate`, но это НЕ разметка
// конструктора: `createIcon` его не ставит (`inputSearch.ts:139-141` → `icon.ts:28-37`),
// класс появляется от первого `toggleLoading` — в сайдбаре tweb его успевает
// позвать `ConnectionStatusComponent`. Держать его в JSX значит гонять
// `grow-input` на лупе при каждом монтировании поля и во всех семи местах,
// где никакой загрузки не бывает; поэтому здесь его нет, а вешает его
// `toggleLoading`, как в оригинале.
// Корень компонента И ЕСТЬ `.input-search` — модификаторы (`old-style` и пр.)
// докидывает вызывающий через className. Важно не заводить лишнюю обёртку:
// сворачивание сториз меряет `input.parentElement` (= .input-search) и
// `input.parentElement.parentElement` (= .sidebar-header), как tweb.
//
// Плейсхолдер и спиннер — императивные дети корня (см. `setPlaceholder`/
// `toggleLoading`): кросс-фейд tweb держит в DOM ДВА узла плейсхолдера сразу,
// а JSX выражает только один. React такие узлы не трогает — свои дети он
// вставляет по ссылкам на собственные, а лишние никогда не удаляет.
const InputSearch = forwardRef<HTMLInputElement, InputSearchProps>(function InputSearch(
  { value, onChange, onFocus, onBlur, placeholder, focused, onClear, className, statusRef },
  ref,
) {
  const has = value.length > 0
  const rootRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const preloaderRef = useRef<HTMLDivElement | null>(null)
  const placeholderRef = useRef<HTMLElement | null>(null)
  const placeholderKeyRef = useRef<string | undefined>(undefined)

  // Классы корня ведёт императивный слой — единственный писатель. Если оставить
  // их пропом `className`, React перепишет строку целиком на любом изменении
  // `focused`/`className` и снесёт `is-connecting`/`forwards`/`animating`,
  // которые сюда кладёт `setTransition` (у React нет способа их сохранить —
  // он не читает DOM, а сравнивает пропы). Эффект слоя раскладки, а не обычный:
  // классы должны быть на узле до первой отрисовки.
  const reactTokens = useRef<string[]>([])
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const tokens = classNames('input-search', focused ? s.focused : '', className ?? '').split(' ').filter(Boolean)
    for (const token of reactTokens.current) if (!tokens.includes(token)) root.classList.remove(token)
    root.classList.add(...tokens)
    reactTokens.current = tokens
  })

  // tweb :175-198
  const setPlaceholder = useCallback((key: string, content?: Node) => {
    if (placeholderKeyRef.current === key) return
    placeholderKeyRef.current = key

    const old = placeholderRef.current
    if (old) {
      setTransition({
        element: old,
        className: 'is-hiding',
        forwards: true,
        duration: CONNECTION_ANIMATION_DURATION,
        onTransitionEnd: () => old.remove(),
      })
    }

    // tweb строит узел через `i18n(key, args)` — у нас i18n даёт строку, поэтому
    // либо готовый узел от вызывающего, либо текст ключа.
    const node = document.createElement('span')
    node.classList.add('i18n', 'input-search-placeholder', 'will-animate')
    node.append(content ?? key)
    placeholderRef.current = node
    rootRef.current?.append(node)
  }, [])

  // tweb :147-173
  const toggleLoading = useCallback((loading: boolean) => {
    const root = rootRef.current
    const another = iconRef.current
    if (!root || !another) return

    if (!preloaderRef.current) {
      // создаётся лениво и ровно один раз (tweb :149-155)
      const preloader = createStatusPreloader()
      preloader.classList.add('is-visible', 'will-animate')
      // `will-animate` появляется на лупе ТОЛЬКО здесь: `createIcon` в tweb
      // (`inputSearch.ts:139-141` → `icon.ts:28-37`) его не ставит, поэтому до
      // первой загрузки лупа не проигрывает `grow-input` при монтировании поля
      another.classList.add('will-animate')
      preloaderRef.current = preloader
    }
    const preloader = preloaderRef.current

    if (loading && !preloader.parentElement) root.append(preloader)

    preloader.classList.toggle('is-hiding', !loading)
    // у tweb здесь `loading || (another === clearBtn && inputField.isEmpty())`:
    // вторая половина — для варианта с `arrowBack`, где «другая» иконка это
    // крестик очистки. У нас кнопки «назад» внутри поля нет вовсе, `another`
    // всегда лупа, и ветка мертва.
    another.classList.toggle('is-hiding', loading)

    setTransition({
      element: root,
      className: 'is-connecting',
      forwards: loading,
      duration: CONNECTION_ANIMATION_DURATION,
      onTransitionEnd: loading ? undefined : () => preloader.remove(),
    })
  }, [])

  // tweb :143-145
  const isLoading = useCallback(() => rootRef.current?.classList.contains('is-connecting') ?? false, [])

  useImperativeHandle(statusRef, () => ({ isLoading, toggleLoading, setPlaceholder }), [
    isLoading,
    toggleLoading,
    setPlaceholder,
  ])

  // Декларативный проп — та же императивная процедура (tweb :96-99 зовёт
  // `setPlaceholder` из конструктора). Слой раскладки — чтобы плейсхолдер был
  // на месте до первой отрисовки, как когда он рендерился из JSX.
  //
  // Сознательное расхождение с прежней React-формой: `placeholder` → `undefined`
  // больше НЕ снимает узел (раньше `{!has && placeholder && …}` убирал его из DOM).
  // У tweb «снять плейсхолдер» не выражается вовсе — `setPlaceholder` принимает
  // только ключ, обратной операции нет; заводить её значит придумывать поверх
  // оригинала. Живого вызывающего нет: все семь мест с этим пропом всегда передают
  // строку (`t(…)`), а `EmoticonsTab` не передаёт его ни разу.
  useLayoutEffect(() => {
    if (placeholder) setPlaceholder(placeholder)
  }, [placeholder, setPlaceholder])

  return (
    <div ref={rootRef}>
      <input
        ref={ref}
        className={classNames('input-field-input', 'input-search-input', 'with-focus-effect', has ? '' : 'is-empty', focused ? s.input : '')}
        type="text"
        autoComplete="off"
        dir="auto"
        placeholder=" "
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <div className="input-field-border" />
      <span ref={iconRef} className={classNames('tgico', 'input-search-part', 'input-search-icon')}>
        <TgIcon name="search" size={24} />
      </span>
      {has && onClear && (
        <IconButton
          className={classNames('input-search-clear', 'input-search-part', 'input-search-button')}
          size="small"
          onClick={onClear}
          aria-label="Clear"
        >
          <TgIcon name="close" size={20} />
        </IconButton>
      )}
    </div>
  )
})

export default InputSearch

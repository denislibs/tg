// src/components/MarkupTooltip.tsx
// Плавающая панель форматирования над выделением в композере — порт tweb
// `src/components/chat/markupTooltip.ts` (дерево, классы, механика показа).
//
// Дерево 1:1 с tweb (markupTooltip.ts:57-170):
//
//   div.markup-tooltip.z-depth-1[.hide][.is-visible][.is-link][.no-transition]
//     div.markup-tooltip-wrapper
//       div.markup-tooltip-tools.markup-tooltip-tools-regular
//         button.btn-icon ×N  (bold…quote)
//         span.markup-tooltip-delimiter
//         button.btn-icon     (link)
//       div.markup-tooltip-tools.markup-tooltip-tools-link
//         button.btn-icon     (назад)
//         span.markup-tooltip-delimiter
//         input.input-clear[.is-valid][.error]
//         div.markup-tooltip-link-apply-container
//           span.markup-tooltip-delimiter
//           button.btn-icon.markup-tooltip-link-apply
//
// Стили — глобальный `styles/tweb/_chatMarkupTooltip.scss` (портирован дословно):
// панель `position: fixed` с `inset: 0` и фиксированной шириной, место выбирается
// `transform: translate3d(left, top, 0)`; режим ссылки — другая ширина панели плюс
// сдвиг `-wrapper` на ширину обычных инструментов. Из JS ничего не анимируем:
// показ/скрытие/переезд — CSS-переходы партиала (var(--layer-transition)).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { activeTypes } from '../core/richtext/markdown'
import type { EntityType } from '../core/models'
import type { IconName } from '../core/tgico-icons'

// Порядок и иконки — tweb markupTooltip.ts:66-76. Пункт `date` (календарь)
// пропущен: сущности «дата» нет ни в нашей модели, ни на бэке.
// У цитаты в tweb две иконки: неактивная `quote_outline`, активная `quote`.
const TOOLS: { type: EntityType; icon: IconName; activeIcon?: IconName; title: string }[] = [
  { type: 'bold', icon: 'bold', title: 'Жирный' },
  { type: 'italic', icon: 'italic', title: 'Курсив' },
  { type: 'underline', icon: 'underline', title: 'Подчёркнутый' },
  { type: 'strikethrough', icon: 'strikethrough', title: 'Зачёркнутый' },
  { type: 'code', icon: 'monospace', title: 'Моноширинный' },
  { type: 'spoiler', icon: 'spoiler', title: 'Спойлер' },
  { type: 'blockquote', icon: 'quote_outline', activeIcon: 'quote', title: 'Цитата' },
]

// tweb проверяет ссылку через richTextProcessor/matchUrl — подсистемы у нас нет,
// поэтому та же семантика на нашей регулярке: пустое поле валидно (кнопка
// «применить» просто погашена), непустое обязано выглядеть ссылкой.
const LINK_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i
const isLinkValid = (v: string) => !v.trim().length || LINK_RE.test(v.trim())

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

// Фазы показа = набор классов панели у tweb:
//   hidden    — `.hide` (панель ещё ни разу не показывали / скрытие доиграло)
//   measuring — `.hide` снят под `.no-transition`: ставим позицию без переезда
//   shown     — `.is-visible`
//   closing   — `.is-visible` снят, идёт затухание; через 200мс → hidden
type Phase = 'hidden' | 'measuring' | 'shown' | 'closing'

export default function MarkupTooltip({
  editorRef,
  onApply,
}: {
  editorRef: RefObject<HTMLDivElement | null>
  onApply: (type: EntityType, url?: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toolsRegularRef = useRef<HTMLDivElement>(null)
  const toolsLinkRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  // tweb создаёт узел панели лениво, в `init()` из первого `show()`, и дальше
  // держит его в DOM навсегда. Повторяем: до первого показа компонент не
  // рендерит ничего (`hide()` тоже выходит сразу — tweb `if(this.init) return`).
  const [inited, setInited] = useState(false)
  const initedRef = useRef(false)
  initedRef.current = inited

  const [phase, setPhase] = useState<Phase>('hidden')
  const [instant, setInstant] = useState(false)
  const [isLink, setIsLink] = useState(false)
  const [linkVal, setLinkVal] = useState('')
  const [linkError, setLinkError] = useState(false)
  const [active, setActive] = useState<Set<EntityType>>(new Set())
  const [pos, setPos] = useState<{ x: number; y: number; maxWidth: number }>({ x: 0, y: 0, maxWidth: 0 })

  // Зеркала для обработчиков документа (они живут вне цикла рендера).
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  const isLinkRef = useRef(isLink)
  isLinkRef.current = isLink

  const savedRange = useRef<Range | null>(null)
  const hideTimeout = useRef<number | undefined>(undefined)
  const linkFocusTimeout = useRef<number | undefined>(undefined)
  const waitingForMouseUp = useRef(false)

  const clearLinkFocusTimeout = useCallback(() => {
    if (linkFocusTimeout.current !== undefined) {
      clearTimeout(linkFocusTimeout.current)
      linkFocusTimeout.current = undefined
    }
  }, [])

  // tweb setTooltipPosition(): верх = верх видимой части выделения − высота
  // инструментов − 8; левый край центрируется по выделению и зажимается в
  // границы поля ввода; ширина панели ограничивается шириной поля.
  const setTooltipPosition = useCallback((linkMode: boolean, isLinkToggle = false) => {
    const root = editorRef.current
    const container = containerRef.current
    if (!root || !container) return
    const sel = document.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)

    // tweb ищет вверх `.rows-wrapper` / `.input-message-container` / `.input-field`
    // / `[data-markup-tooltip-host]`. Композер на классы tweb ещё не перестроен
    // (зона соседней задачи), поэтому финальный фолбэк — сам contenteditable.
    const host = (root.closest('.rows-wrapper, .input-message-container, .input-field, [data-markup-tooltip-host]')
      ?? root) as HTMLElement

    const tools = linkMode ? toolsLinkRef.current : toolsRegularRef.current
    if (!tools) return

    const bodyRect = document.body.getBoundingClientRect()
    const selectionRect = range.getBoundingClientRect()
    const inputRect = host.getBoundingClientRect()
    const sizesRect = tools.getBoundingClientRect()

    // tweb getVisibleRect(): видимая часть выделения внутри поля. Без прокрутки
    // это пересечение прямоугольников; пустое пересечение (выделение уехало за
    // пределы поля — правится цитата вне вьюпорта) — не двигаемся.
    const top = Math.max(selectionRect.top, inputRect.top)
    const bottom = Math.min(selectionRect.bottom, inputRect.bottom)
    if (bottom <= top) return

    const y = top + bodyRect.top * -1 - sizesRect.height - 8

    const minX = inputRect.left
    const maxX = inputRect.left + inputRect.width - Math.min(inputRect.width, sizesRect.width)
    const x = isLinkToggle
      ? clamp(container.getBoundingClientRect().left, minX, maxX)
      : clamp(selectionRect.left + (selectionRect.width - sizesRect.width) / 2, minX, maxX)

    setPos({ x, y, maxWidth: inputRect.width })
  }, [editorRef])

  const setActiveMarkupButton = useCallback(() => {
    const root = editorRef.current
    if (root) setActive(activeTypes(root))
  }, [editorRef])

  const onMouseUpSingle = useCallback(() => {
    waitingForMouseUp.current = false
    showRef.current()
  }, [])

  const hide = useCallback(() => {
    if (!initedRef.current) return
    document.removeEventListener('mouseup', onMouseUpSingle)
    waitingForMouseUp.current = false
    if (hideTimeout.current !== undefined) clearTimeout(hideTimeout.current)
    clearLinkFocusTimeout()
    setPhase((p) => (p === 'hidden' ? p : 'closing'))
    // tweb: `.hide` вешается только когда доиграло затухание (--layer-transition).
    hideTimeout.current = window.setTimeout(() => {
      hideTimeout.current = undefined
      setPhase('hidden')
      setIsLink(false)
    }, 200)
  }, [clearLinkFocusTimeout, onMouseUpSingle])

  const show = useCallback(() => {
    const sel = document.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { hide(); return }
    if (hideTimeout.current !== undefined) {
      clearTimeout(hideTimeout.current)
      hideTimeout.current = undefined
    }
    if (phaseRef.current === 'shown') return

    setInited(true)
    setActiveMarkupButton()
    setIsLink(false)
    // tweb isFirstShow: панель, у которой ещё стоит `.hide`, показывается без
    // перехода (иначе приезжает из левого верхнего угла); панель, не успевшая
    // догаснуть, просто переезжает штатным переходом.
    setInstant(phaseRef.current === 'hidden')
    setPhase('measuring')
  }, [hide, setActiveMarkupButton])

  // `show` вызывается из mouseup-обработчика, созданного раньше — держим ссылку.
  const showRef = useRef(show)
  showRef.current = show

  // Позицию ставим ПОСЛЕ снятия `.hide`: пока панель `display:none`, её
  // инструменты не меряются и центрирование было бы по нулевой ширине.
  useLayoutEffect(() => {
    if (phase !== 'measuring') return
    setTooltipPosition(isLinkRef.current)
    const id = requestAnimationFrame(() => setPhase('shown'))
    return () => cancelAnimationFrame(id)
  }, [phase, setTooltipPosition])

  // Пока левая кнопка зажата (идёт протяжка выделения), панель не показываем —
  // tweb `setMouseUpEvent` / `onMouseUpSingle`.
  const setMouseUpEvent = useCallback(() => {
    if (waitingForMouseUp.current) return
    waitingForMouseUp.current = true
    document.addEventListener('mouseup', onMouseUpSingle, { once: true })
  }, [onMouseUpSingle])

  const saveRange = useCallback(() => {
    const sel = document.getSelection()
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
  }, [])

  const resetSelection = useCallback(() => {
    const sel = window.getSelection()
    if (savedRange.current && sel) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
    editorRef.current?.focus()
  }, [editorRef])

  // Панель ведёт себя по-tweb только для мыши/клавиатуры: ветку IS_TOUCH_SUPPORTED
  // (двойной mouseup, ручной resetSelection) не портируем — на тач-устройствах
  // панель у нас не открывается.
  useEffect(() => {
    const onSelectionChange = () => {
      // Клик по кнопке ссылки только что запланировал фокус в поле — событие
      // выделения от этого клика игнорируем (tweb linkInputFocusTimeout).
      if (linkFocusTimeout.current !== undefined) return
      if (document.activeElement === linkInputRef.current) return

      const root = editorRef.current
      if (!root || document.activeElement !== root) { hide(); return }

      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) { hide(); return }

      if (phaseRef.current === 'shown') {
        setActiveMarkupButton()
        setTooltipPosition(isLinkRef.current)
      } else if (root.matches(':active')) {
        setMouseUpEvent()
      } else {
        show()
      }
    }

    const onResize = () => hide()

    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', onMouseUpSingle)
      window.removeEventListener('resize', onResize)
      if (hideTimeout.current !== undefined) clearTimeout(hideTimeout.current)
      if (linkFocusTimeout.current !== undefined) clearTimeout(linkFocusTimeout.current)
    }
  }, [editorRef, hide, onMouseUpSingle, setActiveMarkupButton, setMouseUpEvent, setTooltipPosition, show])

  // tweb вешает форматирование на mousedown с cancelEvent: клик не должен сбивать
  // выделение в поле, иначе применять будет не к чему.
  const applyType = (type: EntityType) => (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onApply(type)
    setActiveMarkupButton()
  }

  const showLinkEditor = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsLink(true)
    saveRange()
    // tweb подставляет href уже существующей ссылки, если кнопка активна.
    const anchor = active.has('text_link')
      ? document.getSelection()?.anchorNode?.parentElement?.closest('a')
      : null
    setLinkVal(anchor?.getAttribute('href') ?? '')
    setLinkError(false)
    setTooltipPosition(true, true)
    linkFocusTimeout.current = window.setTimeout(() => {
      linkFocusTimeout.current = undefined
      linkInputRef.current?.focus() // мгновенный фокус ломает анимацию (tweb)
    }, 200)
  }

  const closeLinkEditor = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsLink(false)
    clearLinkFocusTimeout()
    resetSelection()
    setTooltipPosition(false)
  }

  const applyLink = (e: SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resetSelection()
    const raw = linkVal.trim()
    // tweb matchUrlProtocol: свой протокол сохраняем, иначе дописываем https://
    if (raw) onApply('text_link', /^[a-z][a-z\d+\-.]*:/i.test(raw) ? raw : `https://${raw}`)
    setTimeout(hide, 0)
  }

  const valid = isLinkValid(linkVal)

  if (!inited) return null

  return createPortal(
    <div
      ref={containerRef}
      className={classNames(
        'markup-tooltip',
        'z-depth-1',
        phase === 'hidden' ? 'hide' : '',
        phase === 'shown' ? 'is-visible' : '',
        phase === 'measuring' && instant ? 'no-transition' : '',
        isLink ? 'is-link' : '',
      )}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, maxWidth: pos.maxWidth || undefined }}
    >
      <div className="markup-tooltip-wrapper">
        <div ref={toolsRegularRef} className="markup-tooltip-tools markup-tooltip-tools-regular">
          {TOOLS.map((tool) => {
            const on = active.has(tool.type)
            return (
              <button
                key={tool.type}
                type="button"
                title={tool.title}
                className={classNames('btn-icon', on ? 'active' : '')}
                onMouseDown={applyType(tool.type)}
              >
                <TgIcon name={on && tool.activeIcon ? tool.activeIcon : tool.icon} size="inherit" />
              </button>
            )
          })}
          <span className="markup-tooltip-delimiter" />
          <button
            type="button"
            title="Ссылка"
            className={classNames('btn-icon', active.has('text_link') ? 'active' : '')}
            onMouseDown={showLinkEditor}
          >
            <TgIcon name="link" size="inherit" />
          </button>
        </div>
        <div ref={toolsLinkRef} className="markup-tooltip-tools markup-tooltip-tools-link">
          <button type="button" className="btn-icon" onMouseDown={closeLinkEditor}>
            <TgIcon name="left" size="inherit" />
          </button>
          <span className="markup-tooltip-delimiter" />
          <input
            ref={linkInputRef}
            className={classNames('input-clear', valid ? 'is-valid' : '', linkError ? 'error' : '')}
            placeholder="Введите ссылку…"
            value={linkVal}
            onChange={(e) => { setLinkVal(e.target.value); setLinkError(false) }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              // tweb: невалидный URL по Enter трясёт поле (класс `error` +
              // keyframes input-shake из _input.scss), панель не закрывается.
              if (!isLinkValid(e.currentTarget.value)) {
                setLinkError(false)
                requestAnimationFrame(() => setLinkError(true))
                return
              }
              applyLink(e)
            }}
          />
          <div className="markup-tooltip-link-apply-container">
            <span className="markup-tooltip-delimiter" />
            <button type="button" className="btn-icon markup-tooltip-link-apply" onMouseDown={applyLink}>
              <TgIcon name="check" size="inherit" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

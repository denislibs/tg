// Порт `tweb/src/components/staticCheckbox.tsx` — НЕинтерактивный чекбокс:
// он только показывает состояние, обработчика у него нет вовсе (в опросе клик
// ловит `.clickableArea`, лежащая поверх всей строки варианта).
//
// ── Форма против оригинала ──────────────────────────────────────────────────
// В tweb это Solid-компонент. Приём тот же, что у `components/progressRing.ts`
// и `components/messages/messageSpoilerOverlay.ts`: ядро ванильное (строит те
// же узлы, что JSX оригинала), потому что вызывающий — императивная лента
// (`components/chat/bubbles.ts`), а тянуть в неё react-dom/solid ради листа
// нельзя. Реактивности вместо этого — метод `setChecked` на хендле: у
// оригинала ту же роль играет проп `checked`.
//
// `#check` и `#checkbox-cross` — общий SVG-спрайт (`components/SvgDefs.tsx`,
// порт tweb `index.html:59-60`); анимация галочки живёт в CSS на `use`
// (stroke-dasharray), поэтому подменять надо именно `href`, а не рисовать путь.
import styles from './staticCheckbox.module.scss'

export interface StaticCheckboxOptions {
  checked?: boolean
  /** Кружок вместо квадрата — одиночный выбор (tweb `round`). */
  round?: boolean
  /**
   * Крестик вместо галочки. tweb: «анимация из unchecked в checked для крестика
   * пока не поддержана, используется статикой» (staticCheckbox.tsx:11-13).
   */
  cross?: boolean
  /** Дополнительные классы вызывающего (у оригинала — проп `class`). */
  className?: string
}

export interface StaticCheckboxHandle {
  element: HTMLDivElement
  setChecked: (checked: boolean) => void
}

/** Узел 1:1 с JSX оригинала (staticCheckbox.tsx:26-48). */
export function createStaticCheckbox(opts: StaticCheckboxOptions = {}): StaticCheckboxHandle {
  const element = document.createElement('div')
  element.classList.add(styles.Checkbox)
  if (opts.className) element.classList.add(...opts.className.split(' ').filter(Boolean))
  if (opts.round) element.classList.add(styles.round)

  const border = document.createElement('div')
  border.classList.add(styles.Border)

  const background = document.createElement('div')
  background.classList.add(styles.Background)

  const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  check.setAttributeNS(null, 'class', styles.Check)
  check.setAttributeNS(null, 'viewBox', '0 0 24 24')

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttributeNS(null, 'href', opts.cross ? '#checkbox-cross' : '#check')
  // Галочка спрайта смещена на -1 по X, крестик — нет (tweb :44-45).
  if (!opts.cross) use.setAttributeNS(null, 'x', '-1')
  check.append(use)

  element.append(border, background, check)

  const setChecked = (checked: boolean) => {
    element.classList.toggle(styles.checked, checked)
  }
  setChecked(!!opts.checked)

  return { element, setChecked }
}

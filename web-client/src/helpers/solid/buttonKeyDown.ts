/**
 * Порт tweb `src/helpers/solid/buttonKeyDown.ts` (472e3e76b, 39 строк) —
 * активация с клавиатуры для элемента, который НЕ является нативным контролом,
 * за который себя выдаёт: кликабельный `<div>`/`<span>` с ролью. Пара к роли,
 * `tabindex="0"` и уже имеющемуся `onClick`:
 *
 *   <div role="button" tabindex="0" onClick={fn} onKeyDown={buttonKeyDown}>
 *   <div role="link"   tabindex="0" onClick={fn} onKeyDown={linkKeyDown}>
 *
 * Оба зовут настоящий `click()`, поэтому срабатывает тот же `onClick` (и клик
 * всплывает — делегированный слушатель родителя тоже его видит). Нативным
 * `<button>`/`<a>`/`<input>` они не нужны и вредны: те активируются сами, и клик
 * пришёл бы дважды.
 *
 * Какие клавиши активируют — не вопрос удобства. Кнопка отвечает на Enter И
 * Space; ссылка — только на Enter, потому что на ссылке Space принадлежит
 * прокрутке: отдать его ссылке — отнять page-down у того, кто читает список, в
 * котором она стоит.
 *
 * Имя каталога (`helpers/solid`) — как у tweb, хотя JSX и Solid в файле нет.
 */
function activateOn(keys: string[], e: KeyboardEvent, element: HTMLElement) {
  if(keys.includes(e.key) && !e.repeat && !e.defaultPrevented && !e.isComposing &&
    e.target === element && !element.matches('button, input, select, textarea, a[href], [disabled], [aria-disabled="true"]')) {
    e.preventDefault()
    element.click()
  }
}

/** Для `role="button"`: Enter и Space, как у нативной кнопки. */
export default function buttonKeyDown(e: KeyboardEvent, element = e.currentTarget as HTMLElement) {
  activateOn(['Enter', ' '], e, element)
}

/** Для `role="link"`: Enter активирует, Space остаётся прокрутке. */
export function linkKeyDown(e: KeyboardEvent, element = e.currentTarget as HTMLElement) {
  activateOn(['Enter'], e, element)
}

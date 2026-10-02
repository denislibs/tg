// Статичная разметка страницы — та же, что в `index.html` (tweb `index.html:87-116`):
// колонки, `#svg-defs`, `#react-overlays`. Вечные синглтоны (`AppSidebarLeft`,
// `AppSidebarRight`, владелец списка, `AppImManager`) создаются ПРИ ИМПОРТЕ и
// берут свои узлы по id, как у tweb, поэтому в прогоне разметка обязана
// существовать раньше модулей теста — её ставит `setup.ts` верхним уровнем.
//
// Узлы лежат в `<html>` ПОСЛЕ `<body>` (контейнер `#test-static-markup`): тесты,
// которые чистят `document.body`, их не снимают, а запросы по документу находят
// сначала узлы самого теста (порядок документа). Тест, которому нужна колонка в
// `body`, переносит её сам (`test/sidebarLeft.ts`, `test/sidebarRight.ts`).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
const bodyStart = html.indexOf('>', html.indexOf('<body')) + 1
const bodyEnd = html.indexOf('<script', bodyStart)
/** Разметка `<body>` из `index.html` без `<script>` точки входа. */
export const STATIC_MARKUP = html.slice(bodyStart, bodyEnd)

export const STATIC_MARKUP_ID = 'test-static-markup'

export function installStaticMarkup() {
  document.getElementById(STATIC_MARKUP_ID)?.remove()
  const container = document.createElement('div')
  container.id = STATIC_MARKUP_ID
  container.innerHTML = STATIC_MARKUP
  document.documentElement.append(container)
  return container
}

/** Вернуть узел в контейнер статики (на своё место среди соседей не важно). */
export function returnToStaticMarkup(node: Element) {
  const container = document.getElementById(STATIC_MARKUP_ID) ?? installStaticMarkup()
  container.append(node)
}

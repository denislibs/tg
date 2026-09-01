/** @jsxImportSource solid-js */
import { ErrorBoundary } from 'solid-js'
import { render } from 'solid-js/web'
import type { JSX } from 'solid-js'

/**
 * Монтирует Solid-компонент в ГОТОВЫЙ DOM-узел и возвращает `dispose`.
 *
 * `ErrorBoundary` вшит в мост намеренно, а не оставлен на совесть вызывающего.
 * Причина: у tweb Solid форкнут (ветка `no-errors`), и в их сборке
 * `handleError` при отсутствии границы ЛОГИРУЕТ ошибку вместо `throw`
 * (`tweb/src/vendor/solid/dist/solid.js:979-982`). Мы берём сток, где на этом
 * месте `throw error` (`solid-js@1.9.15 dist/solid.js:1005`), — значит их
 * компоненты, портированные дословно, у нас роняли бы весь остров. Граница в
 * мосте даёт то же СДЕРЖИВАНИЕ штатным API, без форка и без отставания версий.
 *
 * ── Расхождение в ПОСЛЕДСТВИЯХ, и оно осознанное ───────────────────────────
 * Сдерживание одинаковое (соседи не падают), а вот дальше пути расходятся: у
 * tweb упавший компонент ПРОДОЛЖАЕТ жить — их `handleError` просто возвращает
 * управление, — а `ErrorBoundary` заменяет поддерево на свой `fallback`, то
 * есть остров у нас гаснет навсегда.
 *
 * Второй параметр `fallback` (`reset`) здесь не используется намеренно: он
 * перемонтировал бы остров, но звать его некому — у оригинала повтора нет
 * вовсе, и придумывать ему триггер значило бы дописывать поведение сверх
 * порта. Возврат к «жить дальше» дал бы только форк Solid, от которого
 * программа отказалась (§ 6 спецификации). Разбор — ЗАДАЧА #104, пункт 2.
 *
 * Узлы, вставленные в `host`, снимает сам `dispose`: `render` в конце делает
 * `element.textContent = ""` (`solid-js/web@1.9.15 dist/web.js:199-202`).
 * Поэтому отдельная чистка хоста здесь была бы мёртвым кодом.
 */
export function mountSolid<P extends Record<string, unknown>>(
  host: HTMLElement,
  Component: (props: P) => JSX.Element,
  props: P,
): () => void {
  return render(
    () => (
      <ErrorBoundary
        fallback={(err) => {
          console.error('solid island error', err)
          return null
        }}
      >
        <Component {...props} />
      </ErrorBoundary>
    ),
    host,
  )
}

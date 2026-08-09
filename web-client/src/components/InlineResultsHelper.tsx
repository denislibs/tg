// Панель inline-результатов над композером — порт tweb `chat/inlineHelper.ts`
// (list-режим, т.е. `botResults.pFlags.gallery` не выставлен). Дерево 1:1
// (inlineHelper.ts:321-338 + :144-181, Scrollable оборачивает содержимое
// контейнера — scrollable.ts:104-110):
//
//   div.autocomplete-helper.z-depth-1.inline-helper
//     div.scrollable.scrollable-y
//       div.inline-helper-results.navigable-list
//         div.inline-helper-result[data-result-id][.active]
//           div.inline-helper-result-preview.empty
//           div.inline-helper-result-title
//           div.inline-helper-result-description
//         div.inline-helper-separator      ← после каждого результата, последний скрыт CSS
//     span.inline-helper-cant-send
//
// Стили — глобальные партиалы `_autocompleteHelper.scss` + `_chatInlineHelper.scss`
// (своего CSS-модуля у хелпера больше нет).
import { Fragment, useEffect, useRef } from 'react'
import classNames from '../shared/lib/classNames'
import type { InlineResult } from '../core/managers/botsManager'

// Показ/скрытие в tweb делает `AutocompleteHelper.toggle` через
// `SetTransition({className: 'is-visible', forwards: !hide})`
// (autocompleteHelper.ts:179-188); `forwards` вешает `singleTransition.ts:70`.
//
// отступление от tweb: монтированием управляет родитель (Composer), поэтому
// обратного прохода (fade-out перед скрытием) у нас нет.
const ROOT_CLASS = 'autocomplete-helper z-depth-1 inline-helper is-visible forwards'

export default function InlineResultsHelper({
  results,
  activeIdx,
  onPick,
}: {
  results: InlineResult[]
  activeIdx: number
  onPick: (r: InlineResult) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activeIdx < 0) return
    // между результатами лежат `.inline-helper-separator`, поэтому по индексу
    // берём именно строки результатов, а не всех детей списка.
    const el = listRef.current?.querySelectorAll('.inline-helper-result')[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])
  return (
    <div
      className={ROOT_CLASS}
      // отступление от tweb: гасим mousedown, иначе клик уводит каретку из
      // contenteditable-редактора композера.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="scrollable scrollable-y">
        {/* отступление от tweb: `data-peer-id`/`data-bot-id`/`data-query-id`
            (inlineHelper.ts:132-134) не пишем — они нужны только оригинальному
            onSelect, чтобы восстановить контекст из DOM; наш onPick получает
            сам объект результата.
            `navigable-list` вешает attachListNavigation.ts:131. */}
        <div ref={listRef} className="inline-helper-results navigable-list">
          {results.map((r, i) => (
            <Fragment key={r.id}>
              <div
                className={classNames('inline-helper-result', i === activeIdx ? 'active' : '')}
                data-result-id={r.id}
                onClick={() => onPick(r)}
              >
                {/* inlineHelper.ts:159-160 — превью-квадрат с первым символом
                    заголовка; регистр поднимает CSS (`text-transform: uppercase`).
                    отступление от tweb: если бэкенд прислал `emoji` результата,
                    показываем его — у нас это штатное поле inline-ответа бота. */}
                <div className="inline-helper-result-preview empty">
                  {r.emoji || [...r.title.trim()][0]}
                </div>
                <div className="inline-helper-result-title">{r.title}</div>
                <div className="inline-helper-result-description">{r.description}</div>
              </div>
              <div className="inline-helper-separator" />
            </Fragment>
          ))}
        </div>
      </div>
      {/* отступление от tweb: `span.inline-helper-cant-send` (inlineHelper.ts:335-337)
          не рендерим — он видим только под `.inline-helper.cant-send`
          (_chatInlineHelper.scss:129-140), а этот класс ставится по
          `canSendInline` (inlineHelper.ts:114), которого у нас в данных нет;
          пустой узел был бы мёртвой разметкой. */}
    </div>
  )
}

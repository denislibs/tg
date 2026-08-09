// Полоска эмодзи-подсказок над композером — порт tweb `chat/emojiHelper.ts`.
// Дерево 1:1 с оригиналом (emojiHelper.ts:42-55 + :57-115, Scrollable оборачивает
// содержимое контейнера — scrollable.ts:104-110, ScrollableX добавляет
// `scrollable-x` — scrollable.ts:464):
//
//   div.autocomplete-helper.z-depth-1.emoji-helper
//     div.scrollable.scrollable-x
//       div.emoji-helper-emojis.super-emojis
//         span.navigable-list                     ← innerList (getNavigationList)
//           span.super-emoji.super-emoji-regular[.active]
//
// Стили — глобальные партиалы `_autocompleteHelper.scss` + `_chatEmojiHelper.scss`
// (своего CSS-модуля у хелпера больше нет).
import { useEffect, useRef } from 'react'
import Emoji from './emoji/Emoji'
import classNames from '../shared/lib/classNames'

// tweb base.scss:1414 — `--esg-emoji-size: 2.125rem` у `.super-emojis`
// (ячейка `.super-emoji` = 34 + .25rem паддинга с каждой стороны = 42).
const EMOJI_SIZE = 34

// Показ/скрытие в tweb делает `AutocompleteHelper.toggle` через
// `SetTransition({className: 'is-visible', forwards: !hide})`
// (autocompleteHelper.ts:179-188); сам `forwards` вешает
// `singleTransition.ts:70`. Пара `.is-visible.forwards` снимает `display:none`
// и `visibility:hidden` и запускает `fade-in-opacity`
// (_autocompleteHelper.scss:20-43).
//
// отступление от tweb: монтированием хелпера управляет родитель (Composer),
// поэтому обратного прохода (`forwards` снят → `fade-out-opacity` → размонтирование)
// у нас нет — узел исчезает сразу. Чтобы получить и выход, родитель должен
// держать хелпер смонтированным и передавать видимость пропом.
const ROOT_CLASS = 'autocomplete-helper z-depth-1 emoji-helper is-visible forwards'

export default function EmojiHelper({
  emojis,
  activeIdx,
  onPick,
}: {
  emojis: string[]
  activeIdx: number // -1 — навигация «спит» (tweb waitForKey до первой стрелки)
  onPick: (e: string) => void
}) {
  const listRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (activeIdx < 0) return
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])
  return (
    <div
      className={ROOT_CLASS}
      // отступление от tweb: в оригинале инпут — contenteditable внутри той же
      // формы и фокус возвращает сам `attachListNavigation`; у нас клик по
      // хелперу увёл бы каретку из редактора, поэтому гасим mousedown.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="scrollable scrollable-x">
        <div className="emoji-helper-emojis super-emojis">
          {/* emojiHelper.ts:60 — внутренний span, он же навигационный список;
              класс `navigable-list` на него вешает attachListNavigation.ts:131,
              активную строку помечает `active` (attachListNavigation.ts:9). */}
          <span ref={listRef} className="navigable-list">
            {emojis.map((e, i) => (
              // emoji.ts:64 — `span.super-emoji.super-emoji-regular` (кастомные
              // эмодзи мы не подсказываем, ветки `super-emoji-custom` нет).
              <span
                key={e}
                className={classNames('super-emoji', 'super-emoji-regular', i === activeIdx ? 'active' : '')}
                onClick={() => onPick(e)}
              >
                <Emoji e={e} size={EMOJI_SIZE} />
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}

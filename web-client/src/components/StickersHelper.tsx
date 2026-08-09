// Стикеры-саджесты над композером — порт tweb `chat/stickersHelper.ts`: когда в
// инпуте набран РОВНО один эмодзи, показываем ленту стикеров по этому эмодзи.
// Дерево 1:1 (stickersHelper.ts:129-136 + :77/:92, Scrollable оборачивает
// содержимое контейнера — scrollable.ts:104-110):
//
//   div.autocomplete-helper.z-depth-1.stickers-helper
//     div.scrollable.scrollable-y
//       div.stickers-helper-stickers.super-stickers.navigable-list
//         div.grid-item.super-sticker[data-doc-id]
//
// Стили — глобальные партиалы `_autocompleteHelper.scss` + `_chatStickersHelper.scss`
// (своего CSS-модуля у хелпера больше нет).
import StickerMedia from './StickerMedia'
import { useStickersByEmoji } from '../core/hooks/useStickers'
import { emojiOnlyCount } from './RichText'
import type { Sticker } from '../core/managers/stickersManager'

// tweb mediaSizes.ts:87 `esgSticker: makeMediaSize(72, 72)` = base.scss:116
// `--esg-sticker-size: 72px` (на handhelds 68 — мы отдаём только десктоп).
const STICKER_SIZE = 72

// Показ/скрытие в tweb делает `AutocompleteHelper.toggle` через
// `SetTransition({className: 'is-visible', forwards: !hide})`
// (autocompleteHelper.ts:179-188); `forwards` вешает `singleTransition.ts:70`.
//
// отступление от tweb: монтированием управляет родитель (Composer), поэтому
// обратного прохода (fade-out перед скрытием) у нас нет.
const ROOT_CLASS = 'autocomplete-helper z-depth-1 stickers-helper is-visible forwards'

// Гейт саджестов: текст композера — единственный эмодзи (и ничего кроме него).
// Длина ограничена: одиночный эмодзи с тоном/ZWJ укладывается в ~8 UTF-16 юнитов.
export function stickerSuggestEmoji(text: string): string | null {
  const t = text.trim()
  if (!t || t.length > 8) return null
  return emojiOnlyCount(t) === 1 ? t : null
}

export default function StickersHelper({
  emoji,
  onPick,
}: {
  emoji: string
  onPick: (st: Sticker) => void
}) {
  const stickers = useStickersByEmoji(emoji) // debounce 300мс внутри
  if (!stickers.length) return null // пустой результат — панель скрыта
  return (
    <div
      className={ROOT_CLASS}
      // отступление от tweb: гасим mousedown, иначе клик уводит каретку из
      // contenteditable-редактора композера.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="scrollable scrollable-y">
        {/* `navigable-list` вешает attachListNavigation.ts:131 на сам список
            (у stickersHelper нет getNavigationList). Ширина ленты — из
            stickersHelper.ts:112: N * esgSticker.width + (N - 1). */}
        <div
          className="stickers-helper-stickers super-stickers navigable-list"
          style={{ width: stickers.length * STICKER_SIZE + stickers.length - 1 }}
        >
          {stickers.map((st) => (
            // SuperStickerRenderer.ts:61-63 — `div.grid-item.super-sticker[data-doc-id]`.
            <div
              key={st.id}
              className="grid-item super-sticker"
              data-doc-id={st.id}
              onClick={() => onPick(st)}
            >
              <StickerMedia mediaId={st.mediaId} width={STICKER_SIZE} height={STICKER_SIZE} playOnHover loop />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/reactionStickerPreview.tsx` (812502980, 20 строк) —
 * превью реакции справа в строке: `Row.Media size="small"` со стикером 32×32.
 *
 * Расхождение одно: `sticker` — номер файла статичной иконки
 * (`AvailableReaction.staticMediaId`), а не документ `static_icon` — у нас нет
 * MTProto-документов (шапка `wrappers/sticker.ts`).
 */
import { Show } from 'solid-js'
import Row from '@components/rowTsx.solid'
import StickerTsx from '@components/wrappers/stickerTsx.solid'

export default function ReactionStickerPreview(props: {
  sticker?: number
}) {
  return (
    <Row.Media size="small">
      <Show when={props.sticker}>{(sticker) => (
        <StickerTsx
          mediaId={sticker()}
          width={32}
          height={32}
        />
      )}</Show>
    </Row.Media>
  )
}

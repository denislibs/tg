// Стикеры-саджесты над композером (tweb chat/stickersHelper): когда в инпуте
// набран РОВНО один эмодзи — горизонтальная лента стикеров установленных
// наборов по этому эмодзи (GET /stickers/search). Клик — отправить стикер и
// очистить инпут. Панель в стиле EmojiHelper (autocomplete-helper).
import { motion } from 'framer-motion'
import StickerMedia from './StickerMedia'
import { useStickersByEmoji } from '../core/hooks/useStickers'
import { emojiOnlyCount } from './RichText'
import type { Sticker } from '../core/managers/stickersManager'
import s from './StickersHelper.module.scss'

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
    <motion.div
      className={s.helper}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // не отдавать фокус из contenteditable
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={s.scroll}>
        {stickers.map((st) => (
          <span key={st.id} className={s.item} onClick={() => onPick(st)}>
            <StickerMedia mediaId={st.mediaId} width={68} height={68} playOnHover loop />
          </span>
        ))}
      </div>
    </motion.div>
  )
}

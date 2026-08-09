// composer/AutocompleteHelpers.tsx
// Слоты хелперов автокомплита внутри `.rows-wrapper`. Порядок детей — из живого
// дампа и input.ts:1286-1297:
//
//   bot-commands → reply-wrapper → stickers-helper → emoji-helper →
//   commands-helper → mentions-helper → inline-helper → new-message-wrapper
//
// Порядок значим: emoji-helper идёт ПОСЛЕ stickers-helper и потому перекрывает
// его (комментарий emojiHelper.ts:165-167).
//
// В tweb все шесть контейнеров созданы один раз и живут в DOM всегда, а
// внутренности каждый хелпер строит лениво в своём `init()` — то есть в покое это
// ПУСТЫЕ div'ы. Поэтому пустой слот здесь — не заглушка, а ровно то же состояние:
// узел нужен, чтобы `.autocomplete-helper` держал позицию среди сиблингов и чтобы
// `.chat-input:not(.is-selecting) &.is-visible.forwards` (_autocompleteHelper.scss:32)
// матчился на месте.
import EmojiHelper from '../EmojiHelper'
import StickersHelper from '../StickersHelper'
import MentionsHelper from '../MentionsHelper'
import InlineResultsHelper from '../InlineResultsHelper'
import type { Sticker } from '../../core/managers/stickersManager'
import type { Peer } from '../../core/managers/peersManager'
import type { InlineResult } from '../../core/managers/botsManager'

/** Пустой контейнер хелпера — состояние «ещё не инициализирован» из tweb. */
export function EmptyHelper({ kind }: { kind: string }) {
  return <div className={`autocomplete-helper z-depth-1 ${kind}`} />
}

/** input.ts:927 — список команд бота; идёт ПЕРЕД reply-плашкой. */
export function BotCommandsHelper() {
  // Фичи «меню команд бота» у нас нет — слот пуст, как у tweb до первого init().
  return <EmptyHelper kind="autocomplete-peer-helper bot-commands" />
}

interface Props {
  stickerEmoji: string | null
  onPickSticker?: (st: Sticker) => void
  onPickStickerSuggestion: (st: Sticker) => void
  emojiSug: { list: string[]; idx: number } | null
  onPickEmoji: (e: string) => void
  mentionSug: { list: Peer[]; idx: number } | null
  onPickMention: (p: Peer) => void
  inlineSug: { list: InlineResult[]; idx: number } | null
  onPickInline: (r: InlineResult) => void
}

/** Слоты stickers → emoji → commands → mentions → inline (между плашкой и строкой ввода). */
export default function AutocompleteHelpers({
  stickerEmoji, onPickSticker, onPickStickerSuggestion,
  emojiSug, onPickEmoji, mentionSug, onPickMention, inlineSug, onPickInline,
}: Props) {
  // Каскад tweb: показанный хелпер прячет остальные, кроме своих siblings
  // (autocompleteHelperController.ts:37-47; emoji+stickers — siblings, input.ts:1292).
  const showStickers = !!onPickSticker && !!stickerEmoji && !mentionSug && !inlineSug
  const showEmoji = !!emojiSug && !mentionSug && !inlineSug && !stickerEmoji
  const showMentions = !!mentionSug && !inlineSug
  return (
    <>
      {showStickers
        ? <StickersHelper key={stickerEmoji} emoji={stickerEmoji} onPick={onPickStickerSuggestion} />
        : <EmptyHelper kind="stickers-helper" />}
      {showEmoji && emojiSug
        ? <EmojiHelper emojis={emojiSug.list} activeIdx={emojiSug.idx} onPick={onPickEmoji} />
        : <EmptyHelper kind="emoji-helper" />}
      {/* Автокомплита «/команд» у нас нет — слот пуст (input.ts:1294). */}
      <EmptyHelper kind="autocomplete-peer-helper commands-helper" />
      {showMentions && mentionSug
        ? <MentionsHelper peers={mentionSug.list} activeIdx={mentionSug.idx} onPick={onPickMention} />
        : <EmptyHelper kind="autocomplete-peer-helper mentions-helper" />}
      {inlineSug
        ? <InlineResultsHelper results={inlineSug.list} activeIdx={inlineSug.idx} onPick={onPickInline} />
        : <EmptyHelper kind="inline-helper" />}
    </>
  )
}

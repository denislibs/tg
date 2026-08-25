// Реакции бабла — порт tweb `chat/reactions.ts` (`ReactionsElement`) и
// `chat/reaction.ts` (`ReactionElement`) в применимом объёме.
//
// РАЗМЕТКА 1:1 с оригиналом (reactions.ts:87,449; reaction.ts:34-35,739-1032;
// док `docs/tweb/bubbles.md` §4.21):
//
//   div.reactions.reactions-block.reactions-like-block
//     └ div.reaction.reaction-block[.is-chosen]
//         ├ div.reaction-sticker      ← сам эмодзи
//         └ span.reaction-counter     ← число, начиная с четвёртой реакции
//
// Раскладка ВСЕГДА block: `USER_REACTIONS_INLINE = false` (bubbles.ts:260) —
// inline-режим в личках выключен у самого оригинала, и ветка под него была бы
// мёртвым кодом.
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • АВАТАРКИ реагировавших вместо счётчика (reaction.ts:1060-1075) — правило
//    оригинала «меньше четырёх и список видно» перенесено, но сам стек
//    (`StackedAvatars`) не портирован: это отдельный компонент.
//  • Кастом-эмодзи реакции (`reactionCustomEmoji`) — подсистемы кастом-эмодзи
//    нет; такой чип показывает свой эмодзи-фолбэк.
//  • Платная ⭐-реакция, теги «Избранного», around-эффекты и анимации появления
//    — свои подсистемы, каждая со своей задачей.
import type { MessageReactions, Reaction, ReactionCount } from '@core/models'
import { isChosen, reactionKey } from '@core/reactions/messageReactions'

/** Счётчик показывается начиная с ЧЕТВЁРТОЙ реакции (tweb
 *  `REACTIONS_DISPLAY_COUNTER_AT[Block] = 4`, reaction.ts:49-52). До неё место
 *  занимают аватарки реагировавших. */
export const REACTIONS_DISPLAY_COUNTER_AT = 4

/** Эмодзи чипа: у обычной реакции он и есть её значение. */
function reactionEmoticon(reaction: Reaction): string {
  return reaction._ === 'reactionEmoji' ? reaction.emoticon : ''
}

/** Один чип — порт `ReactionElement` (reaction.ts:739-1032). */
function createReaction(count: ReactionCount): HTMLElement {
  const chip = document.createElement('div')
  chip.classList.add('reaction', 'reaction-block')
  // `is-chosen` — МОЯ реакция (`chosen_order` у оригинала): по нему CSS красит
  // чип в цвет акцента.
  if (isChosen(count)) chip.classList.add('is-chosen')
  chip.dataset.reaction = reactionKey(count.reaction)

  const sticker = document.createElement('div')
  sticker.classList.add('reaction-sticker')
  sticker.textContent = reactionEmoticon(count.reaction)
  chip.append(sticker)

  // Счётчик — только начиная с порога; до него оригинал показывает аватарки
  // (их у нас пока нет, см. шапку), поэтому чип остаётся без числа — как и в
  // оригинале, где `renderAvatars` снимает счётчик.
  if (count.count >= REACTIONS_DISPLAY_COUNTER_AT) {
    const counter = document.createElement('span')
    counter.classList.add('reaction-counter')
    counter.textContent = String(count.count)
    chip.append(counter)
  }

  return chip
}

/**
 * Контейнер реакций сообщения.
 *
 * `undefined` — реакций нет вовсе, и узла быть не должно: пустой контейнер
 * занял бы строку под баблом (тот же гейт у оригинала — :9835-9837
 * `!reactions.results.length`).
 */
export function createReactionsElement(reactions: MessageReactions | undefined): HTMLElement | undefined {
  const results = reactions?.results
  if (!results?.length) return undefined

  const container = document.createElement('div')
  container.classList.add('reactions', 'reactions-block', 'reactions-like-block')
  for (const count of results) {
    container.append(createReaction(count))
  }
  return container
}

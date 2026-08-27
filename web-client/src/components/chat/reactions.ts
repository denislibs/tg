// Реакции бабла — порт tweb `chat/reactions.ts` (`ReactionsElement`) и
// `chat/reaction.ts` (`ReactionElement`) в применимом объёме.
//
// РАЗМЕТКА 1:1 с оригиналом (reactions.ts:87,449; reaction.ts:34-35,739-1032;
// док `docs/tweb/bubbles.md` §4.21):
//
//   div.reactions.reactions-block.reactions-like-block
//     └ div.reaction.reaction-block[.is-chosen]
//         ├ div.reaction-sticker      ← сам эмодзи
//         ├ div.stacked-avatars       ← ЛИБО аватарки реагировавших (count < 4)
//         └ span.reaction-counter     ← ЛИБО число (см. `renderCounter` ниже)
//
// Раскладка ВСЕГДА block: `USER_REACTIONS_INLINE = false` (bubbles.ts:260) —
// inline-режим в личках выключен у самого оригинала, и ветка под него была бы
// мёртвым кодом.
//
// ─── Чего здесь нет и почему ────────────────────────────────────────────────
//  • Кастом-эмодзи реакции (`reactionCustomEmoji`) — подсистемы кастом-эмодзи
//    нет; такой чип показывает свой эмодзи-фолбэк.
//  • Платная ⭐-реакция и теги «Избранного» — свои подсистемы, каждая со своей
//    задачей.
//  • Иконка чипа из каталога (`availableReaction.static_icon`/`center_icon`,
//    reaction.ts:817) не портирована: чип показывает ТЕКСТОВЫЙ эмодзи. Отсюда
//    же единственное расхождение эффекта — см. `fireAroundAnimation`.
import type { MessageReactions, Reaction, ReactionCount } from '@core/models'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import { isChosen, reactionKey, recentOf, totalReactions } from '@core/reactions/messageReactions'
import { isUser } from '@core/peers/peerId'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import StackedAvatars from '@components/stackedAvatars'
import type { AvatarManagers } from '@components/avatar'
import wrapSticker from '@components/wrappers/sticker'
import wrapStickerAnimation from '@components/wrappers/stickerAnimation'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import liteMode from '@helpers/liteMode'
import type { Middleware } from '@helpers/middleware'
import { fastRaf } from '@helpers/schedulers'
import noop from '@helpers/noop'

/** Счётчик показывается начиная с ЧЕТВЁРТОЙ реакции (tweb
 *  `REACTIONS_DISPLAY_COUNTER_AT[Block] = 4`, reaction.ts:49-52). До неё место
 *  занимают аватарки реагировавших. */
export const REACTIONS_DISPLAY_COUNTER_AT = 4

/** tweb `REACTIONS_SIZE[Block]` (reaction.ts:43-46) — сторона иконки чипа. */
const REACTIONS_SIZE_BLOCK = 22

/** tweb reaction.ts:1100-1105: у block/tag к размеру иконки добавляется 18 —
 *  это и есть сторона квадрата, которым эффект перерисовывает иконку. */
const AROUND_ADD = 18

/** tweb reaction.ts:1119 `sizes.effectSize`. */
const AROUND_EFFECT_SIZE = 80

/** tweb reaction.ts:1077 — размер аватарки в чипе. */
const AVATAR_SIZE = 24

/**
 * Чип реакции. Два поля-состояния держит сам узел — ровно так же, как
 * `ReactionElement` (кастомный элемент) держит их у себя:
 *  • `hasAroundAnimation` — tweb reaction.ts:1146,1531-1537 (`options.cache`):
 *    пока эффект этого чипа не доиграл, второй не запускается;
 *  • `stackedAvatars` — tweb reaction.ts:1074-1083.
 * Глобальных дополнений `HTMLElement` в проекте нет (тот же вычет у
 * `wrappers/sticker.ts::StickerVideo`), поэтому контракт выражен типом на месте.
 */
type ReactionChip = HTMLElement & {
  hasAroundAnimation?: Promise<unknown>
  stackedAvatars?: StackedAvatars
}

export interface ReactionsManagers extends AvatarManagers {
  /** Каталог доступных реакций — единственный источник файлов эффекта
   *  (`around`/`center`). Необязателен: без него чипы рисуются, но эффект при
   *  постановке реакции не играет. */
  reactions?: { list(): Promise<AvailableReaction[]> }
}

export interface ReactionsElementOptions {
  /** чат, которому принадлежит сообщение (tweb `context.peerId`) */
  peerId: PeerId
  /** Бабл, в который встанет контейнер. Нужен ровно за тем же, за чем оригиналу
   *  `this.isConnected` (reactions.ts:421-427): эффект играет ИЗМЕНЕНИЕ реакций
   *  у уже показанного сообщения. Пока бабл собирается (узел ещё не в
   *  документе), изменять нечего — это первая сборка. */
  bubble: HTMLElement
  middleware: Middleware
  managers: ReactionsManagers
  /** сообщение исходящее (tweb `message.pFlags.out`) — половина правила
   *  `changedResults`, см. `getChangedResults` */
  isOut?: boolean
  /** узел `.reactions` ЭТОГО ЖЕ бабла прошлого поколения; `null`/отсутствует —
   *  реакций у сообщения не было вовсе. У tweb сравнивать не с чем: там
   *  `changedResults` считает ВЛАДЕЛЕЦ сообщения
   *  (appMessagesManager.ts:10651-10677 — у него на руках обе версии агрегата) и
   *  приносит их событием `messages_reactions`. У нас событие другое:
   *  `message_edit` — единственная воронка любого изменения сообщения и несёт
   *  только НОВУЮ версию (`lib/rootScope.ts:183`), поэтому предыдущая берётся
   *  оттуда, где она ещё жива, — из прошлого узла. */
  previous?: HTMLElement | null
  /** скроллер ленты: за ним следует летящий эффект (tweb reaction.ts:1120) */
  scrollable?: { container: HTMLElement }
}

/** Эмодзи чипа: у обычной реакции он и есть её значение. */
function reactionEmoticon(reaction: Reaction): string {
  return reaction._ === 'reactionEmoji' ? reaction.emoticon : ''
}

/**
 * Порт `ReactionElement.renderCounter` (reaction.ts:1013-1058) в применимом
 * объёме: число показывается, если реакций уже не меньше порога ЛИБО аватарки
 * показать нельзя (:1029 `count >= displayOn || (Block && !canRenderAvatars)`).
 *
 * Прежде здесь стоял только первый терм — и чип с одной-двумя реакциями в
 * группе оставался вообще без числа: аватарок ещё нет, счётчика уже нет.
 *
 * `formatNumber` оригинала (:1035) не портирован: компактная форма («1,2K») —
 * отдельный форматтер, у нас его роль играет `fmtViews`, но у него другая
 * точность. Расхождение видно только на тысячах реакций.
 */
function renderCounter(chip: HTMLElement, count: ReactionCount, canRenderAvatars: boolean): void {
  if (count.count < REACTIONS_DISPLAY_COUNTER_AT && canRenderAvatars) return

  const counter = document.createElement('span')
  counter.classList.add('reaction-counter')
  counter.textContent = String(count.count)
  chip.append(counter)
}

/**
 * Порт `ReactionElement.renderAvatars` (reaction.ts:1060-1084): аватарки вместо
 * числа, пока реакций этого чипа меньше порога и список видно.
 */
function renderAvatars(
  chip: ReactionChip,
  recent: PeerId[],
  count: ReactionCount,
  canRenderAvatars: boolean,
  options: ReactionsElementOptions,
): void {
  // tweb :1065-1072.
  if (count.count >= REACTIONS_DISPLAY_COUNTER_AT || !canRenderAvatars) return
  if (!recent.length) return

  const stackedAvatars = new StackedAvatars({
    avatarSize: AVATAR_SIZE,
    middleware: options.middleware,
    managers: options.managers,
  })

  chip.stackedAvatars = stackedAvatars
  chip.append(stackedAvatars.container)
  void stackedAvatars.render(recent)
}

/** Один чип — порт `ReactionElement` (reaction.ts:739-1032). */
function createReaction(
  count: ReactionCount,
  reactions: MessageReactions,
  canRenderAvatars: boolean,
  options?: ReactionsElementOptions,
): ReactionChip {
  const chip = document.createElement('div') as ReactionChip
  chip.classList.add('reaction', 'reaction-block')
  // `is-chosen` — МОЯ реакция (`chosen_order` у оригинала): по нему CSS красит
  // чип в цвет акцента.
  if (isChosen(count)) chip.classList.add('is-chosen')
  chip.dataset.reaction = reactionKey(count.reaction)
  // Своя версия счётчика на самом узле. У tweb её носит поле
  // `reactionElement.reactionCount` (reaction.ts:722), но там чип ПЕРЕЖИВАЕТ
  // обновление, а у нас узел собирается заново — значит, прошлое значение может
  // жить только в прошлом узле (см. `previous` в опциях).
  chip.dataset.count = String(count.count)

  const sticker = document.createElement('div')
  sticker.classList.add('reaction-sticker')
  sticker.textContent = reactionEmoticon(count.reaction)
  chip.append(sticker)

  if (options) {
    renderAvatars(chip, recentOf(reactions, count.reaction), count, canRenderAvatars, options)
  }
  renderCounter(chip, count, canRenderAvatars)

  return chip
}

/**
 * Порт `AppMessagesManager.batchUpdateReactions` (appMessagesManager.ts:10651-10677)
 * — какие чипы «выросли» и потому обязаны отыграть эффект: у ИСХОДЯЩЕГО
 * сообщения любая подросшая реакция (кто-то отреагировал мне), у любого — та,
 * которую я только что поставил сам.
 *
 * Предыдущая версия читается из прошлого узла: `data-reaction` + `data-count` +
 * класс `is-chosen` — это ровно те три факта, которыми пользуется правило
 * оригинала (`reactionsEqual`, `count`, `chosen_order !== undefined`).
 */
function getChangedResults(
  results: ReactionCount[],
  previous: HTMLElement | null | undefined,
  isOut: boolean,
): ReactionCount[] {
  const prev = new Map<string, { count: number, chosen: boolean }>()
  previous?.querySelectorAll<HTMLElement>('.reaction[data-reaction]').forEach((chip) => {
    prev.set(chip.dataset.reaction!, {
      count: Number(chip.dataset.count),
      chosen: chip.classList.contains('is-chosen'),
    })
  })

  return results.filter((count) => {
    const before = prev.get(reactionKey(count.reaction))
    return (isOut && (!before || count.count > before.count)) ||
      (isChosen(count) && (!before || !before.chosen))
  })
}

/**
 * Порт `ReactionsElement.handleChangedResults` (reactions.ts:430-446).
 *
 * `await getHeavyAnimationPromise()` (:431) — 1:1 оригинал: пока экран занят
 * тяжёлым переходом, эффект не запускается. Он же уводит запуск за пределы
 * синхронной сборки узла, поэтому к моменту полёта контейнер уже висит в бабле
 * (у tweb ту же роль играет пара `isConnected`/`onConnectCallback`, :421-427).
 */
async function handleChangedResults(
  changed: { count: ReactionCount, chip: ReactionChip }[],
  options: ReactionsElementOptions,
): Promise<void> {
  await getHeavyAnimationPromise()
  if (!options.middleware()) return

  for (const { count, chip } of changed) {
    fireAroundAnimation({
      chip,
      reaction: count.reaction,
      middleware: options.middleware,
      managers: options.managers,
      scrollable: options.scrollable,
    })
  }
}

/**
 * Эффект вокруг чипа — порт `ReactionElement.fireAroundAnimation`
 * (reaction.ts:1099-1122 → статический :1124-1290, ветка обычной эмодзи-реакции
 * с УЖЕ ЗАГРУЖЕННЫМ эффектом, :1439-1470).
 *
 * Что рисуется (tweb :1169-1231, :1457-1467):
 *  • `around_animation` каталога — квадрат 80px, летящий в общем контейнере
 *    поверх всего приложения (`wrappers/stickerAnimation.ts`), чтобы его не
 *    резал `overflow` бабла;
 *  • `center_icon` каталога — оверлей `div.reaction-sticker-activate` ВНУТРИ
 *    `.reaction-sticker`, размером 22+18=40px (его и режет `overflow: hidden`
 *    самого `.reaction-sticker` — так оригинал «приближает» иконку на время
 *    эффекта, `_reaction.scss:32-39`).
 * Оба плеера стартуют вместе на первом кадре иконки (:1459-1467), гаснут по
 * последнему кадру иконки (:1444-1454) и по смерти `middleware` (:1441).
 *
 * ─── Расхождения, каждое со своей причиной ─────────────────────────────────
 *  • Класс `has-animation` ставится, как в оригинале (:1462), но НИЧЕГО не
 *    гасит: его правило прячет `.media-sticker` (`_reaction.scss:41-45`), а у
 *    нашего чипа иконка — текстовый эмодзи (см. шапку файла). Оверлей ложится
 *    поверх текста, а не вместо него. Класс всё равно ставится и снимается:
 *    правило приедет само вместе с иконкой из каталога.
 *  • Ветка «эффект ещё не скачан» (:1495-1519) — генерик-анимация с маской из
 *    первого кадра иконки: своя подсистема (`reactionGeneric`-ассет, покадровая
 *    перерисовка `overrideRender`, `layersPositions`), у нас нечем. Мы просто не
 *    играем ничего: `wrapSticker` скачает файл сам, и следующий клик отыграет.
 *  • Ветка платной ⭐-реакции (:1523-1528, ассеты `StarReactionEffect*`) и ветка
 *    кастом-эмодзи (:1529) — своих подсистем нет.
 *  • `options.cache.wrapStickerPromise` (:1446-1451) — задержка перед снятием
 *    оверлея, пока доигрывает КРОССФЕЙД иконки чипа. Иконки чипа у нас нет,
 *    поэтому работает вторая ветка того же `if` (:1450 `removeOnFrame()`).
 */
export function fireAroundAnimation(options: {
  chip: ReactionChip
  reaction: Reaction
  middleware: Middleware
  managers: ReactionsManagers
  scrollable?: { container: HTMLElement }
  /** tweb `waitPromise` (:1099) — эффект ждёт чужого события перед стартом */
  waitPromise?: Promise<unknown>
}): void {
  const { chip, reaction, middleware, managers } = options

  // tweb :1145-1147.
  if (chip.hasAroundAnimation || !liteMode.isAvailable('effects_reactions')) return

  // tweb :1151-1152 (`reactionEmpty`) + развилка :1520-1531: сюда доходит
  // только обычная эмодзи-реакция.
  if (reaction._ !== 'reactionEmoji') return

  const catalog = managers.reactions
  if (!catalog) return

  const stickerContainer = chip.querySelector<HTMLElement>('.reaction-sticker')
  if (!stickerContainer) return

  const size = REACTIONS_SIZE_BLOCK + AROUND_ADD

  const promise = catalog.list().then((available) => {
    if (!middleware()) return

    // tweb :1477-1490: у оригинала это `apiManagerProxy.getReaction(emoticon)`.
    const availableReaction = available.find((r) => r.emoji === reaction.emoticon)
    if (!availableReaction?.aroundMediaId || !availableReaction.centerMediaId) return

    // tweb :1170-1172.
    const div = document.createElement('div')
    div.classList.add('reaction-sticker-activate')

    // tweb :1185-1206 (`aroundParams` + `aroundWrap`).
    const aroundWrap = wrapStickerAnimation({
      mediaId: availableReaction.aroundMediaId,
      size: AROUND_EFFECT_SIZE,
      target: stickerContainer,
      play: false,
      middleware,
      scrollable: options.scrollable,
    })

    // tweb :1233-1257 (`stickerResult`).
    const iconRender = wrapSticker({
      div,
      mediaId: availableReaction.centerMediaId,
      width: size,
      height: size,
      withThumb: false,
      needFadeIn: false,
      play: false,
      loop: false,
      group: 'none',
      middleware,
    }).render

    // tweb :1259-1270.
    return Promise.all([iconRender, aroundWrap.stickerPromise, options.waitPromise])
      .then(([icon, aroundPlayer]) => {
        // tweb :1267-1276 (`remove`).
        const remove = () => {
          if (icon instanceof LottiePlayer) icon.remove()
          div.remove()
          stickerContainer.classList.remove('has-animation')
        }

        // tweb :1278-1281: нечем играть — снять и выйти.
        if (!(icon instanceof LottiePlayer) || !aroundPlayer) {
          remove()
          return
        }

        const iconPlayer = icon
        // tweb :1437-1441.
        const removeOnFrame = () => fastRaf(remove)
        middleware.onDestroy(removeOnFrame)

        // tweb :1443-1454 (ветка без `wrapStickerPromise`, см. шапку).
        iconPlayer.addEventListener('enterFrame', (frameNo) => {
          if (frameNo === iconPlayer.maxFrame) removeOnFrame()
        })

        // tweb :1456-1467.
        iconPlayer.onFirstFrame(() => {
          stickerContainer.append(div)
          stickerContainer.classList.add('has-animation')
          iconPlayer.play()
          aroundPlayer.play()
        })
      })
  })

  // tweb :1531-1537.
  middleware.onDestroy(() => { chip.hasAroundAnimation = undefined })
  chip.hasAroundAnimation = promise
  promise.finally(() => {
    if (chip.hasAroundAnimation === promise) chip.hasAroundAnimation = undefined
  }).catch(noop)
}

/**
 * Контейнер реакций сообщения.
 *
 * `undefined` — реакций нет вовсе, и узла быть не должно: пустой контейнер
 * занял бы строку под баблом (тот же гейт у оригинала — :9835-9837
 * `!reactions.results.length`).
 *
 * Без `options` чипы рисуются без аватарок и без эффекта — это ровно ветка
 * оригинала `canRenderAvatars === false` (счётчик тогда показывается всегда,
 * reaction.ts:1029).
 */
export function createReactionsElement(
  reactions: MessageReactions | undefined,
  options?: ReactionsElementOptions,
): HTMLElement | undefined {
  const results = reactions?.results
  if (!results?.length) return undefined

  // Прошлое поколение чипов гасит СВОИ аватарки: у оригинала чип переживает
  // обновление и своей зоной актуальности владеет сам, у нас узел новый, и
  // старую зону некому закрыть, кроме владельца новой.
  options?.previous?.querySelectorAll<ReactionChip>('.reaction').forEach((chip) => {
    chip.stackedAvatars?.destroy()
  })

  // tweb reactions.ts:304-307. Терм `reactions.pFlags.can_see_list` НЕ
  // портирован: этого флага нет ни в модели (`core/models.ts:756-761`), ни на
  // проводе — бэкенд его не производит (`backend/internal/domain/reaction.go`).
  // Остаётся вторая половина того же условия — личка, где список видно всегда.
  const canRenderAvatars = !!options && isUser(options.peerId) &&
    totalReactions(reactions) < REACTIONS_DISPLAY_COUNTER_AT

  const container = document.createElement('div')
  container.classList.add('reactions', 'reactions-block', 'reactions-like-block')

  const chips = results.map((count) => {
    const chip = createReaction(count, reactions!, canRenderAvatars, options)
    container.append(chip)
    return { count, chip }
  })

  // tweb reactions.ts:419-428: эффект играется только у УЖЕ показанного бабла;
  // пока бабл собирается, «изменения» нет по построению — это первая сборка.
  if (options?.bubble.isConnected) {
    const changed = getChangedResults(results, options.previous, !!options.isOut)
    if (changed.length) {
      void handleChangedResults(
        chips.filter(({ count }) => changed.includes(count)),
        options,
      )
    }
  }

  return container
}

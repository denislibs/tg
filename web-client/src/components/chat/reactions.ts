// Реакции бабла — порт tweb `chat/reactions.ts` (`ReactionsElement`) и
// `chat/reaction.ts` (`ReactionElement`) в применимом объёме.
//
// РАЗМЕТКА 1:1 с оригиналом (reactions.ts:87,449; reaction.ts:34-35,739-1032;
// док `docs/tweb/bubbles.md` §4.21):
//
//   div.reactions.reactions-block.reactions-like-block
//     └ div.reaction.reaction-block.reaction-like-block
//         [.is-chosen.forwards][.is-last][.is-inactive]
//         ├ div.reaction-sticker[.is-regular|.is-static]  ← иконка из каталога
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
//  • `static: true` у иконки чипа (reaction.ts:894) — см. `renderIcon`: у
//    оригинала это ОТДЕЛЬНЫЙ растровый `photoSize` документа
//    (`wrappers/sticker.ts:206-208`, `:521-522` → `<img class="media-sticker">`),
//    а у нас вход стикера — плоский номер файла без превью-ступеней (задача #47).
//    Иконка чипа НЕПОДВИЖНА и там и тут: оригинал рисует растр, мы — первый
//    кадр lottie (`play: false`). Играет не она, а эффект постановки
//    (`fireAroundAnimation`) и панель выбора (`chat/reactionsMenu.ts`).
import type { MessageReactions, Reaction, ReactionCount } from '@core/models'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { ChannelFull, ChatReactions } from '@core/peers/peer'
import { isUser } from '@core/peers/peerId'
import { cachedPeerFull } from '@core/chatFullCache'
import { canViewReactionsList, isChosen, reactionKey, recentOf, totalReactions } from '@core/reactions/messageReactions'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import { setTransition } from '@core/dom/setTransition'
import formatNumber from '@helpers/number/formatNumber'
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
 *  это и есть сторона квадрата, которым эффект перерисовывает иконку. То же
 *  число стоит и в CSS: `--reaction-offset` у block равен -.5625rem, то есть
 *  раздувание `is-regular` — `--reaction-offset * -2` = те же 18
 *  (`_reaction.scss:47-56`, :84-86). Оверлей эффекта и базовая иконка обязаны
 *  совпадать по геометрии — иначе на подмене был бы скачок. */
const AROUND_ADD = 18

/** tweb reaction.ts:1119 `sizes.effectSize`. */
const AROUND_EFFECT_SIZE = 80

/** tweb reaction.ts:1077 — размер аватарки в чипе. */
const AVATAR_SIZE = 24

/**
 * Чип реакции. Поля-состояния держит сам узел — ровно так же, как
 * `ReactionElement` (кастомный элемент) держит их у себя:
 *  • `hasAroundAnimation` — tweb reaction.ts:1146,1531-1537 (`options.cache`):
 *    пока эффект этого чипа не доиграл, второй не запускается;
 *  • `wrapStickerPromise` — tweb reaction.ts:889,898-902;
 *  • `stackedAvatars` — tweb reaction.ts:1074-1083.
 * Глобальных дополнений `HTMLElement` в проекте нет (тот же вычет у
 * `wrappers/sticker.ts::StickerVideo`), поэтому контракт выражен типом на месте.
 */
type ReactionChip = HTMLElement & {
  hasAroundAnimation?: Promise<unknown>
  /** tweb reaction.ts:889,898-902 — жив, пока иконка чипа не показана; за него
   *  держится эффект, чтобы не снять оверлей посреди кроссфейда (:1446-1451). */
  wrapStickerPromise?: Promise<unknown>
  stackedAvatars?: StackedAvatars
}

/** Каталог доступных реакций (`messages.getAvailableReactions`) — источник
 *  файлов чипа (`center`/`static`), эффекта (`around`/`center`) и панели
 *  быстрых реакций (`appear`/`select`, `chat/reactionsMenu.ts`). */
export interface ReactionsCatalog {
  list(): Promise<AvailableReaction[]>
}

/** Полная карточка чата — источник политики реакций
 *  (`chatFull.available_reactions`). Порт `appProfileManager.getChatFull`
 *  (appReactionsManager.ts:226): у оригинала это тоже «отдай кэш, иначе сходи». */
export interface ChatFullSource {
  card(peerId: PeerId): Promise<{ fullChat: ChannelFull } | null>
}

/** Носитель каталога. Отдельно от `ReactionsManagers`: панели выбора не нужны
 *  ни аватарки, ни что-либо ещё из среза ленты — ей нужен только каталог. */
export interface ReactionsCatalogManagers {
  /** Необязателен: без него чип показывает текстовое эмодзи и не играет
   *  эффект, а панель выбора не появляется вовсе. */
  reactions?: ReactionsCatalog
  /** Необязателен: спрашивает его только политика реакций чата
   *  (`getAvailableReactionsForPeer`), и только когда карточки ещё нет в
   *  зеркале. */
  groups?: ChatFullSource
}

export interface ReactionsManagers extends AvatarManagers, ReactionsCatalogManagers {}

/**
 * Каталог читается ОДИН РАЗ за сессию — порт кэша оригинала
 * (appReactionsManager.ts:169 `if(this.availableReactions) return ...`, зеркало
 * в таб :186-190, поэтому `apiManagerProxy.getReaction` там синхронный). У нас
 * `list()` — это GET `/reactions` без всякого кэша, а спрашивают его теперь И
 * каждый чип (иконка), И каждый запуск эффекта.
 *
 * Провалившийся запрос из кэша выбрасывается, чтобы следующий чип попробовал
 * заново, — тот же приём, что у `loadReactionGeneric` (reaction.ts:244-248).
 * Ключ — сам объект-менеджер: это единственная граница жизни каталога, которую
 * видно отсюда (в тестах у каждого набора свой двойник).
 */
const catalogCache = new WeakMap<object, Promise<AvailableReaction[]>>()

/** Порт `apiManagerProxy.getAvailableReactions()` (reaction.ts:805 «второй
 *  аргумент», reactionsMenu.ts:235): весь каталог одним обещанием.
 *  `undefined` — каталога нет вовсе. */
export function getAvailableReactions(
  managers: ReactionsCatalogManagers,
): Promise<AvailableReaction[]> | undefined {
  const catalog = managers.reactions
  if (!catalog) return undefined

  let list = catalogCache.get(catalog)
  if (!list) {
    list = catalog.list()
    catalogCache.set(catalog, list)
    list.catch(() => {
      if (catalogCache.get(catalog) === list) catalogCache.delete(catalog)
    })
  }

  return list
}

/** Что панель выбора вправе показать в этом пире — порт `PeerAvailableReactions`
 *  (appReactionsManager.ts:52-61) без `trulyAll`/`atUniqCap`: первый читает
 *  только кнопка «ещё» (её нет), второй — лимит `reactions_uniq_max`, которого
 *  нет на бэке (`0003_reactions.sql:7` — PK без лимита на число видов). */
export interface PeerAvailableReactions {
  type: ChatReactions['_']
  reactions: Reaction[]
}

/**
 * Полная карточка чата: сперва зеркало главного потока (`core/chatFullCache.ts`
 * — его наполняет колонка чата), иначе поход в сеть. Ровно развилка
 * `appProfileManager.getChatFull` у оригинала (appReactionsManager.ts:226):
 * там она тоже отдаёт кэш синхронно и ходит в сеть только на промах.
 */
async function getChatFull(
  peerId: PeerId,
  managers: ReactionsCatalogManagers,
): Promise<ChannelFull | undefined> {
  const cached = cachedPeerFull(peerId)
  if (cached) return cached as ChannelFull
  if (!managers.groups) return undefined
  return managers.groups.card(peerId).then((card) => card?.fullChat, () => undefined)
}

/**
 * Политика реакций пира — порт `AppReactionsManager.getAvailableReactionsForPeer`
 * (appReactionsManager.ts:206-277). Отвечает на единственный вопрос панели
 * выбора: КАКИЕ реакции здесь вообще можно поставить.
 *
 * Ветки оригинала:
 *  • личка (:214-224) — топ-реакции пользователя; топа у нас нет ни на бэке, ни
 *    на проводе (`docs` разведки §3.3), поэтому берётся весь активный каталог в
 *    его порядке. Тип при этом `chatReactionsAll`, как и у оригинала.
 *  • чат/канал (:226-277) — `chatFull.available_reactions`:
 *      `chatReactionsNone` → пустой список, панели нет;
 *      `chatReactionsSome` → пересечение с активным каталогом В ПОРЯДКЕ КАТАЛОГА
 *        (:253-262);
 *      `chatReactionsAll` → весь активный каталог.
 *
 * ─── Расхождения ───────────────────────────────────────────────────────────
 *  • Переписывание `chatReactionsAll` (без `allow_custom`) в `chatReactionsSome`
 *    с флагом `trulyAll` (:238-245) не портировано: у оригинала оно нужно, чтобы
 *    в полном пикере спрятать вкладки кастом-эмодзи, а обе ветки дают ОДИН И ТОТ
 *    ЖЕ список — весь активный каталог. Кастом-эмодзи-реакций у нас нет по всей
 *    вертикали, читателя `trulyAll` тоже нет.
 *  • Реакция политики, которой нет в каталоге, ОСТАЁТСЯ в списке — как у
 *    оригинала (:254 `|| reaction`); её ячейка покажет текстовое эмодзи без
 *    иконки. Порядок таких — тоже оригинала: `indexes.get(...) || 0` (:257)
 *    ставит их в начало.
 *  • `unshiftQuickReaction` (:222,268) и платная ⭐-реакция (:271-273) — свои
 *    подсистемы, ни одной из них у нас нет.
 *  • Карточку чата достать не удалось (менеджера нет либо запрос упал) —
 *    считаем `chatReactionsAll`. Молча выключать реакции по НЕЗНАНИЮ политики
 *    нельзя: право проверяет и бэк (`usecase/chat/reaction.go:35-46`), а панель,
 *    исчезнувшая из-за сетевой ошибки, — это уже другой баг. У оригинала такой
 *    развилки нет: `getChatFull` там всегда доводит ответ.
 */
export async function getAvailableReactionsForPeer(
  peerId: PeerId,
  managers: ReactionsCatalogManagers,
): Promise<PeerAvailableReactions | undefined> {
  const catalog = getAvailableReactions(managers)
  if (!catalog) return undefined

  // tweb `getActiveAvailableReactions` (appReactionsManager.ts:199-204).
  const active = (await catalog).filter((availableReaction) => !availableReaction.inactive)
  const all = (): PeerAvailableReactions => ({
    type: 'chatReactionsAll',
    reactions: active.map((availableReaction) => ({ _: 'reactionEmoji', emoticon: availableReaction.emoji })),
  })

  // tweb :214-224.
  if (isUser(peerId)) return all()

  const chatFull = await getChatFull(peerId, managers)
  if (!chatFull) return all()

  // tweb :227.
  const policy: ChatReactions = chatFull.available_reactions ?? { _: 'chatReactionsNone' }
  if (policy._ === 'chatReactionsNone') return { type: policy._, reactions: [] }
  if (policy._ === 'chatReactionsAll') return all()

  // tweb :253-262 — порядок КАТАЛОГА, а не порядок политики.
  const indexes = new Map(active.map((availableReaction, idx) => [availableReaction.emoji, idx]))
  const reactions = policy.reactions
    .slice()
    .sort((a, b) => (indexes.get(a.emoticon) || 0) - (indexes.get(b.emoticon) || 0))
    .map((reaction): Reaction => ({ _: 'reactionEmoji', emoticon: reaction.emoticon }))

  return { type: policy._, reactions }
}

/** Порт `apiManagerProxy.getReaction(emoticon)` (reaction.ts:805,1476):
 *  каталог + поиск по эмодзи. `undefined` — каталога нет вовсе. */
function getAvailableReaction(
  managers: ReactionsManagers,
  emoticon: string,
): Promise<AvailableReaction | undefined> | undefined {
  return getAvailableReactions(managers)?.then((available) => available.find((r) => r.emoji === emoticon))
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
 * Число печатается компактной формой оригинала (`formatNumber`, :1035) — в
 * канале счётчик доходит до тысяч, и сырое «12500» пилюлю растягивает.
 */
function renderCounter(chip: HTMLElement, count: ReactionCount, canRenderAvatars: boolean): void {
  if (count.count < REACTIONS_DISPLAY_COUNTER_AT && canRenderAvatars) return

  const counter = document.createElement('span')
  counter.classList.add('reaction-counter')
  counter.textContent = formatNumber(count.count)
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

/**
 * Иконка чипа — порт `ReactionElement.render` (reaction.ts:804-823) и
 * `renderDoc` (:887-903).
 *
 * Роль каталога у оригинала ровно одна и та же на всё время жизни чипа:
 * `center_icon ?? static_icon` (:817), размером `REACTIONS_SIZE[Block]` (:888).
 * `appear`/`select` — роли ПАНЕЛИ выбора (reactionsMenu), в чип не попадают
 * никогда. Класс контейнера тоже выбирается по наличию `center_icon`
 * (:807-811): `is-regular` растягивает медиа до `size + offset*2`
 * (`_reaction.scss:47-56`), `is-static` оставляет как есть.
 *
 * ─── Расхождения, каждое со своей причиной ─────────────────────────────────
 *  • `static: true` (:894) не портирован: у нашего `wrapSticker` такой опции
 *    нет, и портировать её нечем — у оригинала она означает «взять растровый
 *    `photoSize` документа» (`wrappers/sticker.ts:206-208`), а плоский номер
 *    файла превью-ступеней не несёт (задача #47). Мы показываем ПЕРВЫЙ КАДР
 *    самого `center.tgs` (`play: false`, `loop: false`) — это ровно тот же
 *    неподвижный кадр, что и у оригинала, но узлом `canvas.lottie`, а не
 *    `img.media-sticker`. Класс `media-sticker` канвасу ставим сами (см. ниже):
 *    на нём висят ОБА правила иконки чипа — гашение на время эффекта
 *    (`_reaction.scss:41-45`) и раздувание `is-regular` (:47-56).
 *  • Текстовое эмодзи нижним слоем — НАШЕ, у оригинала его нет: там место
 *    иконки на время загрузки занимает stripped-превью документа
 *    (`wrappers/sticker.ts:247-276`), которого у плоского номера файла тоже
 *    нет. Снимается, как только иконка приехала.
 */
function renderIcon(
  chip: ReactionChip,
  stickerContainer: HTMLElement,
  reaction: Reaction,
  options: ReactionsElementOptions,
): void {
  const emoticon = reactionEmoticon(reaction)
  const emojiText = document.createTextNode(emoticon)
  stickerContainer.append(emojiText)

  const lookup = getAvailableReaction(options.managers, emoticon)
  if (!lookup) return

  const promise = lookup.then((availableReaction) => {
    if (!options.middleware() || !availableReaction) return

    // tweb :807-811.
    const isRegular = !!availableReaction.centerMediaId
    stickerContainer.classList.add(isRegular ? 'is-regular' : 'is-static')
    // tweb :813-815.
    if (availableReaction.inactive) chip.classList.add('is-inactive')

    // tweb :817.
    const mediaId = availableReaction.centerMediaId ?? availableReaction.staticMediaId
    if (!mediaId) return

    // tweb :889-897 — но размер ПОКАЗЫВАЕМЫЙ, а не размер контейнера.
    // `is-regular` раздувает медиа до `--reaction-size + --reaction-offset * -2`
    // = 22 + 18 = 40 и режет его `overflow: hidden` самого `.reaction-sticker`
    // (`_reaction.scss:47-56`) — так центральная иконка заполняет пилюлю.
    // Оригинал зовёт `wrapSticker` с 22 (:888), потому что медиа у него
    // РАСТРОВОЕ (`static: true`) и `choosePhotoSize` берёт ступень НЕ МЕНЬШЕ
    // запрошенной; наш плеер рисует канвас ровно в названный размер, и
    // 22 растянулись бы правилом CSS до 40 мылом.
    const size = isRegular ? REACTIONS_SIZE_BLOCK + AROUND_ADD : REACTIONS_SIZE_BLOCK

    return wrapSticker({
      div: stickerContainer,
      mediaId,
      width: size,
      height: size,
      needFadeIn: false,
      play: false,
      loop: false,
      middleware: options.middleware,
    }).render.then((media) => {
      // Оба правила иконки чипа у оригинала висят на классе `media-sticker`:
      // гашение на время эффекта (`_reaction.scss:41-45`) и размер `is-regular`
      // (:47-56). У tweb медиа иконки ВСЕГДА растровое `img.media-sticker`
      // (`static: true`, reaction.ts:894 → `wrappers/sticker.ts:521-522`), у нас
      // растра нет (задача #47) и приезжает `canvas.lottie` — класс ставим сами,
      // иначе оба правила до нашего узла не достают: на время around-эффекта
      // базовая иконка оставалась бы видна ПОД оверлеем, а превью прошлого
      // показа (`stickerAppearance` кладёт его с тем же классом) разошлось бы с
      // канвасом в размере.
      emojiText.remove()
      if (media instanceof LottiePlayer) {
        media.canvas.forEach((canvas) => canvas.classList.add('media-sticker'))
      }
      return media
    })
  })

  // tweb :889,898-902.
  chip.wrapStickerPromise = promise
  promise.finally(() => {
    if (chip.wrapStickerPromise === promise) chip.wrapStickerPromise = undefined
  }).catch(noop)
}

/**
 * Порт `ReactionElement.setIsChosen` (reaction.ts:1086-1097): МОЯ реакция
 * помечается не голым `is-chosen`, а ПЕРЕХОДОМ — подложку акцентного цвета CSS
 * зажигает только по паре `.is-chosen.forwards` (`_reaction.scss:127-133`), и
 * со статическим классом своя реакция оставалась незалитой.
 *
 * `duration` — выражение оригинала слово в слово: `this.isConnected ? 300 : 0`
 * (:1093). Чипу, ещё не вставленному в документ, перехода не дают, иначе
 * заливка «проявлялась» бы разом на всех уже стоявших реакциях при первом
 * показе бабла.
 *
 * ЧЕСТНО ПРО НАШУ ВЕТКУ: сегодня выражение всегда даёт 0. Чип у нас создаётся
 * отсоединённым и в документ попадает уже вместе со всем контейнером, который
 * `bubbles.ts::renderMessageMeta` (:1898-1901) сносит и собирает ЗАНОВО на
 * каждое обновление сообщения. У оригинала чип ПЕРЕЖИВАЕТ обновление
 * (reactions.ts:290-296 — `this.sorted.find(...)` переиспользует
 * `ReactionElement`), поэтому там второй вызов застаёт узел подключённым и
 * играет 300 мс. Ветка «300» станет достижимой ровно тогда, когда ряд начнёт
 * переиспользовать чипы; подделывать её постоянной 300 нельзя — переход
 * отыграется на КАЖДОМ показе бабла, чего у оригинала нет.
 */
function setIsChosen(chip: HTMLElement, chosen: boolean): void {
  // tweb :1088-1089.
  const wasChosen = chip.classList.contains('is-chosen') && !chip.classList.contains('backwards')
  if (wasChosen === chosen) return

  // tweb :1093.
  setTransition({ element: chip, className: 'is-chosen', forwards: chosen, duration: chip.isConnected ? 300 : 0 })
}

/** Один чип — порт `ReactionElement` (reaction.ts:739-1032). */
function createReaction(
  count: ReactionCount,
  reactions: MessageReactions,
  canRenderAvatars: boolean,
  options?: ReactionsElementOptions,
): ReactionChip {
  const chip = document.createElement('div') as ReactionChip
  // tweb reaction.ts:757-758 (`init`): к общему `reaction` идут класс раскладки
  // и `reaction-like-block` — общий для block и tag. Второй несёт высоту
  // пилюли, её внешние отступы, `position: relative` под подложку и саму
  // переменную `--chosen-background-color` (`_reaction.scss:219-230`).
  chip.classList.add('reaction', 'reaction-block', 'reaction-like-block')
  // МОЯ реакция (`chosen_order` у оригинала) — см. `setIsChosen`.
  setIsChosen(chip, isChosen(count))
  chip.dataset.reaction = reactionKey(count.reaction)
  // Своя версия счётчика на самом узле. У tweb её носит поле
  // `reactionElement.reactionCount` (reaction.ts:722), но там чип ПЕРЕЖИВАЕТ
  // обновление, а у нас узел собирается заново — значит, прошлое значение может
  // жить только в прошлом узле (см. `previous` в опциях).
  chip.dataset.count = String(count.count)

  // tweb :784-787.
  const sticker = document.createElement('div')
  sticker.classList.add('reaction-sticker')
  chip.append(sticker)

  if (options) {
    renderIcon(chip, sticker, count.reaction, options)
    renderAvatars(chip, recentOf(reactions, count.reaction), count, canRenderAvatars, options)
  } else {
    // Каталога нет вовсе — рисовать нечем, кроме самого значения реакции.
    sticker.textContent = reactionEmoticon(count.reaction)
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
 *  • Ветка «эффект ещё не скачан» (:1484-1519). Оригинал заходит в неё, когда
 *    ХОТЬ ОДИН из файлов `around_animation`/`center_icon` ещё не в кэше
 *    (:1484-1487), и вместо каталожного эффекта играет ГЕНЕРИК: случайную
 *    анимацию из набора `inputStickerSetEmojiGenericAnimations`
 *    (`appReactionsManager.ts:983`), у которой покадровый рендер подменён
 *    (`overrideRender`, :1362-1436) — вместо своего кадра она рисует КОПИИ
 *    иконки реакции по позициям слоёв `placeholder_*` ассета `ReactionGeneric`
 *    (:229-248). Каталожные файлы при этом всё равно докачиваются (:1495), и
 *    следующий клик играет уже настоящий эффект.
 *    Не портировано. Раньше здесь стояла другая причина — «`assets/tgs/*` мы
 *    не раздаём»; программа «один движок lottie» (Этап 0,
 *    `docs/superpowers/plans/2026-09-05-lottie-single-engine.md`) её сняла:
 *    статика раздаётся, `lottieLoader.makeAssetUrl` резолвится реально. Сам
 *    `ReactionGeneric.json` при этом в `public/assets/tgs/` не лежит — Этап 0
 *    перенёс только 11 файлов, которые код реально вызывал на тот момент, и
 *    это тривиально дозаливается из tweb (`public/assets/tgs/ReactionGeneric.json`)
 *    — не блокер.
 *    Настоящий блокер — второй источник генерика, сам набор generic-
 *    анимаций: маршрут по короткому имени у бэка ЕСТЬ (`GET /sticker-sets/
 *    {slug}` → `StickersHandler.SetBySlug`, аналог `inputStickerSetShortName`
 *    оригинала), но набора `inputStickerSetEmojiGenericAnimations` в каталоге
 *    нет — `backend/assets/stickers/` содержит только `animated_emoji` и
 *    `duck`. Завести его — не «малая правка» (нужен сам стикерсет с ассетами,
 *    не просто маршрут), это бэкенд-работа за периметром фронтового Этапа 5.
 *    При этом наше поведение — не самодеятельность, а ветка того же оригинала:
 *    :1512-1514, «генерика взять негде» → играть каталожный эффект поздно,
 *    когда файлы догрузятся. Загрузку мы начинаем тем же кликом (ниже),
 *    то есть делаем и `warmUpDownload` оригинала (:1495).
 *  • Ветка платной ⭐-реакции (:1523-1528, ассеты `StarReactionEffect*`) и ветка
 *    кастом-эмодзи (:1529) — своих подсистем нет.
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

  // tweb :1476 `apiManagerProxy.getReaction(emoticon)`.
  const lookup = getAvailableReaction(managers, reaction.emoticon)
  if (!lookup) return

  const stickerContainer = chip.querySelector<HTMLElement>('.reaction-sticker')
  if (!stickerContainer) return

  const size = REACTIONS_SIZE_BLOCK + AROUND_ADD

  const promise = lookup.then((availableReaction) => {
    if (!middleware()) return
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

        // tweb :1446-1456: оверлей снимается на последнем кадре иконки эффекта,
        // но если иконка САМОГО ЧИПА ещё показывается (`wrapStickerPromise`) —
        // сначала дать ей доиграть кроссфейд, иначе под оверлеем окажется
        // пустое место.
        iconPlayer.addEventListener('enterFrame', (frameNo) => {
          if (frameNo !== iconPlayer.maxFrame) return
          if (chip.wrapStickerPromise) {
            void chip.wrapStickerPromise.then(() => { setTimeout(removeOnFrame, 1e3) })
          } else {
            removeOnFrame()
          }
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
 * Без `options` спросить нечего и некому: чипы рисуются текстовым эмодзи, без
 * иконки каталога, без аватарок и без эффекта. По счётчику это ровно ветка
 * оригинала `canRenderAvatars === false` (число тогда показывается всегда,
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

  // tweb reactions.ts:304-307 — условие ЦЕЛИКОМ. Аватарки вместо числа
  // показываются там, где видно, КТО поставил реакцию, — и это ТОТ ЖЕ вопрос,
  // которым гейтится сам запрос списка (`canViewReactionsList`,
  // `core/reactions/messageReactions.ts`): ответ у него один на клиента, иначе
  // копия, забывшая личку, молча отключила бы аватарки в личных чатах.
  //
  // `!!options` — не терм оригинала, а наша граница: без каталога, зоны
  // актуальности и менеджеров аватарку рисовать нечем (см. `renderAvatars`).
  const canRenderAvatars = !!options &&
    canViewReactionsList(reactions, options.peerId) &&
    totalReactions(reactions) < REACTIONS_DISPLAY_COUNTER_AT

  const container = document.createElement('div')
  container.classList.add('reactions', 'reactions-block', 'reactions-like-block')

  const chips = results.map((count, idx, arr) => {
    const chip = createReaction(count, reactions!, canRenderAvatars, options)
    // tweb reactions.ts:319 — последний чип ряда без внешнего отступа справа
    // (`_reaction.scss:227-229`), иначе ряд шире своего содержимого.
    chip.classList.toggle('is-last', idx === arr.length - 1)
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

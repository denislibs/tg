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
import type { MessageReactions, MyMessage, Reaction, ReactionCount } from '@core/models'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { ChannelFull, ChatReactions } from '@core/peers/peer'
import { isUser } from '@core/peers/peerId'
import { beginPeerFullFetch, cachedPeerFull, saveChatFull } from '@core/chatFullCache'
import { canViewReactionsList, isChosen, reactionKey, recentOf, totalReactions } from '@core/reactions/messageReactions'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import { setTransition } from '@core/dom/setTransition'
import formatNumber from '@helpers/number/formatNumber'
import StackedAvatars from '@components/stackedAvatars'
import type { AvatarManagers } from '@components/avatar'
import wrapSticker from '@components/wrappers/sticker'
import wrapStickerAnimation from '@components/wrappers/stickerAnimation'
import { hasStickerContent, loadStickerContent } from '@components/wrappers/stickerContent'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import liteMode from '@helpers/liteMode'
import type { Middleware } from '@helpers/middleware'
import { positionElementByIndex } from './bubbleGroups'
import { fastRaf } from '@helpers/schedulers'
import pause from '@helpers/schedulers/pause'
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
  /** tweb `this.counter` (reaction.ts:1030-1055) — узел числа переживает
   *  обновление, поэтому им владеет чип, а не поиск по селектору. */
  counter?: HTMLElement
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

/** Походы за карточкой, которые ещё летят, — порт дедупликации
 *  `invokeApiSingleProcess` (appProfileManager.ts:643): у оригинала два
 *  одновременных `getChannelFull` одного чата дают ОДИН запрос. Спрашивает
 *  карточку каждый бабл под курсором (`bubbles.ts::onBubblesMouseMove`), и без
 *  этого проход курсором по ленте стоил бы по запросу на бабл. */
const chatFullFetches = new Map<PeerId, Promise<ChannelFull | undefined>>()

/**
 * Полная карточка чата: сперва зеркало главного потока (`core/chatFullCache.ts`
 * — его наполняет колонка чата), иначе поход в сеть. Ровно развилка
 * `appProfileManager.getChatFull` у оригинала (appReactionsManager.ts:226):
 * там она тоже отдаёт кэш синхронно и ходит в сеть только на промах.
 *
 * Удачный ответ КЛАДЁТСЯ В ЗЕРКАЛО — это тоже оригинал: `getChannelFull` отдаёт
 * ответ через `saveFullPeerResult` (appProfileManager.ts:643-648), а тот пишет
 * `chatsFull[id]` (:217), поэтому промах бывает один раз на чат. Без записи
 * зеркало не прогревалось вовсе там, где его не наполняет колонка чата, — в
 * треде комментариев карточку не грузит никто (`components/Chat.tsx:348`
 * гейтит `useChatInfoCard` термом `!thread`).
 *
 * Билет `beginPeerFullFetch`/`saveChatFull` — уже существующая защита зеркала
 * от устаревшего ответа (`core/chatFullCache.ts`), второй такой здесь не
 * заводим. Личный диалог сюда не доходит (его ветка выше по стеку), а это
 * важно: на пользователя `card()` отвечает пустой `channelFull`, и писать её в
 * зеркало нельзя — от того же затирания гейтится `useChatInfoCard.ts:151-157`.
 * TTL-отметку (`markFullPeerFetched`) не ставим: лежащая карточка без срока и
 * так считается свежей (`stores/fullPeers.solid.ts::isFullPeerFresh`), а
 * расписание протухания — дело владельца свежести, а не панели реакций.
 */
async function getChatFull(
  peerId: PeerId,
  managers: ReactionsCatalogManagers,
): Promise<ChannelFull | undefined> {
  const cached = cachedPeerFull(peerId)
  if (cached) return cached as ChannelFull

  const groups = managers.groups
  if (!groups) return undefined

  let pending = chatFullFetches.get(peerId)
  if (!pending) {
    const ticket = beginPeerFullFetch(peerId)
    const fetching = groups.card(peerId).then((card) => {
      const fullChat = card?.fullChat
      if (fullChat) saveChatFull(peerId, fullChat, ticket)
      return fullChat
    }, () => undefined)
    chatFullFetches.set(peerId, fetching)
    // Провалившийся поход из карты выбрасывается, чтобы следующий спрашивающий
    // попробовал заново, — тот же приём, что у `catalogCache` выше.
    void fetching.then(() => {
      if (chatFullFetches.get(peerId) === fetching) chatFullFetches.delete(peerId)
    })
    pending = fetching
  }

  return pending
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
 *      `chatReactionsAll` → весь активный каталог, но НЕ одноимённой веткой
 *        (:250-251 отдаёт ТОП-реакции) — переписыванием :240-247, см. ниже.
 *
 * ─── Расхождения ───────────────────────────────────────────────────────────
 *  • Переписывание `chatReactionsAll` (без `allow_custom`) в `chatReactionsSome`
 *    с флагом `trulyAll` (:240-247) не портировано. Ветки при этом НЕ равны: после
 *    переписывания под `chatReactionsAll` остаётся только политика С
 *    `allow_custom`, и она отдаёт ТОП-реакции (:250-251), а весь активный каталог
 *    отдаёт как раз переписанная ветка (:252-261). Наш `all()` сходится с
 *    оригиналом не по свойству алгоритма, а по свойству бэкенда: `allow_custom` он
 *    не выставляет никогда — единственный конструктор этого значения зовётся с
 *    `false` (`backend/internal/domain/rights.go:74`), так что ветка топ-реакций
 *    недостижима. Появится `allow_custom` на бэке — портировать придётся и
 *    переписывание, и топ-реакции. Читателя `trulyAll` (вкладки кастом-эмодзи в
 *    полном пикере) у нас нет: кастом-эмодзи-реакций нет по всей вертикали.
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

/** Ручки реакции у владельца сообщений — та же пара, что объявляют своими
 *  порт-интерфейсами лента и контекстное меню. Необязательны: без них путь
 *  реакции не существует вовсе. */
export interface ReactionSender {
  react?(peerId: number, msgId: number, emoji: string): Promise<void>
  unreact?(peerId: number, msgId: number, emoji: string): Promise<void>
}

/**
 * Отправка реакции — ЕДИНСТВЕННОЕ место, где решается направление тоггла, для
 * всех трёх входов: панель контекстного меню, ховер-кнопка над баблом и клик по
 * чипу. У оригинала это тоже один путь: все три зовут `chat.sendReaction`
 * (chat.ts:1457 ← contextMenu.ts:1686, bubbles.ts:2820, bubbles.ts:3275), а
 * решает `appReactionsManager.sendReaction` (:647-966).
 *
 * Состояние читается НЕПОСРЕДСТВЕННО ПЕРЕД ОТПРАВКОЙ — `getMessage(mid)`. Ровно
 * этим страхуется оригинал: `message = getMessageByPeer(message.peerId,
 * message.mid)` (appReactionsManager.ts:669) перечитывает сообщение, потому что
 * объект на руках у вызывающего уже мог устареть — меню собралось раньше клика,
 * ховер-кнопка появилась раньше на паузу в 400 мс. Тоггл — тоже оригинал: своя
 * реакция повторным выбором СНИМАЕТСЯ (:733-737).
 *
 * ЛИМИТ своих реакций (:738 — вытеснение самой старой) здесь НЕ решается: он
 * живёт у владельца SSOT, `core/managers/messages/reactionMethods.ts::react`,
 * потому что зависит и от уже применённого состояния, и от подписки
 * (`getLimit('reactions', isPremium)`, apiManagerMethods.ts:369-395) — а тоггл
 * обходится одним лишь чипом, по которому кликнули.
 *
 * Платная ⭐-реакция пропускается: адресовать её нашим ручкам нечем (подсистемы
 * нет — тот же вычет по всему файлу).
 */
export function sendReaction(options: {
  peerId: PeerId
  /** Номер сообщения, которому принадлежит реакция; у альбома это ПЕРВОЕ
   *  сообщение группы (tweb `getGroupsFirstMessage`) — его выбирает вызывающий. */
  mid: number
  reaction: Reaction
  messages: ReactionSender
  /** Перечитать сообщение из окна владельца — зеркала, из которого рисуются
   *  и сами чипы (`is-chosen`). */
  getMessage: (mid: number) => MyMessage | undefined
}): void {
  const { react, unreact } = options.messages
  if (!react || !unreact) return
  if (options.reaction._ !== 'reactionEmoji') return

  const emoticon = options.reaction.emoticon
  const message = options.getMessage(options.mid)
  const count = message?.reactions?.results.find((c) => {
    return c.reaction._ === 'reactionEmoji' && c.reaction.emoticon === emoticon
  })

  const promise = count && isChosen(count) ?
    unreact(options.peerId, options.mid, emoticon) :
    react(options.peerId, options.mid, emoticon)
  promise.catch(noop)
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
 *
 * ИДЕМПОТЕНТЕН, как и оригинал: узел числа создаётся один раз (:1031-1034),
 * дальше переписывается его текст (:1043-1045), а когда число больше не нужно
 * — снимается (:1053-1056). Чип у нас теперь переживает обновление, и второй
 * вызов обязан застать ровно один счётчик, а не дописать второй.
 */
function renderCounter(chip: ReactionChip, count: ReactionCount, canRenderAvatars: boolean): void {
  // tweb :1029 (инвертировано) + :1053-1056.
  if (count.count < REACTIONS_DISPLAY_COUNTER_AT && canRenderAvatars) {
    chip.counter?.remove()
    chip.counter = undefined
    return
  }

  // tweb :1031-1034.
  let counter = chip.counter
  if (!counter) {
    counter = chip.counter = document.createElement('span')
    counter.classList.add('reaction-counter')
  }

  // tweb :1042-1045 — текст переписывается только если он изменился.
  const formatted = formatNumber(count.count)
  if (counter.textContent !== formatted) counter.textContent = formatted

  // tweb :1047-1049.
  if (!counter.parentElement) chip.append(counter)
}

/**
 * Порт `ReactionElement.renderAvatars` (reaction.ts:1060-1084): аватарки вместо
 * числа, пока реакций этого чипа меньше порога и список видно.
 *
 * ИДЕМПОТЕНТЕН, как и оригинал: стек создаётся один раз (:1075-1082), дальше
 * ему отдаётся новый список (:1083, сам `StackedAvatars.render` переиспользует
 * узлы), а когда аватарки больше не показываются — стек снимается (:1066-1071).
 */
function renderAvatars(
  chip: ReactionChip,
  recent: PeerId[],
  count: ReactionCount,
  canRenderAvatars: boolean,
  options: ReactionsElementOptions,
): void {
  // tweb :1065-1072.
  if (count.count >= REACTIONS_DISPLAY_COUNTER_AT || !canRenderAvatars || !recent.length) {
    chip.stackedAvatars?.destroy()
    chip.stackedAvatars = undefined
    return
  }

  // tweb :1074-1082.
  if (!chip.stackedAvatars) {
    chip.stackedAvatars = new StackedAvatars({
      avatarSize: AVATAR_SIZE,
      middleware: options.middleware,
      managers: options.managers,
    })
    chip.append(chip.stackedAvatars.container)
  }

  // tweb :1083.
  void chip.stackedAvatars.render(recent)
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
      // Ставится класс ради двух правил иконки чипа — у оригинала они оба висят
      // на `media-sticker`: гашение на время эффекта (`_reaction.scss:41-45`) и
      // размер `is-regular` (:47-56). У tweb медиа иконки ВСЕГДА растровое
      // `img.media-sticker` (`static: true`, reaction.ts:894 →
      // `wrappers/sticker.ts:521-522`), у нас растра нет (задача #47) и приезжает
      // `canvas.lottie` — класс ставим сами, иначе оба правила до нашего узла не
      // достают: на время around-эффекта базовая иконка оставалась бы видна ПОД
      // оверлеем, а превью прошлого показа (`stickerAppearance` кладёт его с тем
      // же классом) разошлось бы с канвасом в размере.
      //
      // Класс тянет и ТРЕТЬЕ правило, к иконке чипа отношения не имеющее:
      // растяжение по контейнеру `_bridge.scss:597-607` (порт tweb
      // base.scss:1282-1296; по порядку сборки его перекрывает расширенная копия
      // `index.scss:248-257` — порт base.scss:1300-1307). Оно ничего не меняет:
      // ровно то же канвас уже имеет от СВОЕГО класса `.lottie`
      // (`index.scss:234-241`). У `is-regular` растяжение всё равно снимает
      // `_reaction.scss:47-56` (`inset: auto` и размер с `!important`), а у
      // `is-static` растягивать нечего — канвас запрошен размером контейнера
      // (`REACTIONS_SIZE_BLOCK` = `--reaction-size`).
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
 * Ветка «300» достижима с тех пор, как ряд стал ПЕРЕИСПОЛЬЗОВАТЬ чипы
 * (`renderReactionsElement`): второй вызов застаёт узел подключённым — ровно
 * как у оригинала, где `this.sorted.find(...)` (reactions.ts:290-296) отдаёт
 * прежний `ReactionElement`.
 */
function setIsChosen(chip: HTMLElement, chosen: boolean): void {
  // tweb :1088-1089.
  const wasChosen = chip.classList.contains('is-chosen') && !chip.classList.contains('backwards')
  if (wasChosen === chosen) return

  // tweb :1093.
  setTransition({ element: chip, className: 'is-chosen', forwards: chosen, duration: chip.isConnected ? 300 : 0 })
}

/**
 * СОЗДАНИЕ чипа — то, что у оригинала делается один раз на весь срок жизни
 * `ReactionElement`: конструктор + `init` (reaction.ts:753-760) + `render`
 * (:782-796, где `hadStickerContainer` даёт ранний выход на повторном вызове).
 * Всё, что меняется от обновления к обновлению, живёт в `updateReaction`.
 */
function createReaction(
  count: ReactionCount,
  options?: ReactionsElementOptions,
): ReactionChip {
  const chip = document.createElement('div') as ReactionChip
  // tweb reaction.ts:757-758 (`init`): к общему `reaction` идут класс раскладки
  // и `reaction-like-block` — общий для block и tag. Второй несёт высоту
  // пилюли, её внешние отступы, `position: relative` под подложку и саму
  // переменную `--chosen-background-color` (`_reaction.scss:219-230`).
  chip.classList.add('reaction', 'reaction-block', 'reaction-like-block')
  chip.dataset.reaction = reactionKey(count.reaction)

  // tweb :784-787.
  const sticker = document.createElement('div')
  sticker.classList.add('reaction-sticker')
  chip.append(sticker)

  if (options) {
    renderIcon(chip, sticker, count.reaction, options)
  } else {
    // Каталога нет вовсе — рисовать нечем, кроме самого значения реакции.
    sticker.textContent = reactionEmoticon(count.reaction)
  }

  return chip
}

/**
 * ОБНОВЛЕНИЕ чипа — порт тела цикла `ReactionsElement.render`
 * (reactions.ts:310-346): своя версия счётчика, `setIsChosen`, `renderCounter`,
 * `renderAvatars`. Зовётся и сразу после создания, и на каждом следующем
 * обновлении сообщения — у оригинала ровно так же, там развилки «первый раз /
 * не первый» нет вовсе.
 */
function updateReaction(
  chip: ReactionChip,
  count: ReactionCount,
  reactions: MessageReactions,
  canRenderAvatars: boolean,
  options?: ReactionsElementOptions,
): void {
  // Своя версия счётчика на самом узле — она же прошлая версия для
  // `getChangedResults`. У tweb её носит поле `reactionElement.reactionCount`
  // (reaction.ts:722); у нас узлом владеет вызывающий, поэтому значение живёт
  // на узле.
  chip.dataset.count = String(count.count)
  // МОЯ реакция (`chosen_order` у оригинала) — см. `setIsChosen`.
  setIsChosen(chip, isChosen(count))
  renderCounter(chip, count, canRenderAvatars)
  if (options) {
    renderAvatars(chip, recentOf(reactions, count.reaction), count, canRenderAvatars, options)
  }
}

/**
 * Порт `AppMessagesManager.batchUpdateReactions` (appMessagesManager.ts:10651-10677)
 * — какие чипы «выросли» и потому обязаны отыграть эффект: у ИСХОДЯЩЕГО
 * сообщения любая подросшая реакция (кто-то отреагировал мне), у любого — та,
 * которую я только что поставил сам.
 *
 * Предыдущая версия читается с самих чипов ДО их обновления: `data-reaction` +
 * `data-count` + класс `is-chosen` — это ровно те три факта, которыми
 * пользуется правило оригинала (`reactionsEqual`, `count`,
 * `chosen_order !== undefined`). У tweb сравнивать не с чем: там `changedResults`
 * считает ВЛАДЕЛЕЦ сообщения (appMessagesManager.ts:10651-10677 — у него на
 * руках обе версии агрегата) и приносит их событием `messages_reactions`; у нас
 * событие другое — `message_edit` несёт только НОВУЮ версию, поэтому прошлая
 * берётся оттуда, где она ещё жива, — с ряда, который мы вот-вот обновим.
 */
function snapshotPrevious(container: HTMLElement | null | undefined): Map<string, { count: number, chosen: boolean }> {
  const prev = new Map<string, { count: number, chosen: boolean }>()
  container?.querySelectorAll<HTMLElement>(':scope > .reaction[data-reaction]').forEach((chip) => {
    prev.set(chip.dataset.reaction!, {
      count: Number(chip.dataset.count),
      chosen: chip.classList.contains('is-chosen'),
    })
  })
  return prev
}

function getChangedResults(
  results: ReactionCount[],
  prev: Map<string, { count: number, chosen: boolean }>,
  isOut: boolean,
): ReactionCount[] {
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
 * Потолок ожидания первого кадра — порт `LottieLoader.waitForFirstFrame`
 * (tweb lottieLoader.ts:206-222): там ожидание кадра стоит В ГОНКЕ с
 * `pause(2500)`, то есть ни один ждущий кадра путь оригинала не может ждать
 * дольше. У нас этого потолка не было нигде, и эффект реакции ждал декода
 * ДВУХ lottie в очереди воркера, общей с лентой: под нагрузкой очередь
 * произвольно длинная, и эффект стартовал через сотни миллисекунд после
 * клика — либо не стартовал вовсе, а гейт `chip.hasAroundAnimation` при этом
 * не снимался и следующий клик тоже оставался без эффекта.
 *
 * РАСХОЖДЕНИЕ, названное прямым текстом: у нас под этот же потолок попадает и
 * ЗАПРОС ЗА ОПИСАНИЕМ РЕАКЦИИ — `getAvailableReaction` (сетевой `list()` через
 * `catalogCache`), которого у оригинала под потолком нет: там каталог читается
 * СИНХРОННО из зеркала (`apiManagerProxy.getReaction(emoticon)`,
 * reaction.ts:1476, отдаёт уже загруженный `AvailableReaction`), а потолок
 * накрывает только ожидание первого кадра. То есть наши 2500 мс делятся между
 * двумя ожиданиями, а у оригинала целиком уходят на второе. Сойдётся, когда
 * каталог реакций переедет в синхронное зеркало воркера, как у оригинала;
 * до тех пор потолок консервативнее оригинального, но не мягче — а именно
 * этого от него и требуется.
 */
const AROUND_FIRST_FRAME_TIMEOUT = 2500

/**
 * Прогревочные загрузки идут ПОСЛЕДОВАТЕЛЬНО — порт `warmUpChain`
 * (tweb reaction.ts:254-265) вместе с его причиной: тяжёлые файлы эффектов не
 * должны голодать интерактивные загрузки (иконку чипа, медиа полёта).
 *
 * Что «скачать заранее» — `loadStickerContent` (`wrappers/stickerContent.ts`),
 * тот же вход, которым потом пойдёт `wrapSticker`: у него на файл один
 * модульный кэш, поэтому прогретый файл клик уже не качает. Синхронная
 * проверка «уже скачан» — `hasStickerContent`, наш `cacheContext.downloaded`
 * оригинала (reaction.ts:257-260).
 */
let warmUpChain: Promise<unknown> = Promise.resolve()

/** tweb reaction.ts:256-265 (`warmUpDownload`). */
function warmUpDownload(mediaId: number | undefined): void {
  if (!mediaId || hasStickerContent(mediaId)) return
  warmUpChain = warmUpChain.then(() => loadStickerContent(mediaId)).catch(noop)
}

/**
 * Прогреть эффект постановки, пока пользователь только целится в реакцию —
 * порт `warmUpReactionEffect` (tweb reaction.ts:268-278). Зовёт его каждая
 * ячейка панели быстрых реакций (`chat/reactionsMenu.ts`, порт
 * reactionsMenu.ts:517-520): к моменту клика оба файла эффекта уже скачаны, и
 * ожидание клика сводится к декоду.
 */
export function warmUpReactionEffect(availableReaction: AvailableReaction | undefined): void {
  if (!availableReaction || !liteMode.isAvailable('effects_reactions')) return

  // tweb :274-277 — ровно два файла: полёт и центральная иконка.
  warmUpDownload(availableReaction.aroundMediaId)
  warmUpDownload(availableReaction.centerMediaId)
}

/** tweb appReactionsManager.ts:104 — прогреваются ПЕРВЫЕ СЕМЬ реакций каталога. */
const PRELOAD_REACTIONS_COUNT = 7

/** tweb appReactionsManager.ts:112 — пауза между реакциями. */
const PRELOAD_REACTION_PAUSE = 1000

/** Каталоги, для которых предзагрузка уже отработала. Ключ — сам объект-каталог,
 *  как у `catalogCache`: у оригинала подписка на `user_auth` срабатывает раз на
 *  вход, у нас точка входа — эффект React, переигрываемый на каждом монтировании
 *  Shell.
 *
 *  Пометка снимается, если каталог не приехал: `catalogCache` выбрасывает
 *  упавший запрос (:146-148) и остальное приложение список перезапросит —
 *  значит и предзагрузка обязана уметь зайти второй раз. Иначе единственный
 *  сетевой отказ на 7.5-й секунде выключал бы её на всю жизнь страницы. */
const preloadedCatalogs = new WeakSet<object>()

/**
 * Фоновая предзагрузка ассетов первых семи реакций каталога — порт
 * `AppReactionsManager.after` (tweb appReactionsManager.ts:88-115): по четыре
 * файла на реакцию (`around_animation`, `static_icon`, `appear_animation`,
 * `center_icon`), последовательно по реакциям, с паузой в секунду между ними.
 * Оригинал ставит это на `user_auth` + 7.5 с; у нас точка та же по смыслу —
 * вход в Shell (`core/hooks/useAppBootstrap.ts`), с той же задержкой.
 *
 * `select_animation` в списке оригинала нет — его качает сама панель, когда
 * открывается.
 *
 * РАСХОЖДЕНИЕ ПО ЦЕНЕ, названо долгом: у оригинала прогрев — это
 * `downloadMediaURL` в шаред-воркере, он держит БАЙТЫ (`Blob` + objectURL,
 * apiFileManager.ts:1029-1045), а gunzip и разбор делает lottie-воркер в
 * момент показа. Наш `loadStickerContent` кэширует РАЗОБРАННЫЙ lottie-JSON в
 * модульной карте без вытеснения и разбирает его на главном потоке: 28 файлов
 * семи реакций — 430 КБ на проводе, 3.3 МБ текста после gunzip. Правится не
 * здесь: это контракт общего кэша стикеров, на котором стоит вся лента.
 * Долг с замерами и планом — `backlogs/frontend/sticker-content-cache-holds-parsed-json.md`.
 */
export async function preloadReactionAssets(managers: ReactionsCatalogManagers): Promise<void> {
  const catalog = managers.reactions
  if (!catalog || preloadedCatalogs.has(catalog)) return
  preloadedCatalogs.add(catalog)

  let available: AvailableReaction[]
  try {
    available = await getAvailableReactions(managers)!
  } catch {
    // Каталог не приехал — снять пометку, чтобы следующий вход в Shell зашёл
    // заново (см. комментарий у `preloadedCatalogs`). У оригинала этой ветки
    // нет: там `getAvailableReactions` читается из зеркала воркера, которое
    // держит свой retry.
    preloadedCatalogs.delete(catalog)
    return
  }

  // tweb :104-113.
  for (let i = 0, length = Math.min(PRELOAD_REACTIONS_COUNT, available.length); i < length; ++i) {
    const availableReaction = available[i]
    await Promise.all([
      availableReaction.aroundMediaId,
      availableReaction.staticMediaId,
      availableReaction.appearMediaId,
      availableReaction.centerMediaId,
    ].map((mediaId) => mediaId && loadStickerContent(mediaId).catch(noop)))
    await pause(PRELOAD_REACTION_PAUSE)
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
 *    когда файлы догрузятся. Отдельного `warmUpDownload` (:1495) в этой ветке
 *    у нас НЕТ и быть не может: у оригинала он нужен, потому что кадры рисует
 *    генерик, а каталожные файлы никто не запрашивает; мы же играем сам
 *    каталожный эффект, и его файлы тем же тиком качают `wrapSticker` и
 *    `wrapStickerAnimation` — через тот же модульный кэш
 *    (`wrappers/stickerContent.ts`), которым пользуется и прогрев. Вернуть
 *    `warmUpDownload` сюда придётся вместе с генериком — это записано в долг
 *    (`backlogs/frontend/reaction-generic-effect.md`). «Поздно» при этом
 *    ограничено потолком `AROUND_FIRST_FRAME_TIMEOUT`: не успел к сроку —
 *    эффект честно не играет, вместо того чтобы выстрелить через секунды
 *    после клика и держать гейт чипа.
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

  // Зона бабла уже мертва — `create()` на убранной зоне бросает MIDDLEWARE
  // (`helpers/middleware.ts`), а играть эффект в снятом бабле и незачем.
  if (!middleware()) return

  const size = REACTIONS_SIZE_BLOCK + AROUND_ADD

  // Своя зона актуальности эффекта — ребёнок зоны бабла. У оригинала её нет
  // (там всюду `options.middleware`), и она заведена ровно под потолок: снять
  // недоехавшие плееры может только тот, кто их создал, а `lottieLoader`
  // убирает плеер по `middleware.onClean` (lottieLoader.ts:285-287). Смерть
  // бабла по-прежнему убивает эффект — уборка вложенных зон каскадная
  // (`helpers/middleware.ts::clean`).
  const helper = middleware.create()
  const effectMiddleware = helper.get()

  // tweb lottieLoader.ts:206-222: ожидание первого кадра стоит В ГОНКЕ с
  // `pause(2500)`. Гонка нужна дважды: снять эффект, который к этому сроку не
  // показал ни кадра (иначе он либо не покажется никогда, либо выстрелит
  // спустя секунды — уже не про этот клик), и отпустить гейт
  // `chip.hasAroundAnimation`, чтобы следующий клик не оставался без эффекта.
  const ceiling = pause(AROUND_FIRST_FRAME_TIMEOUT)
  let started = false
  void ceiling.then(() => { if (!started) helper.destroy() })

  const promise = lookup.then((availableReaction) => {
    if (!effectMiddleware()) return
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
      middleware: effectMiddleware,
      scrollable: options.scrollable,
    })

    // Узлы, которые до старта эффекта не снимает никто: оверлей ещё не
    // подвешен, а `wrapStickerAnimation` убирает свой полёт только вместе с
    // плеером (`unmountAnimation`), то есть не раньше, чем плеер приедет.
    // Потолок обязан убрать оба — иначе отменённый эффект оставлял бы в
    // общем контейнере пустой квадрат.
    effectMiddleware.onDestroy(() => {
      div.remove()
      aroundWrap.animationDiv.remove()
      stickerContainer.classList.remove('has-animation')
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
      middleware: effectMiddleware,
    }).render

    // tweb :1259-1270. `ceiling` в гонке — тот же приём, что у оригинала в
    // `waitForFirstFrame` (lottieLoader.ts:213-219): ждать декода обоих файлов
    // можно, но не дольше срока.
    return Promise.race([
      Promise.all([iconRender, aroundWrap.stickerPromise, options.waitPromise]),
      ceiling.then(() => undefined),
    ])
      .then((players) => {
        // Потолок выиграл гонку — плееры уже сняты вместе с зоной (`ceiling`
        // выше), показывать нечего.
        if (!players) return
        const [icon, aroundPlayer] = players
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
        effectMiddleware.onDestroy(removeOnFrame)

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
          // Кадр показан — эффект состоялся, и потолок его уже не снимает
          // (у оригинала гонка `waitForFirstFrame` кончается ровно здесь же,
          // lottieLoader.ts:213-216).
          started = true
          stickerContainer.append(div)
          stickerContainer.classList.add('has-animation')
          iconPlayer.play()
          aroundPlayer.play()
        })
      })
  })

  // tweb :1531-1537. Гейт снимается и по потолку: `promise` — гонка с
  // `ceiling`, поэтому висеть дольше срока он не может даже на застрявшем
  // декоде.
  // Обе точки снятия гейта — с проверкой идентичности. У оригинала она стоит
  // только в `finally` (:1542-1546), а `onDestroy` (:1537-1539) гасит поле
  // безусловно, и это у него безопасно: `options.middleware` там ОДНА на чип,
  // общая для всех его эффектов, поэтому её уборка не может застать чужой,
  // более свежий гейт. У нас зона эффекта СВОЯ на каждый запуск (`helper`
  // выше — она заведена под потолок), и «безусловно» держалось бы только на
  // порядке уборки. Поэтому здесь тот же приём, что в `finally`, а не копия
  // оригинальной асимметрии.
  const gate = Promise.race([promise, ceiling])
  const release = () => { if (chip.hasAroundAnimation === gate) chip.hasAroundAnimation = undefined }
  effectMiddleware.onDestroy(release)
  chip.hasAroundAnimation = gate
  gate.finally(release).catch(noop)
}

/**
 * Ряд реакций сообщения — порт `ReactionsElement.render`
 * (tweb reactions.ts:259-360) вместе с его ГЛАВНЫМ свойством: ряд и его чипы
 * ПЕРЕЖИВАЮТ обновление сообщения. Оригинал снимает только те чипы, чьей
 * реакции больше нет (:290-299), остальные находит по значению реакции
 * (:311-317), обновляет на месте и переставляет `positionElementByIndex`
 * (:358-360).
 *
 * Почему это не косметика. Эффект постановки реакции (`fireAroundAnimation`)
 * держится за ЖИВОЙ узел `.reaction-sticker`: оверлей `div.reaction-sticker-activate`
 * лежит внутри него, а летящая around-анимация снимает себя сама, как только
 * её цель ушла из документа (`wrappers/stickerAnimation.ts`, порт tweb
 * stickerAnimation.ts:126,154 — `!isInDOM(target)`). Пока ряд пересобирался
 * заново, ответ сервера на мой же клик (второй `message_edit` через ~300 мс
 * после оптимистичного) выбрасывал чип вместе с играющим эффектом — эффект
 * обрывался через десятки миллисекунд после старта. Замер на стенде:
 * старт эффекта +221 мс от клика, снос ряда +305 мс, эффект жил 86 мс вместо
 * ~1470 мс.
 *
 * `existing` — ряд ЭТОГО ЖЕ бабла прошлого поколения (`null`/отсутствует, если
 * реакций не было вовсе). Возвращается он же, обновлённый, либо новый узел,
 * либо `undefined` — реакций не осталось, и узла быть не должно: пустой ряд
 * занял бы строку под баблом (тот же гейт у оригинала — bubbles.ts:9835-9837
 * `!reactions.results.length`). В последнем случае прошлый узел снимается
 * здесь же — его владелец больше ничего о нём не знает.
 *
 * Без `options` спросить нечего и некому: чипы рисуются текстовым эмодзи, без
 * иконки каталога, без аватарок и без эффекта. По счётчику это ровно ветка
 * оригинала `canRenderAvatars === false` (число тогда показывается всегда,
 * reaction.ts:1029).
 */
export function renderReactionsElement(
  existing: HTMLElement | null | undefined,
  reactions: MessageReactions | undefined,
  options?: ReactionsElementOptions,
): HTMLElement | undefined {
  const results = reactions?.results

  // Прошлая версия ряда нужна ДО того, как чипы обновятся: она и есть
  // «предыдущий агрегат» для `changedResults` (см. `snapshotPrevious`).
  const previous = snapshotPrevious(existing)

  if (!results?.length) {
    destroyChips(existing, () => true)
    existing?.remove()
    return undefined
  }

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

  let container = existing ?? undefined
  if (!container) {
    container = document.createElement('div')
    container.classList.add('reactions', 'reactions-block', 'reactions-like-block')
  }

  // tweb :290-299 — чипы, чьей реакции в новом агрегате нет, снимаются вместе
  // со своей зоной актуальности (там это `middlewareHelper.destroy()`, у нас
  // зону держит стек аватарок).
  const keys = new Set(results.map((count) => reactionKey(count.reaction)))
  const reusable = new Map<string, ReactionChip>()
  destroyChips(container, (chip) => {
    const key = chip.dataset.reaction
    if (key !== undefined && keys.has(key)) {
      reusable.set(key, chip)
      return false
    }
    return true
  })

  const chips = results.map((count, idx, arr) => {
    // tweb :311-317 — прежний чип этой же реакции, иначе новый.
    const chip = reusable.get(reactionKey(count.reaction)) ?? createReaction(count, options)
    updateReaction(chip, count, reactions!, canRenderAvatars, options)
    // tweb reactions.ts:319 — последний чип ряда без внешнего отступа справа
    // (`_reaction.scss:227-229`), иначе ряд шире своего содержимого.
    chip.classList.toggle('is-last', idx === arr.length - 1)
    // tweb :358-360 — порядок задаётся перестановкой, а не пересборкой.
    positionElementByIndex(chip, container!, idx)
    return { count, chip }
  })

  // tweb reactions.ts:419-428: эффект играется только у УЖЕ показанного бабла;
  // пока бабл собирается, «изменения» нет по построению — это первая сборка.
  if (options?.bubble.isConnected) {
    const changed = getChangedResults(results, previous, !!options.isOut)
    if (changed.length) {
      void handleChangedResults(
        chips.filter(({ count }) => changed.includes(count)),
        options,
      )
    }
  }

  return container
}

/** Снять чипы ряда по признаку, погасив их зоны актуальности (стек аватарок
 *  держит свою — `StackedAvatars.destroy`). Порт `forEachReverse` из
 *  tweb reactions.ts:290-299. */
function destroyChips(
  container: HTMLElement | null | undefined,
  shouldRemove: (chip: ReactionChip) => boolean,
): void {
  container?.querySelectorAll<ReactionChip>(':scope > .reaction').forEach((chip) => {
    if (!shouldRemove(chip)) return
    chip.stackedAvatars?.destroy()
    chip.remove()
  })
}

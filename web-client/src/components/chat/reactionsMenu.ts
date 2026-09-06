// Панель быстрых реакций — порт tweb `components/chat/reactionsMenu.ts`
// (`ChatReactionsMenu`). Её единственный носитель — контекстное меню сообщения
// (`chat/contextMenu.ts`, `appendReactionsMenu`), как и в оригинале.
//
// РАЗМЕТКА 1:1 (reactionsMenu.ts:106-176, 522-684; стили портированы целиком —
// `styles/tweb/_button.scss:649-935`):
//
//   div.btn-menu-reactions-container.btn-menu-reactions-container-horizontal
//       .btn-menu-transition[.is-visible]
//     ├ div.btn-menu-reactions-bubble.btn-menu-reactions-bubble-big   ← хвостик
//     └ div.btn-menu-reactions
//         └ div.btn-menu-reactions-reaction × ≤7
//             └ div.btn-menu-reactions-reaction-scale
//                 ├ div.btn-menu-reactions-reaction-appear
//                 └ div.btn-menu-reactions-reaction-select.hide
//
// `is-visible` вешается на КОНТЕЙНЕР ШИРИНЫ (reactionsMenu.ts:194-196) — его
// же читает CSS (`_button.scss:724-726`: `&:not(.is-visible) {opacity: 0}`).
//
// ─── Чего здесь нет и почему ───────────────────────────────────────────────
//  • КНОПКА «ЕЩЁ» (`-more`, reactionsMenu.ts:184-190) и весь полный пикер за
//    ней (`onMoreClick`, :384-493) — её показ выключается опцией САМОГО
//    оригинала `noMoreButton` (:70,88,99,184; так её гасит tweb в просмотрщике
//    историй, `stories/viewer.tsx:1098`). Показать кнопку без обработчика
//    нельзя, а обработчик недостижим: за ним `EmojiTab` + `EmoticonsDropdown`
//    (подсистем нет), топ/недавние реакции и кастом-эмодзи-реакции (нет на
//    бэке). Долг — `backlogs/frontend/reactions-more-button.md`.
//  • Теги «Избранного» (`isTags`), эффекты сообщений (`isEffects`), платная
//    ⭐-реакция (`reactionPaid`), кастом-эмодзи-реакции — свои подсистемы,
//    каждой из которых у нас нет (тот же вычет у `chat/reactions.ts`).
//  • `stashFlightSource` (:166-168) — форк-специфика tweb («полёт» реакции к
//    баблу), в оригинальном Telegram Web K её нет.
//  • `size`/`openSide`/`getOpenPosition` (:84-87) — первые два читает только
//    ветка кнопки «ещё» (иконка `down|up`) и просмотрщик историй, третий —
//    только полный пикер.
//
// ─── Адаптации ─────────────────────────────────────────────────────────────
//  • ЧТО ПОКАЗЫВАТЬ решает политика пира — порт
//    `getAvailableReactionsForPeer` (appReactionsManager.ts:205-277), он живёт
//    рядом с каталогом (`chat/reactions.ts`) и там же описаны его расхождения.
//    `getAvailableReactionsByMessage` (:369-424) не портирован целиком: его
//    ветки — теги «Избранного», сортировка по уже стоящим реакциям для
//    `chatReactionsSome` и лимит `reactions_uniq_max`; ни тегов, ни лимита у нас
//    нет, а сортировка бессмысленна без второй.
//  • Документ роли у нас — плоский номер файла (`*MediaId`), а не `Document`;
//    `wrapSticker` принимает `mediaId` (`wrappers/sticker.ts`).
//  • `cached`-путь (:288-303) не портирован: у оригинала каталог лежит
//    зеркалом в табе и отдаётся СИНХРОННО, у нас `list()` — всегда обещание
//    (GET `/reactions`), то есть ветка `cached` тождественно ложна. Остаётся
//    `fastRaf(callback)`, как у оригинала в некэшированном случае.
//  • `skipRatio`/`loadPromises` у `wrapSticker` (:552-561) — опций нет; ждать
//    загрузки умеет возвращаемый `render`, им и собирается `renderPromises`.
import type { Reaction } from '@core/models'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import {
  getAvailableReactions,
  getAvailableReactionsForPeer,
  type PeerAvailableReactions,
  type ReactionsCatalogManagers,
} from './reactions'
import animationIntersector, { type AnimationItemGroup } from '@components/animationIntersector'
import wrapSticker from '@components/wrappers/sticker'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import lottieLoader from '@lib/lottie/lottieLoader'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE } from '@environment/userAgent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import ListenerSetter from '@helpers/listenerSetter'
import liteMode from '@helpers/liteMode'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import { fastRaf } from '@helpers/schedulers'

// tweb :39-40
const REACTIONS_CLASS_NAME = 'btn-menu-reactions'
export const REACTION_CLASS_NAME = REACTIONS_CLASS_NAME + '-reaction'

// tweb :42-47
export const REACTIONS_MAX_LENGTH = 7
const REACTION_SIZE = 28 // 36
const PADDING = 6
export const REACTION_CONTAINER_SIZE = REACTION_SIZE + PADDING * 2

/** tweb :50-56 — пара плееров одной ячейки и её реакция. */
type ChatReactionsMenuPlayers = {
  select?: LottiePlayer
  appear?: LottiePlayer
  selectWrapper?: HTMLElement
  appearWrapper: HTMLElement
  reaction: Reaction
}

export interface ChatReactionsMenuOptions {
  managers: ReactionsCatalogManagers
  /** Чей это чат — по нему читается политика реакций (tweb
   *  `getAvailableReactionsByMessage` берёт `message.peerId`,
   *  appReactionsManager.ts:369-386). */
  peerId: PeerId
  middleware: Middleware
  /** tweb :64,82 — выбор сделан. `Promise<Reaction>` оригинала (ветка «ещё»)
   *  здесь предмета не имеет: кнопки «ещё» нет. */
  onFinish: (reaction: Reaction) => void
}

export default class ChatReactionsMenu {
  public widthContainer: HTMLElement
  public container: HTMLElement
  private reactionsMap: Map<HTMLElement, ChatReactionsMenuPlayers>
  private animationGroup: AnimationItemGroup
  private middlewareHelper: ReturnType<typeof getMiddleware>
  private managers: ReactionsCatalogManagers
  private peerId: PeerId
  private onFinish: ChatReactionsMenuOptions['onFinish']
  private listenerSetter: ListenerSetter

  constructor(options: ChatReactionsMenuOptions) {
    this.managers = options.managers
    this.peerId = options.peerId
    // tweb :92
    this.middlewareHelper = options.middleware ? options.middleware.create() : getMiddleware()
    this.onFinish = options.onFinish
    this.listenerSetter = new ListenerSetter()

    // tweb :102-104
    this.middlewareHelper.get().onDestroy(() => {
      this.listenerSetter.removeAll()
    })

    // tweb :106-112. Модификатор раскладки у оригинала берётся из
    // `options.type` (:83,110), но другого значения, кроме `horizontal`, туда
    // не приходит: `reactionsMenuPosition` дописан `|| true`
    // (contextMenu.ts:1664), а стили вертикальной раскладки закомментированы
    // целиком (`_button.scss:747-777`). Мёртвая развилка не переносится.
    const widthContainer = this.widthContainer = document.createElement('div')
    widthContainer.classList.add(
      REACTIONS_CLASS_NAME + '-container',
      REACTIONS_CLASS_NAME + '-container-horizontal',
      'btn-menu-transition',
    )

    // tweb :129-131
    const reactionsContainer = this.container = document.createElement('div')
    reactionsContainer.classList.add(REACTIONS_CLASS_NAME)

    // tweb :139-147 — хвостик под панелью; цикл оригинала по одному типу
    // ('big') развёрнут: второй ('small') у него закомментирован вместе со
    // стилями (`_button.scss:793-798`).
    const bubble = document.createElement('div')
    bubble.classList.add(REACTIONS_CLASS_NAME + '-bubble', REACTIONS_CLASS_NAME + '-bubble-big')
    widthContainer.append(bubble)

    this.reactionsMap = new Map()
    // tweb :149-150
    this.animationGroup = `CHAT-MENU-REACTIONS-${Date.now()}`
    animationIntersector.setOverrideIdleGroup(this.animationGroup, true)

    // tweb :152-154 — на таче ховера нет, `select` там не перезапускают.
    if(!IS_TOUCH_SUPPORTED) {
      reactionsContainer.addEventListener('mousemove', this.onMouseMove)
    }

    // tweb :156-171
    attachClickEvent(reactionsContainer, (e) => {
      const reactionDiv = findUpClassName(e.target as HTMLElement, REACTION_CLASS_NAME)
      if(!reactionDiv) return

      const players = this.reactionsMap.get(reactionDiv)
      if(!players) return

      this.onFinish(players.reaction)
    }, { listenerSetter: this.listenerSetter })

    // tweb :173
    widthContainer.append(reactionsContainer)
  }

  /** tweb :178-198 без ветки кнопки «ещё» (см. шапку). */
  private render = async(renderPromises: Promise<unknown>[]) => {
    const middleware = this.middlewareHelper.get()
    await Promise.all(renderPromises)
    if(!middleware()) {
      return
    }

    return () => {
      this.widthContainer.classList.add('is-visible')
    }
  }

  /** tweb :201-220 (`renderReactions`): идём по СПИСКУ ПОЛИТИКИ, а файлы ролей
   *  ищем в каталоге (:214-215). Реакции, которой в каталоге нет, ячейка
   *  покажет текстовым эмодзи — см. `renderReaction`. */
  private renderReactions(
    { reactions }: PeerAvailableReactions,
    availableReactions: AvailableReaction[],
  ) {
    const renderPromises = reactions
      .slice(0, REACTIONS_MAX_LENGTH)
      .map((reaction) => this.renderReaction(
        reaction,
        reaction._ === 'reactionEmoji'
          ? availableReactions.find((availableReaction) => availableReaction.emoji === reaction.emoticon)
          : undefined,
      ))

    return this.render(renderPromises)
  }

  /** tweb :228-258 (`prepareReactions`) без веток эффектов и кастом-эмодзи. */
  private prepareReactions() {
    const middleware = this.middlewareHelper.get()
    const catalog = getAvailableReactions(this.managers)
    // Каталога нет вовсе — рисовать нечем; результат тот же, что у
    // `chatReactionsNone` (:250-252): панель остаётся невидимой (`is-visible` не
    // ставится) и, раз она `position: absolute` (`_button.scss:721`), места в
    // меню не занимает.
    if(!catalog) return undefined

    return Promise.all([
      getAvailableReactionsForPeer(this.peerId, this.managers),
      catalog,
    ]).then(([peerAvailableReactions, availableReactions]) => {
      if(!middleware()) {
        return
      }

      // tweb :250-252 — реакции в этом пире запрещены.
      if(!peerAvailableReactions || peerAvailableReactions.type === 'chatReactionsNone') {
        return
      }

      if(!peerAvailableReactions.reactions.length) {
        return
      }

      return this.renderReactions(peerAvailableReactions, availableReactions)
    })
  }

  /** tweb :283-306 (`init`) без ветки эффектов и без `cached` (см. шапку).
   *  Поле `inited` (:78,312) не портировано: у оригинала оно write-only —
   *  читателя нет ни у него, ни тем более у нас. */
  public async init() {
    const renderPromise = this.prepareReactions()
    if(!renderPromise) {
      return
    }

    void renderPromise.then((callback) => {
      if(!callback) {
        return
      }

      fastRaf(callback)
    })
  }

  /** tweb :308-315. */
  public cleanup() {
    this.middlewareHelper.clean()
    this.reactionsMap.clear()
    animationIntersector.setOverrideIdleGroup(this.animationGroup, false)
    animationIntersector.checkAnimations(true, this.animationGroup, true)
  }

  /** tweb :513-515. На мобильном анимаций в панели нет вовсе — там рисуется
   *  статичная иконка. */
  private canUseAnimations() {
    return liteMode.isAvailable('animations') && liteMode.isAvailable('stickers_chat') && !IS_MOBILE
  }

  /** tweb :517-677 (`renderReaction`) в ветке обычной эмодзи-реакции.
   *  `availableReaction` необязателен по той же причине, что и у оригинала
   *  (:214-215 `find(...)` может не найти): политика чата вправе разрешить
   *  реакцию, которой в каталоге нет. Такая ячейка остаётся текстовым эмодзи —
   *  файлов ролей для неё не существует. */
  private async renderReaction(reaction: Reaction, availableReaction?: AvailableReaction) {
    // tweb :522-524 `warmUpReactionEffect` не портирован: прогрева ассетов
    // эффекта (`reaction.ts:268-285`) у нас нет — точки входа «скачать документ
    // заранее» у `wrapSticker` не существует.

    // tweb :526-533
    const reactionDiv = document.createElement('div')
    reactionDiv.classList.add(REACTION_CLASS_NAME)

    const scaleContainer = document.createElement('div')
    scaleContainer.classList.add(REACTION_CLASS_NAME + '-scale')

    const appearWrapper = document.createElement('div')
    appearWrapper.classList.add(REACTION_CLASS_NAME + '-appear')

    // tweb :535-538 — второй слой заводится, только если анимациям быть.
    const canUseAnimations = this.canUseAnimations() &&
      !!availableReaction?.appearMediaId &&
      !!availableReaction.selectMediaId
    let selectWrapper: HTMLElement | undefined
    if(canUseAnimations) {
      selectWrapper = document.createElement('div')
      selectWrapper.classList.add(REACTION_CLASS_NAME + '-select', 'hide')
    }

    // tweb :540-546
    const players: ChatReactionsMenuPlayers = { selectWrapper, appearWrapper, reaction }
    this.reactionsMap.set(reactionDiv, players)

    const middleware = this.middlewareHelper.get()

    // tweb :550-551 — `SCALE_ON_HOVER = false` (:48), значит множитель всегда 1.
    const size = REACTION_SIZE

    const options = {
      width: size,
      height: size,
      needFadeIn: false,
      withThumb: false,
      group: this.animationGroup,
      middleware,
      liteModeKey: false as const,
    }

    // tweb :565
    this.container.append(reactionDiv)

    // Текстовое эмодзи нижним слоем — НАШЕ, у оригинала его нет: там место
    // иконки на время загрузки занимает stripped-превью документа, которого у
    // плоского номера файла не бывает. Тот же приём и по той же причине уже
    // стоит у чипа бабла (`chat/reactions.ts::renderIcon`). Здесь он вдобавок
    // закрывает случай «ассетов реакций на бэке нет вовсе»: ячейка показывает
    // эмодзи, а не остаётся пустым квадратом.
    const emojiText = document.createTextNode(reaction._ === 'reactionEmoji' ? reaction.emoticon : '')
    appearWrapper.append(emojiText)
    const dropEmojiText = () => { emojiText.remove() }

    const renderPromises: Promise<unknown>[] = []
    if(!canUseAnimations) {
      // tweb :598-640 — статичная иконка вместо пары анимаций.
      const mediaId = availableReaction?.staticMediaId ?? availableReaction?.centerMediaId
      if(mediaId) {
        renderPromises.push(wrapSticker({
          div: appearWrapper,
          mediaId,
          play: false,
          loop: false,
          ...options,
        }).render.then(dropEmojiText).catch(noop))
      }
    } else {
      // tweb :642-676: `appear` играет сразу, `select` ждёт своего первого
      // кадра; на ПОСЛЕДНЕМ кадре `appear` слои меняются местами.
      const selectRender = wrapSticker({
        div: selectWrapper!,
        mediaId: availableReaction.selectMediaId!,
        play: false,
        loop: false,
        ...options,
      }).render
      // tweb :670-676 — ждать ПЕРВОГО КАДРА `select` панель не обязана
      // (`loadPromises` оригинала собирает только загрузку, :561): ждёт его
      // лишь подмена слоя на последнем кадре `appear`.
      const selectLoadPromise = selectRender.then((player) => {
        if(!(player instanceof LottiePlayer)) return undefined
        return lottieLoader.waitForFirstFrame(player)
      }).catch(noop)

      let isFirst = true
      const appearPromise = wrapSticker({
        div: appearWrapper,
        mediaId: availableReaction.appearMediaId!,
        play: true,
        loop: false,
        ...options,
      }).render.then((player) => {
        dropEmojiText()
        if(!(player instanceof LottiePlayer)) return

        players.appear = player

        player.addEventListener('enterFrame', (frameNo) => {
          if(player.maxFrame !== frameNo) return

          void selectLoadPromise.then((selectPlayer) => {
            if(!selectPlayer) return

            appearWrapper.classList.add('hide')
            selectWrapper!.classList.remove('hide')

            if(isFirst) {
              players.select = selectPlayer
              isFirst = false
            }
          }, noop)
        })
      }, noop)

      renderPromises.push(appearPromise, selectRender.catch(noop))
    }

    // tweb :679-682
    scaleContainer.append(appearWrapper)
    selectWrapper && scaleContainer.append(selectWrapper)
    reactionDiv.append(scaleContainer)

    return Promise.all(renderPromises)
  }

  /** tweb :711-735 — ховер перезапускает `select` этой ячейки. */
  private onMouseMove = (e: MouseEvent) => {
    const reactionDiv = findUpClassName(e.target as HTMLElement, REACTION_CLASS_NAME)
    if(!reactionDiv) {
      return
    }

    const players = this.reactionsMap.get(reactionDiv)
    if(!players) {
      return
    }

    // do not play select animation when appearing
    if(!players.appear?.paused) {
      return
    }

    const player = players.select
    if(!player) {
      return
    }

    if(player.paused) {
      player.autoplay = true
      player.restart()
    }
  }
}

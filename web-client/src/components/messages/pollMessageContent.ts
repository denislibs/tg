/**
 * Порт `tweb/src/components/chat/bubbleParts/pollMessageContent/` — ТЕЛО
 * СООБЩЕНИЯ-ОПРОСА: вопрос, подзаголовок вида опроса, варианты с чекбоксами,
 * проценты, полоски результата, счётчик проголосовавших и кнопка голосования.
 *
 * Точка входа оригинала — `tweb/src/components/chat/bubbles.ts:8757-8814`:
 * создаётся `div.poll-message-content`, в него Solid-рендером ставится
 * `PollMessageContent`, узел кладётся `messageDiv.prepend(container)`, баблу
 * вешается класс `poll-message`, а текст самого сообщения обнуляется
 * (`context.messageMessage = totalEntities = undefined`, :8760) — он рисуется
 * ВНУТРИ опроса как `description`.
 *
 * ── Почему ванильная фабрика, а не остров ───────────────────────────────────
 * Узлом владеет тот, кто решает, когда узел меняется. Здесь это ЛЕНТА: опрос
 * меняется от кадра `poll_update` (приезжает патчем `media` и всплывает
 * событием `message_edit`) и от клика по варианту — оба момента диктует лента,
 * а не React-дерево. Из трёх приёмов проекта:
 *   • `core/hooks/useImperativeIsland` — React→vanilla мост, тянет `react`;
 *     лента (`components/chat/bubbles.ts`) — сама vanilla, моста здесь нет;
 *   • `shared/solid/mountSolid` — острова ставятся на КРУПНЫХ границах (попап,
 *     вкладка, экран, см. `web-client/CLAUDE.md`), а внутри ленты Solid-узлов
 *     нет ни одного; лист бабла такой границей не является;
 *   • ванильная фабрика с хендлом (`components/progressRing.ts`,
 *     `components/messages/messageSpoilerOverlay.ts`) — ровно этот случай:
 *     в tweb ядро Solid, у нас ядро ванильное, а наружу торчит `create*`,
 *     потому что вызывающий ванильный.
 * Выбран третий. Хендл повторяет оригинал по смыслу: `update(media)` — это
 * `updateLocalOnEdit` (bubbles.ts:8793-8804, `Object.assign(propsMutable, …)`),
 * `destroy()` — `middleware.onDestroy` (:8806).
 *
 * Обновление ТОЧЕЧНОЕ, а не пересборкой поддерева: у оригинала реактивность
 * мелкозернистая, и от неё зависит видимое поведение — процент и полоска
 * анимируются ОТ ПРЕДЫДУЩЕГО значения (`useAnimatedValueFromZero`,
 * PollOption.tsx:356-379). Пересборка сбрасывала бы предыдущее в ноль и
 * заставляла бы числа каждый раз прыгать с нуля.
 *
 * ── Что НЕ портировано (нет данных на бэкенде) ──────────────────────────────
 * Аватарки последних проголосовавших (`recent_voters`), «View Votes» с табом
 * результатов (`can_view_stats`), объяснение правильного ответа
 * (`solution*`), таймер закрытия (`close_date`), сокрытие итогов до закрытия,
 * перемешивание вариантов, свободные ответы, медиа у варианта и у вопроса,
 * ограничения голосования по подписке/стране, конфетти за верный ответ
 * викторины. Полный список с причинами — `backlogs/frontend/poll-backend-gaps.md`.
 */
import { animateValue } from '@helpers/animateValue'
import clamp from '@helpers/number/clamp'
import formatNumber from '@helpers/number/formatNumber'
import { fastRaf } from '@helpers/schedulers'
import I18n, { type LangPackKey } from '@lib/langPack'
import { wrapMessageText } from '@lib/richtext'
import type { MessageMediaPoll } from '@core/media/messageMedia'
import { pollOptionIndex } from '@core/media/messageMedia'
import ripple from '@components/ripple'
import { createSpinner } from '@components/spinner'
import { createStaticCheckbox, type StaticCheckboxHandle } from '@components/staticCheckbox'
import { createPathDot, type PathDotHandle } from './pathDot'
import { getRoundedPercentsFromResults } from './roundPercents'
import styles from './pollMessageContent.module.scss'

/** tweb PollOption.tsx:34 — база длительности анимаций процента и полоски. */
const PROGRESS_TRANSITION_TIME_BASE = 600

/**
 * tweb usePollMutations.ts:70 — спиннер показывается, только если запрос идёт
 * дольше 100 мс; и tweb PollOption.tsx:83 — «летящая точка» ждёт ещё 100 мс
 * после того, как спиннер погас. Две задержки, а не одна.
 */
const SPINNER_APPEAR_DELAY = 100
const SPINNER_TRAIL_DELAY = 100

export interface PollMessageContentOptions {
  media: MessageMediaPoll
  /** Текст сообщения — у опроса он рисуется описанием ВНУТРИ (tweb :87). */
  text: string
  entities: Parameters<typeof wrapMessageText>[1]
  isOutgoing: boolean
  /**
   * Отправка голоса. Пустой список — отзыв (`appPollsManager.sendVote(msg, [])`,
   * tweb contextMenu.ts:2002-2004); отсюда он не зовётся — отзыв живёт в
   * контекстном меню, как и в оригинале.
   */
  vote?: (pollId: number, options: number[]) => Promise<unknown>
}

export interface PollMessageContentHandle {
  element: HTMLElement
  /** Порт `updateLocalOnEdit` (tweb bubbles.ts:8793-8804). */
  update: (media: MessageMediaPoll, text: string, entities: PollMessageContentOptions['entities']) => void
  destroy: VoidFunction
}

/** Анимируемое число: с нуля при первом показе, иначе от предыдущего значения
 *  (порт `useAnimatedValueFromZero`, tweb PollOption.tsx:356-379). */
function createAnimatedValue(
  apply: (value: number) => void,
  getDuration: (value: number, prevValue: number) => number,
) {
  let prevValue = 0
  /** Цель ТЕКУЩЕЙ анимации. Без неё повторный `set` с тем же числом рвал бы
   *  уже идущую анимацию и не перезапускал её (`value === prevValue` →
   *  ранний выход), и процент навсегда оставался бы пустым. У оригинала этой
   *  ловушки нет: там `createEffect` вообще не срабатывает, пока значение то
   *  же, — а наш `render()` безусловный и зовётся на каждую правку. */
  let target: number | undefined
  let cancel: VoidFunction | undefined

  return {
    set(value: number, canAnimate: boolean) {
      if (target === value) return
      target = value

      cancel?.()
      cancel = undefined

      if (!canAnimate) {
        prevValue = value
        apply(value)
        return
      }

      const from = prevValue
      prevValue = value
      cancel = animateValue(from, value, getDuration(value, from), apply, { easing: (p) => p })
    },
    /** Отзыв голоса возвращает счётчик в ноль — как пересоздание сигнала у Solid. */
    reset() {
      cancel?.()
      cancel = undefined
      prevValue = 0
      target = undefined
    },
    destroy() {
      cancel?.()
      cancel = undefined
    },
  }
}

/** Разбор итогов в форму, которой пользуется отрисовка. Наш «мой выбор» и
 *  «правильный ответ» — ФЛАГИ ВАРИАНТА в итогах (`pollAnswerVoters.pFlags`),
 *  тогда как оригинал держит их отдельными массивами `poll.chosenIndexes` /
 *  `poll.correctIndexes`, которые сам же и собирает из этих флагов
 *  (`appPollsManager.saveResults`, :412-457). Схема у нас общая с сервером,
 *  промежуточной записи заводить незачем. */
function readResults(media: MessageMediaPoll) {
  const answers = media.poll.answers
  const percents = getRoundedPercentsFromResults(media.results)
  const byOption = new Map(media.results.results?.map((r) => [r.option, r]) ?? [])

  return answers.map((answer, i) => {
    const voters = byOption.get(answer.option)
    return {
      index: pollOptionIndex(answer.option),
      text: answer.text.text,
      voters: voters?.voters ?? 0,
      percent: percents[i] ?? 0,
      chosen: !!voters?.pFlags?.chosen,
      correct: !!voters?.pFlags?.correct,
    }
  })
}

type OptionResult = ReturnType<typeof readResults>[number]

export function createPollMessageContent(opts: PollMessageContentOptions): PollMessageContentHandle {
  let media = opts.media
  let poll = () => media.poll
  let results = () => readResults(media)

  // ── Состояние, которого нет в данных (у оригинала — сигналы) ──────────────
  /** Накопленный выбор до нажатия «Проголосовать» — только мультивыбор
   *  (tweb PollMessageContent.tsx:337-343). */
  let chosenIndexes: number[] = []
  let votePending = false
  /** Спиннер: включается с задержкой (tweb usePollMutations.ts:70). */
  let spinnerVisible = false
  /** Хвост спиннера: гасит «летящую точку», пока крутилка не убралась
   *  (tweb PollOption.tsx:83). */
  let spinnerTrailing = false
  let spinnerAppearTimer: ReturnType<typeof setTimeout> | undefined
  let spinnerTrailTimer: ReturnType<typeof setTimeout> | undefined
  /** tweb PollOption.tsx:87-91 — анимации включаются со следующего кадра, иначе
   *  первый показ проигрывал бы весь путь от нуля прямо при вставке в DOM. */
  let canAnimate = false
  let destroyed = false

  const isQuiz = () => !!poll().pFlags?.quiz
  const isClosed = () => !!poll().pFlags?.closed
  const isPublic = () => !!poll().pFlags?.public_voters
  const isMultiple = () => !!poll().pFlags?.multiple_choice
  /** tweb usePollDerivedProps.ts:108-112 (без ветки vote-restriction — её
   *  предмета у нас нет). */
  const isShowingResult = () => results().some((r) => r.chosen) || isClosed()
  const votersCount = () => media.results.total_voters ?? 0

  // ── Каркас ────────────────────────────────────────────────────────────────
  const element = document.createElement('div')
  element.classList.add('poll-message-content', styles.container)
  if (opts.isOutgoing) element.classList.add(styles.outgoing)

  // Описание — текст самого сообщения (tweb PollMessageContent.tsx:508-516).
  const description = document.createElement('div')
  description.classList.add(styles.description, 'spoilers-container')

  const header = document.createElement('div')
  header.classList.add(styles.header)
  const headerTitleContainer = document.createElement('div')
  headerTitleContainer.classList.add(styles.headerTitleContainer)
  const headerTitle = document.createElement('div')
  headerTitle.classList.add(styles.headerTitle)
  const headerSubtitle = document.createElement('div')
  headerSubtitle.classList.add(styles.headerSubtitle)
  headerTitleContainer.append(headerTitle, headerSubtitle)
  header.append(headerTitleContainer)

  const footer = document.createElement('div')
  footer.classList.add(styles.footer)
  const footerButton = document.createElement('div')
  footerButton.classList.add(styles.footerButton)
  if (opts.isOutgoing) footerButton.classList.add(styles.outgoing)
  footer.append(footerButton)
  const footerRipple = ripple(footerButton)

  /** tweb `<Space amount='…'/>` (components/space.tsx) — распорка отступом. */
  const space = (amount: string) => {
    const el = document.createElement('div')
    el.style.paddingTop = amount
    return el
  }

  const optionsHost = document.createElement('div')

  element.append(description, header, optionsHost, space('0.25rem'), footer, space('1rem'))

  // ── Один вариант ──────────────────────────────────────────────────────────
  interface OptionNodes {
    root: HTMLElement
    clickableArea: HTMLElement
    checkContainer: HTMLElement
    checkbox: StaticCheckboxHandle
    spinnerContainer: HTMLElement
    percent: HTMLElement
    labelRow: HTMLElement
    labelStats: HTMLElement
    labelNumber: HTMLElement
    labelProgress: HTMLElement
    labelProgressFill: HTMLElement
    chosenCheckbox: StaticCheckboxHandle
    chosenCheckboxDot: HTMLElement
    percentValue: ReturnType<typeof createAnimatedValue>
    progressValue: ReturnType<typeof createAnimatedValue>
    /** Локальное состояние варианта: процент появляется только ПОСЛЕ пробега
     *  «летящей точки» (tweb PollOption.tsx:72, :196). */
    canShowPercentage: boolean
    pathDot?: PathDotHandle
  }

  const optionNodes: OptionNodes[] = []

  function buildOption(result: OptionResult): OptionNodes {
    const root = document.createElement('div')
    root.classList.add(styles.pollOption)
    // Атрибут оригинала (tweb PollOption.tsx:119) — по нему контекстное меню
    // находит вариант, а deeplink подсвечивает его.
    root.dataset.pollOptionIdx = '' + result.index

    const clickableArea = document.createElement('div')
    clickableArea.classList.add(styles.clickableArea)
    if (opts.isOutgoing) clickableArea.classList.add(styles.outgoing)
    ripple(clickableArea)
    clickableArea.addEventListener('click', () => handleToggle(result.index))

    const checkContainer = document.createElement('div')
    checkContainer.classList.add(styles.checkContainer)

    const spinnerContainer = document.createElement('div')
    spinnerContainer.classList.add(styles.spinnerContainer)
    spinnerContainer.append(createSpinner({ thickness: 2 / 12 }))

    const checkbox = createStaticCheckbox({
      round: !isMultiple(),
      className: `${styles.checkbox} ${opts.isOutgoing ? styles.isOutgoing : ''}`.trim(),
    })

    const percent = document.createElement('div')
    percent.classList.add(styles.percent)

    checkContainer.append(checkbox.element)

    const spacerFirst = document.createElement('div')
    spacerFirst.classList.add(styles.pollOptionSpacerFirst)

    const labelRow = document.createElement('div')
    labelRow.classList.add(styles.labelRow)

    const labelText = document.createElement('div')
    labelText.classList.add(styles.labelText)
    labelText.append(document.createTextNode(result.text))

    const labelStats = document.createElement('div')
    labelStats.classList.add(styles.labelStats)
    const labelNumber = document.createElement('div')
    labelNumber.classList.add(styles.labelNumber)
    labelStats.append(labelNumber)

    const labelProgress = document.createElement('div')
    labelProgress.classList.add(styles.labelProgress)
    const labelProgressFill = document.createElement('div')
    labelProgressFill.classList.add(styles.labelProgressFill)
    labelProgress.append(labelProgressFill)

    const chosenCheckboxDot = document.createElement('div')
    chosenCheckboxDot.classList.add(styles.chosenCheckboxDot)

    const chosenCheckbox = createStaticCheckbox({
      round: !isMultiple(),
      checked: true,
      // Крестик вместо галочки — только у неверного ответа викторины
      // (tweb PollOption.tsx:213).
      cross: isQuiz() && !result.correct,
      className: `${styles.chosenCheckbox} ${opts.isOutgoing ? styles.isOutgoing : ''}`.trim(),
    })

    labelRow.append(labelText)
    root.append(clickableArea, checkContainer, spacerFirst, labelRow)

    return {
      root,
      clickableArea,
      checkContainer,
      checkbox,
      spinnerContainer,
      percent,
      labelRow,
      labelStats,
      labelNumber,
      labelProgress,
      labelProgressFill,
      chosenCheckbox,
      chosenCheckboxDot,
      percentValue: createAnimatedValue(
        (v) => { percent.textContent = `${v | 0}%` },
        // tweb PollOption.tsx:347 — 600 * 1.5 * |Δ| / 100.
        (v, prev) => (PROGRESS_TRANSITION_TIME_BASE * 1.5 * Math.abs(v - prev)) / 100,
      ),
      progressValue: createAnimatedValue(
        (v) => { labelProgressFill.style.setProperty('--progress', '' + v) },
        // tweb PollOption.tsx:315 — 600 * |Δ|, где значение это доля 0..1.
        (v, prev) => PROGRESS_TRANSITION_TIME_BASE * Math.abs(v - prev),
      ),
      canShowPercentage: isShowingResult(),
    }
  }

  /** Переключить наличие узла-ребёнка, не трогая порядок остальных. */
  function toggleChild(parent: HTMLElement, child: HTMLElement, show: boolean) {
    if (show) {
      if (child.parentElement !== parent) parent.append(child)
    } else if (child.parentElement === parent) {
      child.remove()
    }
  }

  function renderOption(nodes: OptionNodes, result: OptionResult) {
    const showingResult = isShowingResult()
    const quiz = isQuiz()

    // Результаты пропали (отзыв голоса) — процент снова прячется за точкой
    // (tweb PollOption.tsx:94-100: onCleanup сбрасывает `canShowPercentage`).
    if (!showingResult && nodes.canShowPercentage) {
      nodes.canShowPercentage = false
      nodes.percentValue.reset()
      nodes.progressValue.reset()
    }

    // Клик по варианту не имеет смысла, когда итоги уже показаны
    // (tweb PollOption.tsx:123).
    nodes.clickableArea.classList.toggle(styles.pointerDisabled, showingResult)

    // ── Левая колонка: спиннер / чекбокс / процент (tweb :131-154) ──────────
    toggleChild(nodes.checkContainer, nodes.spinnerContainer, spinnerVisible)
    const showCheckbox = !spinnerVisible && !showingResult
    toggleChild(nodes.checkContainer, nodes.checkbox.element, showCheckbox)
    if (showCheckbox) nodes.checkbox.setChecked(chosenIndexes.includes(result.index))

    const showPercent = !spinnerVisible && showingResult && nodes.canShowPercentage
    toggleChild(nodes.checkContainer, nodes.percent, showPercent)
    if (showPercent) nodes.percentValue.set(clamp(result.percent, 0, 100), canAnimate)

    // ── Правая колонка ─────────────────────────────────────────────────────
    toggleChild(nodes.labelRow, nodes.labelStats, showingResult && !!result.voters)
    if (showingResult && result.voters) {
      nodes.labelNumber.textContent = formatNumber(result.voters, 1)
    }

    const showProgress = showingResult && nodes.canShowPercentage
    toggleChild(nodes.labelRow, nodes.labelProgress, showProgress)
    if (showProgress) {
      // Зелёная/красная полоска — только у входящей викторины
      // (tweb PollOption.tsx:319-323: гейт `!isOutgoing`).
      nodes.labelProgress.classList.toggle(styles.correct, !opts.isOutgoing && quiz && result.correct)
      nodes.labelProgress.classList.toggle(styles.wrong, !opts.isOutgoing && quiz && !result.correct)
      nodes.progressValue.set(result.percent / 100, canAnimate)
    }

    // «Летящая точка» — tweb PollOption.tsx:85.
    const showPathDot = canAnimate && showingResult && !nodes.canShowPercentage && !spinnerTrailing
    if (showPathDot && !nodes.pathDot) {
      nodes.pathDot = createPathDot({
        className: styles.pathDot,
        dotColor: 'var(--primary-color)',
        width: 48,
        height: 24,
        dotThickness: 4,
        dotLength: 3.6,
        radius: 8,
        padding: 0,
        duration: 0.4,
        onAnimationEnd: () => {
          if (destroyed) return
          nodes.canShowPercentage = true
          render()
        },
      })
      nodes.labelRow.append(nodes.pathDot.element)
    } else if (!showPathDot && nodes.pathDot) {
      nodes.pathDot.destroy()
      nodes.pathDot.element.remove()
      nodes.pathDot = undefined
    }

    // Галочка/крестик выбранного варианта — tweb PollOption.tsx:200-224.
    const canShowPercentageCheckbox = showingResult && nodes.canShowPercentage && (result.chosen || quiz)
    toggleChild(nodes.labelRow, nodes.chosenCheckboxDot, canShowPercentageCheckbox && quiz && result.chosen)
    nodes.chosenCheckboxDot.classList.toggle(styles.correct, !opts.isOutgoing && result.correct)
    nodes.chosenCheckboxDot.classList.toggle(styles.wrong, !opts.isOutgoing && !result.correct)

    toggleChild(nodes.labelRow, nodes.chosenCheckbox.element, canShowPercentageCheckbox)
    nodes.chosenCheckbox.element.classList.toggle(styles.correct, !opts.isOutgoing && quiz && result.correct)
    nodes.chosenCheckbox.element.classList.toggle(styles.wrong, !opts.isOutgoing && quiz && !result.correct)
  }

  // ── Подзаголовок и футер ──────────────────────────────────────────────────

  /** Порт `PollType` (tweb parts.tsx:149-159) — приоритет: закрыт → викторина →
   *  публичный/анонимный. */
  function pollTypeKey(): LangPackKey {
    if (isClosed()) return 'Chat.Poll.Type.Closed'
    if (isQuiz()) return isPublic() ? 'Chat.Poll.Type.Quiz' : 'Chat.Poll.Type.AnonymousQuiz'
    return isPublic() ? 'Chat.Poll.Type.Public' : 'Chat.Poll.Type.Anonymous'
  }

  /** Порт `PollVotes` (tweb parts.tsx:161-176). */
  function pollVotesKey(): LangPackKey {
    if (!votersCount()) {
      return isClosed() ? 'Chat.Poll.TotalVotesResultEmpty' : 'Chat.Poll.TotalVotesEmpty'
    }
    return isQuiz() ? 'Chat.Quiz.MembersAnswered' : 'Chat.Poll.MembersVoted'
  }

  function renderFooter() {
    // Ветка `Chat.Poll.ViewVotes` оригинала (tweb PollMessageContent.tsx:629-631)
    // НЕ портирована: она открывает таб результатов, а список проголосовавших
    // бэкенд не отдаёт (`can_view_stats` не производится) — см. долг.
    const hasSelectedSomething = chosenIndexes.length > 0
    const clickable = hasSelectedSomething && !votePending

    let node: Node
    if (hasSelectedSomething) {
      node = I18n.i18n('Chat.Poll.SubmitVote')
    } else if (isShowingResult()) {
      node = I18n.i18n(pollVotesKey(), [formatNumber(votersCount(), 1)])
    } else {
      node = I18n.i18n('Chat.Poll.SelectAnOption')
    }

    footerButton.classList.toggle(styles.clickable, clickable)
    // `.c-ripple` ставит сам `ripple` и держит его как своего ребёнка —
    // сносить надо только текст, иначе рябь исчезнет вместе с ним.
    for (const child of Array.from(footerButton.childNodes)) {
      if (child instanceof Element && child.classList.contains('c-ripple')) continue
      child.remove()
    }
    footerButton.prepend(node)
  }

  function render() {
    const list = results()

    headerSubtitle.replaceChildren(I18n.i18n(pollTypeKey()))

    list.forEach((result, i) => {
      renderOption(optionNodes[i], result)
    })

    renderFooter()
  }

  // ── Взаимодействие ────────────────────────────────────────────────────────

  function setVotePending(pending: boolean) {
    votePending = pending
    clearTimeout(spinnerAppearTimer)
    clearTimeout(spinnerTrailTimer)

    if (pending) {
      // Спиннер — только если запрос затянулся (tweb usePollMutations.ts:70).
      spinnerAppearTimer = setTimeout(() => {
        if (destroyed || !votePending) return
        spinnerVisible = true
        spinnerTrailing = true
        render()
      }, SPINNER_APPEAR_DELAY)
      return
    }

    spinnerVisible = false
    if (spinnerTrailing) {
      // Точка ждёт, пока крутилка уберётся (tweb PollOption.tsx:83).
      spinnerTrailTimer = setTimeout(() => {
        if (destroyed) return
        spinnerTrailing = false
        render()
      }, SPINNER_TRAIL_DELAY)
    }
  }

  /** Порт `sendVoteMutation` (tweb usePollMutations.ts:37-65) в применимом
   *  объёме: ветки ограничений голосования и свободных ответов выпадают вместе
   *  со своими данными. */
  async function sendVote(indexes: number[]) {
    if (isShowingResult() || !indexes.length || votePending || !opts.vote) return

    setVotePending(true)
    render()
    try {
      await opts.vote(poll().id, indexes)
      if (destroyed) return
      // `onSuccess: resetInteractiveState` (tweb PollMessageContent.tsx:262-267).
      chosenIndexes = []
    } finally {
      if (!destroyed) {
        setVotePending(false)
        render()
      }
    }
  }

  /** Порт `handleToggle` (tweb PollMessageContent.tsx:325-343).
   *
   *  Гейта «итоги уже показаны» здесь НЕТ — как и у оригинала: клик по
   *  проголосованному варианту не доходит до этого места вовсе, его снимает
   *  CSS (`pointerDisabled` на `.clickableArea`, tweb PollOption.tsx:123), а
   *  единственная содержательная проверка живёт в `sendVote` — там же, где у
   *  оригинала (`sendVoteMutation`, usePollMutations.ts:38). Дублировать её
   *  здесь значило бы завести второе место, где решается один вопрос.
   *
   *  `votePending` — порт `wrapAsyncClickHandler` (tweb usePollMutations.ts:67):
   *  он не пускает второй запрос, пока идёт первый. */
  function handleToggle(index: number) {
    if (votePending) return

    // Одиночный выбор голосует СРАЗУ, мультивыбор копит выбор до кнопки.
    if (!isMultiple()) {
      void sendVote([index])
      return
    }

    chosenIndexes = chosenIndexes.includes(index)
      ? chosenIndexes.filter((i) => i !== index)
      : [...chosenIndexes, index]
    render()
  }

  footerButton.addEventListener('click', () => {
    // tweb `onFooterClick` (:381-385) — у нас остаётся одна ветка: отправить
    // накопленный выбор (см. renderFooter про две выпавшие).
    if (chosenIndexes.length) void sendVote(chosenIndexes)
  })

  // ── Первая отрисовка ──────────────────────────────────────────────────────
  function renderQuestionAndDescription(
    text: string,
    entities: PollMessageContentOptions['entities'],
  ) {
    headerTitle.replaceChildren(document.createTextNode(poll().question.text))
    // Описание есть не всегда; пустой узел оригинал не создаёт вовсе
    // (`<Show when={descriptionText()}>`, tweb :508).
    toggleChild(element, description, !!text)
    if (text) description.replaceChildren(wrapMessageText(text, entities))
  }

  results().forEach((result) => {
    const nodes = buildOption(result)
    optionNodes.push(nodes)
    optionsHost.append(nodes.root)
  })

  renderQuestionAndDescription(opts.text, opts.entities)
  render()

  // tweb PollOption.tsx:87-91 — со следующего кадра анимации разрешены.
  fastRaf(() => {
    if (destroyed) return
    canAnimate = true
  })

  return {
    element,
    update(nextMedia, text, entities) {
      if (destroyed) return
      media = nextMedia
      poll = () => media.poll
      results = () => readResults(media)
      renderQuestionAndDescription(text, entities)
      render()
    },
    destroy() {
      destroyed = true
      clearTimeout(spinnerAppearTimer)
      clearTimeout(spinnerTrailTimer)
      footerRipple?.dispose()
      for (const nodes of optionNodes) {
        nodes.percentValue.destroy()
        nodes.progressValue.destroy()
        nodes.pathDot?.destroy()
      }
    },
  }
}

/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/sidebarLeft/tabs/quickReaction.tsx:1-64 (812502980) —
 * вкладка «Быстрая реакция» (`AppQuickReactionTab`, `solidJsTabs/tabs.ts`).
 * Задача 14 плана 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 * Открывает её строка «Quick Reaction» экрана «Стикеры и эмодзи» (tweb
 * `stickersAndEmoji.tsx:60-66`).
 *
 * Расхождения с оригиналом:
 *  1. Каталог — `getAvailableReactions(tab.managers)` (`chat/reactions.ts`) вместо
 *     `appReactionsManager.getAvailableReactions()`: это тот же кэш каталога на
 *     сессию (tweb appReactionsManager.ts:169), которым пользуются лента и панель
 *     реакций, — второй копии каталога не заводим. Поля — наши
 *     (`emoji`/`inactive`/`staticMediaId` вместо `reaction`/`pFlags.inactive`/
 *     `static_icon`).
 *  2. О-30: быстрой реакции у нас нет по всей вертикали — ни
 *     `config.reactions_default`, ни ручки `messages.setDefaultReaction`, ни
 *     события `quick_reaction` (разбор — `web-client/backlogs/frontend/
 *     quick-reaction-default.md`). Поэтому `getQuickReaction()` (`:22-24`) не
 *     зовётся и на открытии не отмечено ничего, а выбор (`:48-51`) только
 *     переносит отметку и никуда не пишется. Локальное хранилище не заводим: у
 *     оригинала выбор — серверный факт (конфиг аккаунта, общий для устройств), и
 *     клиентская копия стала бы вторым, расходящимся источником; ховер-реакция
 *     ленты (`chat/bubbles.ts::onBubblesMouseMove`) её всё равно не читает.
 */
import { createSignal, For, onMount } from 'solid-js'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import ReactionStickerPreview from '@components/reactionStickerPreview.solid'
import { getAvailableReactions } from '@components/chat/reactions'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppQuickReactionTab } from '@components/solidJsTabs/tabs'

const QuickReaction = () => {
  const [tab] = useSuperTab<typeof AppQuickReactionTab>()
  const promiseCollector = usePromiseCollector()
  const [reactions, setReactions] = createSignal<AvailableReaction[]>([])
  const [selectedReaction, setSelectedReaction] = createSignal<string>()

  onMount(() => {
    tab.container.classList.add('quick-reaction-container')
  })

  // tweb :21-30 — без `getQuickReaction()` (расхождение 2).
  promiseCollector.collect((async() => {
    const availableReactions = await getAvailableReactions(tab.managers!) ?? []
    setReactions(availableReactions.filter((reaction) => !reaction.inactive))
  })())

  return (
    <Section>
      <form>
        <For each={reactions()}>{(availableReaction) => {
          return (
            <Row havePadding>
              <Row.RadioField>
                <RadioFieldTsx
                  alignRight
                  class="disable-hover"
                  checked={selectedReaction() === availableReaction.emoji}
                  name="quick-reaction"
                  value={availableReaction.emoji}
                  onChange={(checked) => {
                    if(!checked) return
                    setSelectedReaction(availableReaction.emoji)
                    // О-30: `appReactionsManager.setDefaultReaction` (tweb :48-51)
                    // — ручки нет, см. расхождение 2 в шапке.
                  }}
                />
              </Row.RadioField>
              <Row.Title class="quick-reaction-title">{availableReaction.title}</Row.Title>
              <ReactionStickerPreview sticker={availableReaction.staticMediaId} />
            </Row>
          )
        }}</For>
      </form>
    </Section>
  )
}

export default QuickReaction

/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/chatReactions.tsx:1-208` (812502980) —
 * вкладка «Реакции» группы и канала (`AppChatReactionsTab`, `solidJsTabs/tabs.ts`,
 * tweb `tabs.ts:471-475`). Задача 0б-4, пачка П-1 (Б-39). Открывает её строка
 * «Реакции» редактора чата (`editChat.solid.tsx`, tweb `editChat.tsx:710-718`).
 *
 *   Section[AvailableReactions | —, caption по режиму]
 *     группа: form > Row×3 (радио «Все / Некоторые / Без реакций»)
 *     канал:  Row (тумблер «Включить реакции»)
 *   Section[OnlyAllowThisReactions] (.hide, кроме «Некоторых» и канала)
 *     Row.havePadding × каталог: тумблер + название + превью 32×32
 *
 * Сохранение — оригинала: каждое изменение откладывает запись на 3 с
 * (`debounce(…, 3000, false, true)`), закрытие вкладки (`destroy`) сбрасывает
 * отложенную запись немедленно. Пустой «Некоторые» уходит как «Без реакций».
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. Каталог — `getAvailableReactions(tab.managers)` (`chat/reactions.ts`, общий
 *     кэш сессии) с фильтром `!inactive` — это `getActiveAvailableReactions`
 *     оригинала (`appReactionsManager.ts:199-204`). Поля наши: `emoji`/
 *     `staticMediaId` вместо `reaction`/`static_icon` (шапка
 *     `reactionStickerPreview.solid.tsx`).
 *  2. `getChatFull` + `isBroadcast` (`:123-127`) — одна карточка
 *     `groups.card(peerId)` (`chat` + `fullChat`), как у `editChat.solid.tsx`
 *     (его расхождение 1). Ветки `communityFull` (`:128`) нет — сообществ нет.
 *  3. `appChatsManager.setChatAvailableReactions(chatId, value)` (`:57`) —
 *     ручка `groups.setReactions(peerId, mode, emojis)` (`PUT /chats/{id}/reactions`):
 *     бэкенд хранит политику строкой режима и списком эмодзи; перевод
 *     `ChatReactions` → пара — `toReactionsPolicy` ниже. `allow_custom`
 *     режима «Все» на проводе не нужен: своих эмодзи-реакций у нас нет.
 */
import { createSignal, createUniqueId, For, onMount, Show, type Component } from 'solid-js'
import debounce from '@helpers/schedulers/debounce'
import { i18n, type LangPackKey } from '@lib/langPack'
import CheckboxFieldTsx from '@components/checkboxFieldTsx.solid'
import RadioFieldTsx from '@components/radioFieldTsx.solid'
import Row from '@components/rowTsx.solid'
import Section from '@components/section.solid'
import ReactionStickerPreview from '@components/reactionStickerPreview.solid'
import { getAvailableReactions } from '@components/chat/reactions'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { usePromiseCollector } from '@components/solidJsTabs/promiseCollector.solid'
import type { AppChatReactionsTab } from '@components/solidJsTabs/tabs'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { ChatReactions, ReactionEmoji } from '@core/peers/peer'
import { toPeerId } from '@core/peers/peerId'

/** расхождение 3 */
export function toReactionsPolicy(value: ChatReactions): { mode: 'all' | 'some' | 'none', emojis: string[] } {
  if(value._ === 'chatReactionsSome') {
    return { mode: 'some', emojis: value.reactions.map((reaction) => reaction.emoticon) }
  }

  return { mode: value._ === 'chatReactionsAll' ? 'all' : 'none', emojis: [] }
}

const ChatReactionsTab: Component = () => {
  const [tab] = useSuperTab<typeof AppChatReactionsTab>()
  const promiseCollector = usePromiseCollector()
  const managers = tab.managers!
  const { chatId } = tab.payload
  const peerId = toPeerId(chatId as number, true)
  const [availableReactions, setAvailableReactions] = createSignal<AvailableReaction[]>([])
  const [chatReactions, setChatReactions] = createSignal<ChatReactions>()
  const [emoticons, setEmoticons] = createSignal(new Set<string>())
  const [isBroadcast, setIsBroadcast] = createSignal(false)
  const radioName = createUniqueId()

  const makeReactions = (values: Iterable<string>): ReactionEmoji[] => Array.from(values, (emoticon) => ({
    _: 'reactionEmoji',
    emoticon,
  }))

  const getCaptionLangPackKey = (): LangPackKey => {
    if(isBroadcast()) {
      return 'EnableReactionsChannelInfo'
    }

    const current = chatReactions()
    return current?._ === 'chatReactionsAll' ?
      'EnableAllReactionsInfo' :
      (current?._ === 'chatReactionsNone' ? 'DisableReactionsInfo' : 'EnableSomeReactionsInfo')
  }

  const saveReactions = () => {
    saveReactionsDebounced.clearTimeout()

    const current = chatReactions()
    if(!current) {
      return
    }

    let value = current
    if(current._ === 'chatReactionsSome') {
      const reactions = makeReactions(emoticons())
      value = reactions.length ? { ...current, reactions } : { _: 'chatReactionsNone' }
      setChatReactions(value)
    }

    // расхождение 3
    const { mode, emojis } = toReactionsPolicy(value)
    managers.groups.setReactions(peerId, mode, emojis).catch((error: unknown) => {
      console.error('setChatAvailableReactions error', error)
    })
  }

  const saveReactionsDebounced = debounce(saveReactions, 3000, false, true)

  const setMode = (mode: ChatReactions['_']) => {
    let value: ChatReactions
    let values: string[] = []
    if(mode === 'chatReactionsAll') {
      value = {
        _: mode,
        pFlags: { allow_custom: true },
      }
    } else if(mode === 'chatReactionsNone') {
      value = { _: mode }
    } else {
      values = ['👍', '👎']
      value = { _: mode, reactions: makeReactions(values) }
    }

    setEmoticons(new Set(values))
    setChatReactions(value)
    void saveReactionsDebounced()
  }

  const setBroadcastEnabled = (enabled: boolean) => {
    if(!enabled) {
      setEmoticons(new Set<string>())
      setChatReactions({ _: 'chatReactionsNone' })
      void saveReactionsDebounced()
      return
    }

    const values = emoticons().size ?
      new Set(emoticons()) :
      new Set(availableReactions().map(({ emoji }) => emoji))
    setEmoticons(values)
    setChatReactions({ _: 'chatReactionsSome', reactions: makeReactions(values) })
    void saveReactionsDebounced()
  }

  const setReactionChecked = (emoticon: string, checked: boolean) => {
    const values = new Set(emoticons())
    if(checked) {
      values.add(emoticon)
    } else {
      values.delete(emoticon)
    }

    setEmoticons(values)
    const reactions = makeReactions(values)
    setChatReactions(reactions.length ?
      { _: 'chatReactionsSome', reactions } :
      { _: 'chatReactionsNone' },
    )
    void saveReactionsDebounced()
  }

  onMount(() => {
    tab.eventListener.addEventListener('destroy', () => {
      if(saveReactionsDebounced.isDebounced()) {
        saveReactions()
      }
    }, { once: true })

    promiseCollector.collect((async() => {
      // расхождения 1, 2
      const [reactions, card] = await Promise.all([
        getAvailableReactions(managers) ?? [],
        managers.groups.card(peerId),
      ])
      const broadcast = !!card?.chat.pFlags?.broadcast
      const value: ChatReactions = card?.fullChat.available_reactions ?? { _: 'chatReactionsNone' }
      const values = value._ === 'chatReactionsSome' ?
        value.reactions.map((reaction) => reaction.emoticon) :
        []

      setAvailableReactions(reactions.filter((reaction) => !reaction.inactive))
      setIsBroadcast(broadcast)
      setEmoticons(new Set(values))
      setChatReactions(value)
    })())
  })

  const modes: [ChatReactions['_'], LangPackKey][] = [
    ['chatReactionsAll', 'AllReactions'],
    ['chatReactionsSome', 'SomeReactions'],
    ['chatReactionsNone', 'NoReactions'],
  ]

  return (
    <Show when={chatReactions()}>
      <Section
        name={isBroadcast() ? undefined : 'AvailableReactions'}
        caption={getCaptionLangPackKey()}
      >
        <Show when={isBroadcast()} fallback={
          <form>
            <For each={modes}>{([value, langPackKey]) => (
              <Row>
                <Row.RadioField>
                  <RadioFieldTsx
                    class="disable-hover"
                    checked={chatReactions()?._ === value}
                    name={radioName}
                    value={value}
                    onChange={(checked) => checked && setMode(value)}
                  />
                </Row.RadioField>
                <Row.Title>{i18n(langPackKey)}</Row.Title>
              </Row>
            )}</For>
          </form>
        }>
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                class="disable-hover"
                checked={chatReactions()?._ === 'chatReactionsSome'}
                toggle
                onChange={setBroadcastEnabled}
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('EnableReactions')}</Row.Title>
          </Row>
        </Show>
      </Section>
      <Section
        name="OnlyAllowThisReactions"
        classList={{ hide: !isBroadcast() && chatReactions()?._ !== 'chatReactionsSome' }}
      >
        <For each={availableReactions()}>{(availableReaction) => (
          <Row havePadding>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                class="disable-hover"
                checked={emoticons().has(availableReaction.emoji)}
                toggle
                onChange={(checked) => setReactionChecked(availableReaction.emoji, checked)}
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{availableReaction.title}</Row.Title>
            <ReactionStickerPreview sticker={availableReaction.staticMediaId} />
          </Row>
        )}</For>
      </Section>
    </Show>
  )
}

export default ChatReactionsTab

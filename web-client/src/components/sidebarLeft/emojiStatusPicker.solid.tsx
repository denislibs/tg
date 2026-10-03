/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/sidebarLeft/emojiStatusPicker.tsx` (812502980) —
 * `openEmojiStatusPicker({managers, anchorElement, onChosen})`: выбор своего
 * эмодзи-статуса по кнопке `.sidebar-emoji-status` шапки левой колонки
 * (`sidebarLeft/index.ts:258-269`). Взято у оригинала: повторный клик по той же
 * кнопке закрывает открытый выбор (`openPickers`, `:11`, `:20-24`), первым в
 * наборе — звезда «без статуса» (`:103-114`, выбор — `emojiStatusEmpty`,
 * `:56-62`), выбор статуса зовёт `onChosen` (`:68`) и запись статуса в
 * менеджер (`:71`), а применённое значение приходит обратно событием
 * (у нас — `rt:me`, его же слушает кнопка шапки).
 *
 * Расхождения:
 *  1. Вместо `EmoticonsDropdown` с `EmojiTab({noRegularEmoji: true})`, у якоря
 *     кнопки (`:76-87`) — попап со своей сеткой юникод-эмодзи (бывший React
 *     `components/EmojiStatusPicker.tsx`). Дропдаун эмодзи не портирован (Б-35,
 *     пачка П-6), а статус у нас — юникод-эмодзи (`emoji_status_emoticon`,
 *     `core/peers/peer.ts`), не документ кастомного эмодзи: наборов статусов
 *     (`inputStickerSetEmojiDefaultStatuses`, недавние/дефолтные статусы,
 *     недавние кастомные эмодзи — `:30-52`) на бэкенде нет. Строка бэклога Б-63.
 *  2. Запись — `managers.profile.setEmojiStatus(emoji)` (`''` — снять), а не
 *     `appUsersManager.updateEmojiStatus(emojiStatus)`.
 */
import { createSignal, For, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import classNames from '@helpers/string/classNames'
import { IconTsx } from '@components/iconTsx.solid'
import { useChatsStore } from '@stores/chatsStore'
import type { Managers } from '@/client/bootstrap'
import s from './emojiStatusPicker.module.scss'

/** Набор статусов — расхождение 1. */
const STATUS_EMOJIS = [
  '⭐', '🔥', '❤️', '😎', '🚀', '🎉', '💎', '👑',
  '🌟', '⚡', '🌈', '🍀', '☕', '🎮', '🎧', '📚',
  '💻', '✈️', '🏔️', '🌙', '🐱', '🐶', '🌸', '🎯',
]

/** Время затухания скрима (`--popup-transition-time`) с запасом — как у `PopupElement`. */
const HIDE_DURATION = 300

type Picker = { close: () => void }

const openPickers = new WeakMap<HTMLElement, Picker>()

export function openEmojiStatusPicker(options: {
  managers: Managers
  anchorElement: HTMLElement
  onChosen?: () => void
}) {
  const { managers, anchorElement } = options

  const openPicker = openPickers.get(anchorElement)
  if(openPicker) {
    openPicker.close()
    return
  }

  const current = useChatsStore.getState().me?.user.emoji_status_emoticon ?? ''
  const host = document.createElement('div')
  document.body.append(host)

  const [active, setActive] = createSignal(false)
  const [hiding, setHiding] = createSignal(false)

  const picker: Picker = {
    close: () => {
      if(openPickers.get(anchorElement) !== picker) return
      openPickers.delete(anchorElement)
      setActive(false)
      setHiding(true)
      window.setTimeout(() => {
        dispose()
        host.remove()
      }, HIDE_DURATION)
    },
  }

  const onClick = (emoji: string) => {
    picker.close()

    const noStatus = !emoji
    if(!noStatus) {
      options.onChosen?.()
    }

    void managers.profile.setEmojiStatus(emoji)
  }

  const dispose = render(() => {
    onMount(() => {
      requestAnimationFrame(() => setActive(true))
    })

    return (
      <div
        class={classNames('popup', active() && 'active', hiding() && 'hiding', s.overlay)}
        onClick={() => picker.close()}
      >
        <div class={classNames('popup-container', s.dialog)} onClick={(e) => e.stopPropagation()}>
          <div class={s.grid}>
            <div class={classNames(s.item, !current && s.itemActive)} onClick={() => onClick('')}>
              <IconTsx icon="star" class="super-emoji-premium-icon" />
            </div>
            <For each={STATUS_EMOJIS}>{(emoji) => (
              <div class={classNames(s.item, current === emoji && s.itemActive)} onClick={() => onClick(emoji)}>
                {emoji}
              </div>
            )}</For>
          </div>
        </div>
      </div>
    )
  }, host)

  openPickers.set(anchorElement, picker)
}

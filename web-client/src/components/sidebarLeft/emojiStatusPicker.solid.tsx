/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/sidebarLeft/emojiStatusPicker.tsx` (812502980, 117 строк) —
 * `openEmojiStatusPicker({managers, anchorElement, onChosen})`: выбор своего эмодзи-статуса по
 * кнопке `.sidebar-emoji-status` шапки левой колонки (`sidebarLeft/index.ts:258-269`).
 * Автономный `EmoticonsDropdown` с одной вкладкой `EmojiTab` у якоря кнопки (`getOpenPosition`,
 * `is-standalone`, `customParentElement: getOverlayRoot`, `suppressOutClick`), цвет текста
 * `primary-color`, первым в наборе — звезда «без статуса» (`:103-114`, выбор —
 * `emojiStatusEmpty`), повторный клик по кнопке закрывает открытый выбор (`openPickers`),
 * закрытый — уничтожается (`hideAndDestroy`); выбор статуса зовёт `onChosen` (анимация вокруг
 * нового статуса — `sidebarLeft/index.ts`, `fireOnNew`).
 *
 * Расхождения (статус у бэкенда — юникод-эмодзи `emoji_status_emoticon`, `PUT /me/emoji_status`,
 * а не документ своего эмодзи, Б-63):
 *  1. Вкладка — юникод-эмодзи (`EmojiTab` без `noRegularEmoji`) без своих наборов и ряда
 *     категорий (`noPacks`), а не `noRegularEmoji: true` над наборами статусов: наборов статусов
 *     (`inputStickerSetEmojiDefaultStatuses`, недавние/дефолтные статусы `:30-52`) на бэкенде нет.
 *     `mainSets` отдаёт пустой список своих эмодзи — в «своей» категории остаётся одна звезда.
 *  2. Запись — `managers.profile.setEmojiStatus(emoji)` (`''` — снять), а не
 *     `appUsersManager.updateEmojiStatus(emojiStatus)`; статус на срок (`canHaveEmojiTimer`) — нет.
 */
import type { Managers } from '@/client/bootstrap'
import { EmoticonsDropdown } from '@components/emoticonsDropdown'
import EmojiTab from '@components/emoticonsDropdown/tabs/emoji'
import Icon, { getIconContent } from '@components/icon'
import { getOverlayRoot } from '@helpers/appWindow'

const openPickers = new WeakMap<HTMLElement, EmoticonsDropdown>()

export function openEmojiStatusPicker(options: {
  managers: Managers
  anchorElement: HTMLElement
  onChosen?: () => void
}) {
  const { managers, anchorElement } = options

  const openPicker = openPickers.get(anchorElement)
  if(openPicker) {
    void openPicker.toggle(false)
    return
  }

  const emojiTab = new EmojiTab({
    managers,
    noPacks: true,
    mainSets: () => [Promise.resolve([])],
    onClick: (emoji) => {
      void emoticonsDropdown.toggle(false)

      const noStatus = getIconContent('star') === emoji.emoji
      if(!noStatus) {
        options.onChosen?.()
      }

      void managers.profile.setEmojiStatus(noStatus ? '' : emoji.emoji || '')
    },
  })

  const emoticonsDropdown = new EmoticonsDropdown({
    tabsToRender: [emojiTab],
    customParentElement: getOverlayRoot,
    suppressOutClick: true,
    getOpenPosition: () => {
      const rect = anchorElement.getBoundingClientRect()
      return {
        left: rect.left + rect.width / 2,
        top: rect.top + rect.height / 2,
      }
    },
  })

  const textColor = 'primary-color'

  emoticonsDropdown.setTextColor(textColor)

  openPickers.set(anchorElement, emoticonsDropdown)

  emoticonsDropdown.addEventListener('closed', () => {
    openPickers.delete(anchorElement)
    void emoticonsDropdown.hideAndDestroy()
  })

  emoticonsDropdown.onButtonClick()

  void emojiTab.initPromise?.then(() => {
    const emojiElement = Icon('star', 'super-emoji-premium-icon')
    emojiElement.style.color = `var(--${textColor})`

    const category = emojiTab.getCustomCategory()

    emojiTab.addEmojiToCategory({
      category,
      element: emojiElement,
      batch: false,
      prepend: true,
    })
  })
}

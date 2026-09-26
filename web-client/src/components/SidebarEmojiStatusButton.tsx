import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import EmojiStatusPicker from './EmojiStatusPicker'
import { useT } from '../i18n'

// Кнопка своего эмодзи-статуса в шапке левой колонки — порт tweb
// `sidebarLeft/index.ts` (`statusBtnIcon` + `wrapStatus`, 812502980):
// `ButtonIcon(' sidebar-emoji-status', {noRipple: true, ariaLabel: 'SetAsEmojiStatus'})`
// справа от поля поиска. Статуса нет — глиф `star` (`replaceButtonIcon(…, 'star')`
// → `span.tgico.button-icon`), есть — сам статус в `.sidebar-emoji-status-emoji`.
// Показ только у подписчика Premium решает владелец шапки (`toggleRightButtons`),
// поэтому здесь условия нет.
//
// Это вход в выбор своего статуса, и в колонке он у оригинала единственный:
// строки «Установить эмодзи-статус» в корне настроек у tweb нет.
//
// Отступления: статус у нас — юникод-эмодзи (`emoji_status_emoticon`), а не
// кастомный эмодзи-документ, поэтому вместо `wrapEmojiStatus` — текст, а вместо
// выпадающего `EmoticonsDropdown`, приякоренного к кнопке (`openEmojiStatusPicker`),
// — наш попап `EmojiStatusPicker`. Анимация `fireAroundAnimation` на смене
// статуса не портирована — ей нужен тот же документ.
export default function SidebarEmojiStatusButton({ emoji }: { emoji?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton
        noRipple
        className="sidebar-emoji-status"
        aria-label={t('SetAsEmojiStatus')}
        onClick={() => setOpen(true)}
      >
        {emoji
          ? <span className="sidebar-emoji-status-emoji">{emoji}</span>
          : <TgIcon name="star" className="button-icon" />}
      </IconButton>
      <EmojiStatusPicker open={open} onClose={() => setOpen(false)} />
    </>
  )
}

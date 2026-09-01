import { useRef, useState, type ReactNode } from 'react'
import TgIcon, { type IconName } from './TgIcon'
import Menu from '../shared/ui/Menu'
import { useT } from '../i18n'

// Пункт attach-меню — дерево tweb 1:1 (`ButtonMenuItem`, buttonMenu.ts:67-100):
//
//   div.btn-menu-item.rp-overflow
//     span.tgico.btn-menu-item-icon      ← Icon(name, 'btn-menu-item-icon')
//     span.i18n.btn-menu-item-text       ← i18n(key)
//
// Ripple tweb вешает на пункт ТОЛЬКО на мобильных (`if(IS_MOBILE) ripple(el)`),
// поэтому узла `.c-ripple` внутри нет — остаётся лишь класс-клип `.rp-overflow`.
// Живое десктопное дерево это подтверждает: docs/tweb/dom/dumps/04-attach-menu.json.
//
// Размеры/паддинги/шрифт/ховер/`active: scale(.96)` — из глобального `_button.scss`
// (секция `.btn-menu-item`), здесь ничего своего.
function AttachMenuItem({ icon, text, onClick }: { icon: IconName; text: ReactNode; onClick: () => void }) {
  return (
    <div className="btn-menu-item rp-overflow" onClick={onClick}>
      {/* Размер глифа задаёт сам пункт через --icon-size (_button.scss:257),
          поэтому передаём переменную, а не число. */}
      <TgIcon name={icon} className="btn-menu-item-icon" size="var(--icon-size)" />
      <span className="btn-menu-item-text">{text}</span>
    </div>
  )
}

export default function AttachMenu({
  anchor,
  onClose,
  onPhotoVideo,
  onFile,
  onPoll,
  onChecklist,
  onLocation,
  onContact,
}: {
  anchor: { left: number; bottom: number }
  onClose: () => void
  onPhotoVideo?: () => void
  onFile?: () => void
  onPoll?: () => void
  onChecklist?: () => void
  onLocation?: () => void
  onContact?: () => void
}) {
  const t = useT()
  // Закрытие в два шага: пункт/клик-мимо гасят open (играет exit-анимация
  // ui-kit Menu), действие пункта и анмаунт владельца — после onExitComplete.
  const [open, setOpen] = useState(true)
  const pending = useRef<(() => void) | undefined>(undefined)
  const pick = (fn?: () => void) => () => { pending.current = fn; setOpen(false) }

  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      onExitComplete={() => { onClose(); pending.current?.() }}
      // Угол раскрытия — проп `corner` (как в tweb positionMenu ставит
      // `top-right` = меню растёт ВВЕРХ от кнопки, начало трансформы снизу-слева).
      // `was-open` навешивать вручную не нужно — Menu сам ставит его вместе с
      // `active` при первом открытии и больше не снимает (см. Menu.tsx).
      corner="top-right"
      style={{ left: anchor.left, bottom: anchor.bottom }}
    >
      <AttachMenuItem icon="image" text={t('Chat.Input.Attach.PhotoOrVideo')} onClick={pick(onPhotoVideo)} />
      <AttachMenuItem icon="document" text={t('Chat.Input.Attach.Document')} onClick={pick(onFile)} />
      {onLocation && <AttachMenuItem icon="location" text={t('AttachLocation')} onClick={pick(onLocation)} />}
      {onContact && <AttachMenuItem icon="newprivate" text={t('AttachContact')} onClick={pick(onContact)} />}
      {onPoll && <AttachMenuItem icon="poll" text={t('Poll')} onClick={pick(onPoll)} />}
      {onChecklist && <AttachMenuItem icon="check" text={t('Checklist')} onClick={pick(onChecklist)} />}
    </Menu>
  )
}

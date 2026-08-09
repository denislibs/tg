// Confirm-диалог настроек (tweb confirmationPopup): заголовок, текст,
// «Отмена» + кнопка действия. Общий для «Данных и памяти», черновиков и т.п.
//
// Показ/скрытие — КЛАССЫ tweb `PopupElement` (`tweb components/popups/index.ts:357-359`
// `show()` вешает `active` после reflow, `:420-421` `destroy()` — `hiding`):
// у `.popup` анимируются opacity+visibility, у `.popup-container` —
// translate3d(x, 3rem, 0) → 0 (портированный `styles/tweb/popups/_popup.scss:29-100`).
// Владелец рендерит диалог по условию и снимает его в onClose, поэтому закрытие
// раскручивается изнутри: сначала `hiding`, и только по концу перехода —
// onConfirm/onClose (так же устроен uncontrolled-режим shared/ui/ConfirmPopup).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import { usePopupTransition } from './kit'
import s from './ConfirmDialog.module.scss'

export default function ConfirmDialog({ title, text, action, danger, zIndex, onConfirm, onClose }: {
  title: string
  text: string
  action: string
  danger?: boolean
  /** поверх полноэкранных оверлеев (медиа-редактор и т.п.); дефолт из scss */
  zIndex?: number
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(true)
  const { mounted, cls } = usePopupTransition(open)

  // Действие кнопки откладывается до конца exit-анимации: владелец снимает
  // диалог в onClose, а до этого момента узел должен доиграть переход.
  const pending = useRef<(() => void) | null>(null)
  const exit = useRef({ onConfirm, onClose })
  exit.current = { onConfirm, onClose }
  useEffect(() => {
    if (mounted) return
    if (pending.current) exit.current.onConfirm()
    exit.current.onClose()
  }, [mounted])

  const close = (confirm?: boolean) => {
    pending.current = confirm ? () => exit.current.onConfirm() : null
    setOpen(false)
  }

  if (!mounted) return null

  return createPortal(
    <div
      className={classNames('popup', cls, s.overlay)}
      style={zIndex != null ? { zIndex } : undefined}
      onClick={() => close()}
    >
      <div className={classNames('popup-container', s.card)} onClick={(e) => e.stopPropagation()}>
        <Text size={17} weight={600} color="var(--primary-text-color)" style={{ marginBottom: 8 }}>{title}</Text>
        <Text size={14.5} color="var(--secondary-text-color)">{text}</Text>
        <div className={s.actions}>
          <div className={s.action} onClick={() => close()}>{t('Cancel')}</div>
          <div className={s.action} style={danger ? { color: '#ff595a' } : undefined} onClick={() => close(true)}>
            {action}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Модалка «Новый чек-лист» — порт tweb popups/checklist.tsx (стоковый набор):
// заголовок (255) + пункты (1..30, по 255) с авто-добавлением пустой строки,
// тумблеры «Другие могут отмечать» / «Другие могут добавлять».
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgSwitch from './TgSwitch'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import { useT } from '../i18n'
import s from './CreateChecklistPopup.module.scss'

export interface NewChecklistData {
  title: string
  items: string[]
  othersCanAdd: boolean
  othersCanMark: boolean
}

const MAX_ITEMS = 30

export default function CreateChecklistPopup({ onCreate, onClose }: {
  onCreate: (c: NewChecklistData) => void
  onClose: () => void
}) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<string[]>([''])
  const [othersCanMark, setOthersCanMark] = useState(false)
  const [othersCanAdd, setOthersCanAdd] = useState(false)

  const setItem = (i: number, v: string) => {
    setItems((cur) => {
      const next = cur.slice()
      next[i] = v
      // авто-добавление пустой строки, пока меньше лимита (tweb addItem)
      if (i === next.length - 1 && v.trim() && next.length < MAX_ITEMS) next.push('')
      return next
    })
  }
  const removeItem = (i: number) => {
    setItems((cur) => {
      const next = cur.filter((_, x) => x !== i)
      while (next.length < 1) next.push('')
      return next
    })
  }

  const filled = items.map((o) => o.trim()).filter(Boolean)
  const canCreate =
    title.trim().length > 0 &&
    title.length <= 255 &&
    filled.length >= 1 &&
    filled.every((o) => o.length <= 255)

  const submit = () => {
    if (!canCreate) return
    onCreate({ title: title.trim(), items: filled, othersCanAdd, othersCanMark })
  }

  return (
    <Popup open title={t('New Checklist')} onClose={onClose} width={420} action={{ label: t('Create'), onClick: submit }}>
      <div className={s.body}>
        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Title')}</Text>
        <input
          className={s.title}
          value={title}
          maxLength={255}
          placeholder={t('Checklist Title')}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Tasks')}</Text>
        {items.map((it, i) => (
          <div key={i} className={s.itemRow}>
            <input
              className={s.item}
              value={it}
              maxLength={255}
              placeholder={i === items.length - 1 && !it ? t('Add a Task') : t('Task')}
              onChange={(e) => setItem(i, e.target.value)}
            />
            {it !== '' && (
              <IconButton size="small" onClick={() => removeItem(i)} aria-label={t('Delete')}>
                <TgIcon name="close" size={18} color="var(--tg-textSecondary)" />
              </IconButton>
            )}
          </div>
        ))}

        <div className={s.switches}>
          <div className={s.switchRow} onClick={() => setOthersCanMark((v) => !v)}>
            <Text size={15.5}>{t('Allow Others to Mark as Done')}</Text>
            <TgSwitch checked={othersCanMark} />
          </div>
          <div className={s.switchRow} onClick={() => setOthersCanAdd((v) => !v)}>
            <Text size={15.5}>{t('Allow Others to Add Tasks')}</Text>
            <TgSwitch checked={othersCanAdd} />
          </div>
        </div>
      </div>
    </Popup>
  )
}

// Попап «Новый контакт» по номеру телефона — раскладка 1:1 с tweb
// popups/createContact: кнопка «Создать» в шапке справа (accent, гаснет пока
// невалидно), слева аватар с инициалами, справа поля Имя/Фамилия, снизу — поле
// телефона с маской «+7 ─── ─── ── ──» (глобальный Input, mask). Резолв номера
// на бэке; «не зарегистрирован» → ошибка под полем.
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import Avatar from '../shared/ui/Avatar'
import { useManagers } from '../core/hooks/useManagers'
import { gradientFor } from '../core/dialogToChat'
import { useT } from '../i18n'
import s from './NewContactPopup.module.scss'

const PHONE_LEN = 10 // РФ: 10 цифр абонента после +7

export default function NewContactPopup({
  open, onClose, onExitComplete, onCreated,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  /** приватный чат с добавленным пользователем создан — открыть его */
  onCreated: (chatId: number) => void
}) {
  const managers = useManagers()
  const t = useT()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('') // только цифры абонента (без +7)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSave = first.trim().length > 0 && phone.length === PHONE_LEN && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const c = await managers.contacts.add({
        phone: `+7${phone}`,
        firstName: first.trim(),
        lastName: last.trim(),
        sharePhone: true,
      })
      const chatId = await managers.chats.createPrivate(c.userId)
      onCreated(chatId)
      onClose()
    } catch (e) {
      setSaving(false)
      // Статус приходит из бэка через RPC (worker→main): 404 — номер не
      // зарегистрирован, 403 — запрет добавления по номеру.
      const status = (e as { status?: number } | null)?.status
      if (status === 404) setError('Этот номер не зарегистрирован в мессенджере.')
      else if (status === 403) setError('Пользователь запретил добавлять себя по номеру.')
      else setError('Не удалось добавить контакт.')
    }
  }

  const initials = ((first.trim()[0] ?? '') + (last.trim()[0] ?? '')).toUpperCase()

  return (
    <Popup
      open={open}
      title="Новый контакт"
      onClose={onClose}
      onExitComplete={onExitComplete}
      width={480}
      headerRight={
        <button type="button" className={s.addBtn} disabled={!canSave} onClick={submit}>
          {saving ? t('Creating…') : t('Create')}
        </button>
      }
    >
      <div className={s.form}>
        <div className={s.row}>
          <Avatar background={gradientFor(first.length + last.length + 2)} text={initials} size={84} />
          <div className={s.names}>
            <Input label="Имя (обязательно)" value={first} onChange={setFirst} autoFocus wrapClassName={s.field} />
            <Input label="Фамилия (необязательно)" value={last} onChange={setLast} wrapClassName={s.field} />
          </div>
        </div>

        <Input
          label="Номер телефона"
          value={phone}
          onChange={(v) => { setPhone(v); setError(null) }}
          mask={{ prefix: '+7', groups: [3, 3, 2, 2] }}
          wrapClassName={s.field}
        />

        {error && (
          <Text size={14} color="var(--tg-dangerText)" className={s.error}>{error}</Text>
        )}
      </div>
    </Popup>
  )
}

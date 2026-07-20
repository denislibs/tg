// Попап «Новый контакт» по номеру телефона — порт tweb popups/createContact.tsx:
// поля Имя (обяз.), Фамилия, Телефон (обяз.); резолв номера на бэке. «Номер не
// зарегистрирован» → ошибка под полем (tweb NO_USER). При успехе открывает
// приватный чат с найденным пользователем.
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import { useManagers } from '../core/hooks/useManagers'
import { HttpError } from '../core/net/restClient'
import s from './NewContactPopup.module.scss'

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
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSave = first.trim().length > 0 && /\d/.test(phone) && !saving

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const c = await managers.contacts.add({
        phone: phone.trim(),
        firstName: first.trim(),
        lastName: last.trim(),
        sharePhone: true,
      })
      const chatId = await managers.chats.createPrivate(c.userId)
      onCreated(chatId)
      onClose()
    } catch (e) {
      setSaving(false)
      if (e instanceof HttpError && e.status === 404) setError('Этот номер не зарегистрирован в мессенджере.')
      else if (e instanceof HttpError && e.status === 403) setError('Пользователь запретил добавлять себя по номеру.')
      else setError('Не удалось добавить контакт.')
    }
  }

  return (
    <Popup
      open={open}
      title="Новый контакт"
      onClose={onClose}
      onExitComplete={onExitComplete}
      width={400}
      action={{ label: saving ? 'Создание…' : 'Создать', onClick: submit }}
    >
      <div className={s.form}>
        <Input label="Имя (обязательно)" value={first} onChange={setFirst} autoFocus wrapClassName={s.field} />
        <Input label="Фамилия (необязательно)" value={last} onChange={setLast} wrapClassName={s.field} />
        <Input label="Номер телефона" value={phone} onChange={(v) => { setPhone(v); setError(null) }} wrapClassName={s.field} />
        {error && (
          <Text size={14} color="var(--tg-dangerText)" className={s.error}>{error}</Text>
        )}
      </div>
    </Popup>
  )
}

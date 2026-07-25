// Попап «Новый контакт» по номеру телефона — раскладка 1:1 с tweb
// popups/createContact: кнопка «Создать» в шапке справа (accent, гаснет пока
// невалидно), слева аватар с инициалами, справа поля Имя/Фамилия, снизу — поле
// телефона с маской «+7 ─── ─── ── ──» (введённые цифры — белым, прочерки —
// faint). Резолв номера на бэке; «не зарегистрирован» → ошибка под полем.
import { useLayoutEffect, useRef, useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import Avatar from '../shared/ui/Avatar'
import { useManagers } from '../core/hooks/useManagers'
import { gradientFor } from '../core/dialogToChat'
import { HttpError } from '../core/net/restClient'
import { useT } from '../i18n'
import s from './NewContactPopup.module.scss'

const PHONE_GROUPS = [3, 3, 2, 2] // РФ: +7 XXX XXX XX XX (10 цифр абонента)
const PHONE_LEN = PHONE_GROUPS.reduce((a, b) => a + b, 0)

// Маска для показа: «+7 ddd ddd dd dd», незаполненные позиции — «─».
function maskDisplay(digits: string): string {
  const d = digits.slice(0, PHONE_LEN)
  const parts: string[] = []
  let idx = 0
  for (const g of PHONE_GROUPS) {
    let part = ''
    for (let i = 0; i < g; i++) { part += idx < d.length ? d[idx] : '─'; idx++ }
    parts.push(part)
  }
  return `+7 ${parts.join(' ')}`
}

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
  const phoneRef = useRef<HTMLInputElement>(null)

  const canSave = first.trim().length > 0 && phone.length === PHONE_LEN && !saving

  const display = maskDisplay(phone)
  // Каретка стоит перед первым прочерком (следующая незаполненная позиция).
  useLayoutEffect(() => {
    const el = phoneRef.current
    if (!el || document.activeElement !== el) return
    const firstDash = display.indexOf('─')
    const pos = firstDash === -1 ? display.length : firstDash
    el.setSelectionRange(pos, pos)
  }, [display])

  const onPhoneKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); setPhone((d) => d.slice(0, -1)); setError(null); return
    }
    if (/^\d$/.test(e.key)) {
      e.preventDefault(); setPhone((d) => (d.length < PHONE_LEN ? d + e.key : d)); setError(null); return
    }
    // разрешаем навигацию/Tab, блокируем прочий ввод
    if (e.key.length === 1) e.preventDefault()
  }

  const onPhonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    let d = e.clipboardData.getData('text').replace(/\D/g, '')
    if (d.startsWith('8')) d = d.slice(1)
    if (d.startsWith('7')) d = d.slice(1)
    setPhone(d.slice(0, PHONE_LEN)); setError(null)
  }

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
      if (e instanceof HttpError && e.status === 404) setError('Этот номер не зарегистрирован в мессенджере.')
      else if (e instanceof HttpError && e.status === 403) setError('Пользователь запретил добавлять себя по номеру.')
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

        {/* Телефон: прозрачный input держит каретку/клавиатуру, поверх — цветной
            дисплей (цифры белым, прочерки faint). Строки идентичны → каретка
            совпадает с видимым текстом. */}
        <div className={s.phoneField}>
          <input
            ref={phoneRef}
            className={s.phoneInput}
            value={display}
            inputMode="numeric"
            onKeyDown={onPhoneKey}
            onPaste={onPhonePaste}
            onChange={() => { /* ввод только через onKeyDown */ }}
          />
          <div className={s.phoneDisplay} aria-hidden>
            {display.split('').map((ch, i) => (
              <span key={i} className={ch === '─' ? s.dash : undefined}>{ch}</span>
            ))}
          </div>
          <label className={s.phoneLabel}>Номер телефона</label>
        </div>

        {error && (
          <Text size={14} color="var(--tg-dangerText)" className={s.error}>{error}</Text>
        )}
      </div>
    </Popup>
  )
}

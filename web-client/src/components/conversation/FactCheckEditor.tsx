// Редактор «проверки фактов» (tweb PopupFactCheck): модалка с полем текста
// (сырой markdown — сущности разбираются при сохранении, как у композера) и
// опциональным кодом страны ISO2. Открывается автором/админом канала из
// контекст-меню сообщения. Текст пользователя рендерится ТОЛЬКО как значение
// textarea (не raw HTML).
import { useState } from 'react'
import Popup from '../../shared/ui/Popup'
import Input from '../../shared/ui/Input'
import { useT } from '../../i18n'
import type { FactCheck } from '../../core/models'

interface Props {
  initial?: FactCheck
  onClose: () => void
  onSubmit: (text: string, country: string) => void
}

const MAX = 1024

export default function FactCheckEditor({ initial, onClose, onSubmit }: Props) {
  const t = useT()
  const [text, setText] = useState(initial?.text ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const trimmed = text.trim()

  return (
    <Popup
      open
      title={t('Fact Check')}
      onClose={onClose}
      onExitComplete={onClose}
      action={trimmed ? { label: t('Save'), onClick: () => onSubmit(text.slice(0, MAX), country.trim().toUpperCase()) } : undefined}
    >
      <textarea
        autoFocus
        value={text}
        maxLength={MAX}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('Add Fact or Context')}
        rows={4}
        style={{
          width: '100%', resize: 'vertical', minHeight: 88,
          padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box',
          border: '1px solid var(--tg-borderColor, rgba(0,0,0,.12))',
          background: 'transparent', color: 'var(--tg-textPrimary)',
          font: 'inherit', fontSize: 15, lineHeight: 1.4, marginBottom: 12,
        }}
      />
      <Input
        value={country}
        onChange={(v) => setCountry(v.slice(0, 2))}
        label={t('Country code (optional)')}
      />
    </Popup>
  )
}

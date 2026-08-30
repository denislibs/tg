import { useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import Button from '../../shared/ui/Button'
import Input from '../../shared/ui/Input'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import type { Birthday } from '../../core/peers/peer'
import { useT, useLang } from '../../i18n'
import { usePopupTransition } from './kit'
import s from './BirthdayModal.module.scss'

// Day/Month/Year labels kept local: the global dict's "Day" already means the
// "Day" colour theme, so reusing the key would mistranslate the field.
const DOB_LABELS: Record<string, [string, string, string]> = {
  ru: ['День', 'Месяц', 'Год'],
  uk: ['День', 'Місяць', 'Рік'],
  es: ['Día', 'Mes', 'Año'],
  de: ['Tag', 'Monat', 'Jahr'],
  fr: ['Jour', 'Mois', 'Année'],
}

// A compact "Date of birth" dialog (tweb's popup-birthday): day + month (both
// required) and an optional year. Year may be left blank.
export default function BirthdayModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: Birthday | null
  onClose: () => void
  onSave: (b: Birthday) => void
}) {
  const t = useT()
  const { mounted, cls } = usePopupTransition(open)
  const [lang] = useLang()
  const [dayLabel, monthLabel, yearLabel] = DOB_LABELS[lang] ?? ['Day', 'Month', 'Year']
  const [day, setDay] = useState(initial ? String(initial.day) : '')
  const [month, setMonth] = useState(initial ? String(initial.month) : '')
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '')

  const d = Number(day)
  const m = Number(month)
  const y = year ? Number(year) : undefined
  const thisYear = new Date().getFullYear()
  const valid =
    d >= 1 && d <= 31 && m >= 1 && m <= 12 && (y === undefined || (y >= 1900 && y <= thisYear))

  const onlyDigits = (s: string, max: number) => s.replace(/\D/g, '').slice(0, max)

  if (!mounted) return null

  return (
    <div onClick={onClose} className={classNames('popup', cls, s.overlay)}>
      <div onClick={(e) => e.stopPropagation()} className={classNames('popup-container', s.dialog)}>
        <IconButton onClick={onClose} color="var(--secondary-text-color)" className={s.close}>
          <TgIcon name="close" />
        </IconButton>

        <div className={s.hero}>
          <div className={s.heroIcon}>
            <TgIcon name="gift" size={44} color="var(--primary-color)" />
          </div>
          <Text size={20} weight={700} color="var(--primary-text-color)">
            {t('Birthday')}
          </Text>
        </div>

        <div className={s.fields}>
          <Input label={dayLabel} value={day} onChange={(v) => setDay(onlyDigits(v, 2))} inputMode="numeric" wrapClassName={s.day} />
          <Input label={monthLabel} value={month} onChange={(v) => setMonth(onlyDigits(v, 2))} inputMode="numeric" wrapClassName={s.month} />
          <Input label={yearLabel} value={year} onChange={(v) => setYear(onlyDigits(v, 4))} inputMode="numeric" wrapClassName={s.year} />
        </div>

        <Text size={14} color="var(--secondary-text-color)" style={{ textAlign: 'center', marginTop: '14px', lineHeight: 1.45 }}>
          {t('Birthday.PrivacyHint')}
        </Text>

        <Button fullWidth uppercase disabled={!valid} onClick={() => onSave({ _: 'birthday', day: d, month: m, year: y })} className={s.save}>
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}

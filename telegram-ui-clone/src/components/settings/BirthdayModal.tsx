import { useState } from 'react'
import { Box, Button, TextField, useTheme } from '@mui/material'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import type { Birthday } from '../../core/managers/authManager'
import { useT, useLang } from '../../i18n'
import { useFieldSx } from './kit'

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
  const tg = useTheme().tg
  const t = useT()
  const [lang] = useLang()
  const [dayLabel, monthLabel, yearLabel] = DOB_LABELS[lang] ?? ['Day', 'Month', 'Year']
  const fieldSx = useFieldSx()
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 80,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(92%, 420px)',
              borderRadius: 16,
              background: tg.sidebarBg,
              padding: 20,
              position: 'relative',
            }}
          >
            <IconButton onClick={onClose} color={tg.textSecondary} style={{ position: 'absolute', top: 8, left: 8 }}>
              <TgIcon name="close" />
            </IconButton>

            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5, pb: 1 }}>
              <Box
                sx={{
                  width: 86,
                  height: 86,
                  borderRadius: '50%',
                  background: tg.hover,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 1,
                }}
              >
                <TgIcon name="gift" size={44} color={tg.accent} />
              </Box>
              <Text size={20} weight={700} color={tg.textPrimary}>
                {t('Birthday')}
              </Text>
            </Box>

            <Box sx={{ display: 'flex', gap: 1.25, mt: 1.5 }}>
              <TextField
                label={dayLabel}
                value={day}
                onChange={(e) => setDay(onlyDigits(e.target.value, 2))}
                inputMode="numeric"
                sx={{ ...fieldSx, width: 90 }}
              />
              <TextField
                label={monthLabel}
                value={month}
                onChange={(e) => setMonth(onlyDigits(e.target.value, 2))}
                inputMode="numeric"
                sx={{ ...fieldSx, flex: 1 }}
              />
              <TextField
                label={yearLabel}
                value={year}
                onChange={(e) => setYear(onlyDigits(e.target.value, 4))}
                inputMode="numeric"
                sx={{ ...fieldSx, width: 100 }}
              />
            </Box>

            <Text size={14} color={tg.textSecondary} style={{ textAlign: 'center', marginTop: '14px', lineHeight: 1.45 }}>
              {t('In settings you can choose who will see your birthday.')}
            </Text>

            <Button
              fullWidth
              disabled={!valid}
              onClick={() => onSave({ day: d, month: m, year: y })}
              sx={{
                mt: 2,
                py: 1.25,
                borderRadius: '12px',
                background: tg.accent,
                color: '#fff',
                fontWeight: 600,
                textTransform: 'uppercase',
                '&:hover': { background: tg.accent, filter: 'brightness(1.05)' },
                '&.Mui-disabled': { background: tg.accent, opacity: 0.4, color: '#fff' },
              }}
            >
              {t('Save')}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

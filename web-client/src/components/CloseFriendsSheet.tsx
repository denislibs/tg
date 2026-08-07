import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import UserAvatar from './UserAvatar'
import { useT } from '../i18n'
import { useCloseFriends } from '../core/hooks/useCloseFriends'
import { useGroupCandidates } from '../core/hooks/useGroupCandidates'
import classNames from '../shared/lib/classNames'
import s from './AddStorySheet.module.scss'

/**
 * Close-friends editor (постинг-сторона, референса в tweb нет — минималистичный
 * мультивыбор «по мотивам» TG). Загружает текущий список близких друзей,
 * позволяет отметить/снять контакты (поиск по имени) и сохраняет весь список
 * целиком (useCloseFriends). Слайд-панель по образцу
 * AddStorySheet (тот же SCSS-модуль).
 */
export default function CloseFriendsSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const candidates = useGroupCandidates()
  const { selected, loaded, busy, toggle, save } = useCloseFriends(onClose)

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? candidates.filter((c) => c.name.toLowerCase().includes(q)) : candidates
  }, [candidates, query])

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 42,
        background: 'var(--surface-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className={s.header}>
        <IconButton onClick={onClose} aria-label={t('Back')} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)">
          {t('Close Friends')}
        </Text>
      </div>

      <div className={s.body}>
        <div className={s.contactsBlock} style={{ marginTop: 0 }}>
          <input
            className={s.captionInput}
            style={{ marginBottom: 8 }}
            placeholder={t('Search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={classNames(s.card, s.contactsList)}>
            {loaded && filtered.length === 0 && (
              <Text size={15} color="var(--secondary-text-color)" className={s.emptyRow}>
                {t('No contacts')}
              </Text>
            )}
            {filtered.map((c) => {
              const checked = selected.has(c.id)
              return (
                <div
                  key={c.id}
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={c.name}
                  tabIndex={0}
                  onClick={() => toggle(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.id) }
                  }}
                  className={s.contactRow}
                >
                  <UserAvatar id={c.id} name={c.name} avatarUrl={c.avatarUrl} size="sm" />
                  <Text noWrap size={16} color="var(--primary-text-color)" className={s.contactName}>
                    {c.name}
                  </Text>
                  <div className={classNames(s.check, checked ? s.checkOn : '')}>
                    {checked && <TgIcon name="check" size={16} />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <motion.div
        onClick={save}
        role="button"
        aria-label={t('Save')}
        aria-disabled={busy}
        whileHover={{ scale: busy ? 1 : 1.06 }}
        whileTap={{ scale: busy ? 1 : 0.92 }}
        className={classNames(s.fab, busy ? s.fabBusy : '')}
      >
        <TgIcon name="check" />
      </motion.div>
    </motion.div>
  )
}

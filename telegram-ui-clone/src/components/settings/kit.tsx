import type { ReactNode } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import SidebarSection from '../../shared/ui/SidebarSection'
import classNames from '../../shared/lib/classNames'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { slideInRight } from '../../motion'
import TgSwitch from '../TgSwitch'
import { useT } from '../../i18n'
import s from './kit.module.scss'

/** Full-height slide-in settings screen with a back header. */
export function SettingsScreen({
  title,
  onBack,
  headerRight,
  zIndex = 60,
  children,
}: {
  title: string
  onBack: () => void
  headerRight?: ReactNode
  zIndex?: number
  children: ReactNode
}) {
  const t = useT()
  return (
    <motion.div
      className={s.screen}
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ zIndex }}
    >
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>
          {t(title)}
        </Text>
        {headerRight}
      </div>
      <div className={s.body}>{children}</div>
    </motion.div>
  )
}

export function Section({
  caption,
  footer,
  children,
}: {
  caption?: string
  footer?: string
  children: ReactNode
}) {
  const t = useT()
  return (
    <div className={s.section}>
      {caption && (
        <Text size={14} weight={600} color="var(--tg-accent)" className={s.caption}>
          {t(caption)}
        </Text>
      )}
      <SidebarSection noMargin>{children}</SidebarSection>
      {footer && (
        <Text size={13.5} color="var(--tg-textSecondary)" className={s.footer}>
          {t(footer)}
        </Text>
      )}
    </div>
  )
}

/** List entry: avatar/icon left + title (+ subtitle) + optional remove button. */
export function EntryRow({
  left,
  title,
  sub,
  onRemove,
}: {
  left: ReactNode
  title: string
  sub?: string
  onRemove?: () => void
}) {
  return (
    <div className={s.entry}>
      {left}
      <div className={s.entryBody}>
        <Text noWrap size={16} color="var(--tg-textPrimary)">{title}</Text>
        {sub && <Text noWrap size={13.5} color="var(--tg-textSecondary)">{sub}</Text>}
      </div>
      {onRemove && (
        <TgIcon name="close" size={20} color="var(--tg-textFaint)" onClick={onRemove} style={{ cursor: 'pointer', flexShrink: 0 }} />
      )}
    </div>
  )
}

/** Generic tappable row: icon? + label (+ subtitle) + right value/chevron/toggle/check. */
export function Row({
  icon,
  label,
  sublabel,
  value,
  onClick,
  danger,
  accent,
  chevron,
  toggle,
  checked,
  selected,
  translate = true,
}: {
  icon?: ReactNode
  label: string
  sublabel?: string
  value?: string
  onClick?: () => void
  danger?: boolean
  accent?: boolean
  chevron?: boolean
  toggle?: boolean
  checked?: boolean
  selected?: boolean
  translate?: boolean
}) {
  const t = useT()
  const color = danger ? '#ff595a' : accent ? 'var(--tg-accent)' : 'var(--tg-textPrimary)'
  return (
    <div className={classNames(s.row, onClick ? s.rowClickable : '')} onClick={onClick}>
      {icon && <div className={s.rowIcon}>{icon}</div>}
      <div className={s.rowBody}>
        <Text noWrap size={16} color={color}>
          {translate ? t(label) : label}
        </Text>
        {sublabel && (
          <Text noWrap size={13.5} color="var(--tg-textSecondary)">
            {sublabel}
          </Text>
        )}
      </div>
      {value != null && (
        <Text size={15} color="var(--tg-textFaint)" className={s.rowValue}>{value}</Text>
      )}
      {toggle && <TgSwitch checked={!!checked} />}
      {selected && <TgIcon name="check" size={22} color="var(--tg-accent)" />}
      {chevron && <TgIcon name="next" size={22} color="var(--tg-textFaint)" />}
    </div>
  )
}

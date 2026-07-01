import type { ReactNode } from 'react'
import classNames from '../../lib/classNames'
import s from './Badge.module.scss'

interface BadgeProps {
  children: ReactNode
  /** muted dialogs use a gray badge instead of the accent (tweb .badge-gray) */
  muted?: boolean
  className?: string
}

// Count pill — port of tweb `.badge`. For the unread counter, group call count, etc.
export default function Badge({ children, muted, className }: BadgeProps) {
  return <span className={classNames(s.root, muted ? s.muted : '', className ?? '')}>{children}</span>
}

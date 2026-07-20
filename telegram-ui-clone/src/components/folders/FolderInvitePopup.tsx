// Попап вступления по ссылке-приглашению в папку (tweb sharedFolderInvite /
// addlist): показывает заголовок папки и список расшаренных групп/каналов с
// чекбоксами (по умолчанию выбраны все), по «Add Folder» вступает в выбранные
// чаты и получает копию папки.
import { useEffect, useState } from 'react'
import Popup from '../../shared/ui/Popup'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { Row } from '../settings/kit'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import type { FolderInvitePreviewChat } from '../../core/managers/foldersManager'

export default function FolderInvitePopup({
  slug,
  onClose,
  onJoined,
}: {
  slug: string
  onClose: () => void
  onJoined: (folderTitle: string) => void
}) {
  const t = useT()
  const managers = useManagers()
  const [open, setOpen] = useState(true)
  const [title, setTitle] = useState('')
  const [chats, setChats] = useState<FolderInvitePreviewChat[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    managers.folders
      .previewInvite(slug)
      .then((p) => {
        if (!alive) return
        setTitle(p.title)
        setChats(p.chats)
        setSelected(new Set(p.chats.map((c) => c.id)))
      })
      .catch(() => {
        if (alive) setError(t('This link is invalid or has expired.'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [managers, slug, t])

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const join = () => {
    if (busy || selected.size === 0) return
    setBusy(true)
    managers.folders
      .joinInvite(slug, [...selected])
      .then(() => {
        onJoined(title)
        setOpen(false)
      })
      .catch(() => {
        setError(t('Something went wrong'))
        setBusy(false)
      })
  }

  const action =
    !loading && !error && selected.size > 0
      ? { label: busy ? t('Adding…') : t('Add Folder'), onClick: join }
      : undefined

  return (
    <Popup
      open={open}
      title={t('Add Folder')}
      onClose={() => setOpen(false)}
      onExitComplete={onClose}
      action={action}
    >
      {loading ? (
        <Text size={15} color="var(--tg-textSecondary)" style={{ display: 'block', padding: '16px', textAlign: 'center' }}>
          {t('Loading…')}
        </Text>
      ) : error ? (
        <Text size={15} color="#ff595a" style={{ display: 'block', padding: '16px', textAlign: 'center' }}>
          {error}
        </Text>
      ) : (
        <>
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ display: 'block', padding: '4px 16px 12px' }}>
            {chats.length > 0
              ? `${t('Do you want to add')} «${title}» ${t('and join its chats?')}`
              : `${t('Do you want to add the folder')} «${title}»?`}
          </Text>
          {chats.map((c) => (
            <Row
              key={c.id}
              icon={<TgIcon name={c.type === 'channel' ? 'channel' : 'group'} size={24} color="var(--tg-accent)" />}
              label={c.title}
              sublabel={c.members > 0 ? `${c.members} ${t('members')}` : undefined}
              translate={false}
              selected={selected.has(c.id)}
              onClick={() => toggle(c.id)}
            />
          ))}
        </>
      )}
    </Popup>
  )
}

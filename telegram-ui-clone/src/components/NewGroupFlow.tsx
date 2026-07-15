// NewGroupFlow — создание группы, порт tweb createNewGroupTab: сначала
// «Добавить участников» (AppAddMembersTab: чипы выбранных в поиске, список
// контактов с чекбоксами, угловая кнопка-стрелка), затем «Новая группа»
// (AppNewGroupTab: аватар (AvatarEdit → кроппер) + имя + секция «N участников»).
import { useEffect, useMemo, useRef, useState } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import Input from '../shared/ui/Input'
import UserAvatar from './UserAvatar'
import Checkbox from '../shared/ui/Checkbox'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import AvatarCropper from './settings/AvatarCropper'
import { useT, useLang } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { useGroupCandidates, type GroupCandidate } from '../core/hooks/useGroupCandidates'
import { useChatsStore } from '../stores/chatsStore'
import { lastSeenLabel } from '../core/presence'
import s from './NewGroupFlow.module.scss'

export interface GroupPhoto {
  blob: Blob
  width: number
  height: number
}

interface Props {
  onClose: () => void
  onCreate: (name: string, memberIds: number[], photo: GroupPhoto | null) => void
}

export default function NewGroupFlow({ onClose, onCreate }: Props) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  const candidates = useGroupCandidates(managers)
  const presence = useChatsStore((st) => st.presence)
  // tweb: сначала участники (skippable), потом имя
  const [step, setStep] = useState<'members' | 'name'>('members')
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  // фото группы: файл → кроппер → blob-превью на кнопке; грузится после создания
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [photo, setPhoto] = useState<GroupPhoto | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? candidates.filter((c) => c.name.toLowerCase().includes(q)) : candidates
  }, [candidates, query])

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const next = () => {
    if (step === 'members') setStep('name')
    else if (name.trim()) onCreate(name.trim(), selected, photo)
  }
  const back = () => (step === 'members' ? onClose() : setStep('members'))
  const canNext = step === 'members' || name.trim().length > 0

  const statusOf = (id: number) => {
    const p = presence[id]
    return p?.online ? t('online') : lastSeenLabel(p?.lastSeen ?? 0, lang)
  }
  const renderAvatar = (c: GroupCandidate, size: 'md' | number) => (
    <UserAvatar id={c.id} name={c.name} avatarUrl={c.avatarUrl} size={size} />
  )

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 41,
        background: 'var(--tg-sidebarBg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className={s.header}>
        <IconButton onClick={back} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)">
          {step === 'members' ? t('Add Members') : t('New Group')}
        </Text>
      </div>

      <div className={s.stepArea}>
        <AnimatePresence mode="wait" initial={false}>
          {step === 'members' ? (
            <motion.div
              key="members"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.13, ease: [0.3, 0, 0.2, 1] }}
              className={s.step1}
            >
              {/* tweb .selector-search: чипы выбранных + поле ввода одной обёрткой */}
              <div className={s.selector}>
                <AnimatePresence initial={false}>
                  {selected.map((id) => {
                    const c = byId.get(id)
                    if (!c) return null
                    return (
                      <motion.div
                        key={id}
                        className={s.chip}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                        onClick={() => toggle(id)}
                      >
                        <div className={s.chipAvatar}>
                          {renderAvatar(c, 32)}
                          <span className={s.chipClose}>
                            <TgIcon name="close" size={16} />
                          </span>
                        </div>
                        <span className={s.chipName}>{c.name}</span>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                <input
                  autoFocus
                  className={s.selectorInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search')}
                />
              </div>

              <div className={s.list}>
                {filtered.map((c) => (
                  <div key={c.id} className={s.row} onClick={() => toggle(c.id)}>
                    <div className={s.rowCheck}>
                      <Checkbox checked={selected.includes(c.id)} shape="square" size={20} />
                    </div>
                    {renderAvatar(c, 'md')}
                    <div className={s.rowBody}>
                      <Text noWrap size={15.5} weight={600} color="var(--tg-textPrimary)">{c.name}</Text>
                      <Text noWrap size={13.5} color={presence[c.id]?.online ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                        {statusOf(c.id)}
                      </Text>
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className={s.empty}>
                    <Text size={15} color="var(--tg-textSecondary)">{t('No Results')}</Text>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="name"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.13, ease: [0.3, 0, 0.2, 1] }}
              className={s.step1}
            >
              <div className={s.card}>
                <div className={s.avatarWrap}>
                  <motion.div
                    className={s.avatarBtn}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {photoUrl ? <img className={s.avatarPreview} src={photoUrl} alt="" /> : <TgIcon name="cameraadd" size={44} />}
                  </motion.div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setCropFile(f)
                      e.target.value = ''
                    }}
                  />
                </div>
                <Input
                  autoFocus
                  label={t('Group Name')}
                  value={name}
                  onChange={setName}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                  wrapClassName={s.field}
                />
              </div>
              {selected.length > 0 && (
                <>
                  <Text size={15} weight={600} color="var(--tg-accent)" className={s.membersTitle}>
                    {`${selected.length} участников`}
                  </Text>
                  <div className={s.list}>
                    {selected.map((id) => {
                      const c = byId.get(id)
                      if (!c) return null
                      return (
                        <div key={id} className={s.row}>
                          {renderAvatar(c, 'md')}
                          <div className={s.rowBody}>
                            <Text noWrap size={15.5} weight={600} color="var(--tg-textPrimary)">{c.name}</Text>
                            <Text noWrap size={13.5} color={presence[id]?.online ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}>
                              {statusOf(id)}
                            </Text>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* угловая кнопка-стрелка (tweb btn-corner) */}
      <motion.div
        onClick={next}
        whileHover={{ scale: canNext ? 1.06 : 1 }}
        whileTap={{ scale: canNext ? 0.92 : 1 }}
        className={s.fab}
        style={{ cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.45 }}
      >
        <TgIcon name="arrow_next" />
      </motion.div>

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(blob, width, height) => {
            setCropFile(null)
            setPhoto({ blob, width, height })
            setPhotoUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev)
              return URL.createObjectURL(blob)
            })
          }}
        />
      )}
    </motion.div>
  )
}

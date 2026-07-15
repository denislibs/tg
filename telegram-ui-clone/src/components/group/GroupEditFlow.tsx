// GroupEditFlow — стек экранов редактирования группы (порт tweb sidebarRight
// editChat + под-табы chatType / chatInviteLinks / chatReactions /
// groupPermissions / chatAdministrators / chatMembers / removedUsers).
// Каркас — SettingsScreen/Section/Row (settings/kit), данные — useGroupEdit.
import { useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SettingsScreen, Section, Row, EntryRow } from '../settings/kit'
import Text from '../../shared/ui/Text'
import IconButton from '../../shared/ui/IconButton'
import Input from '../../shared/ui/Input'
import InputSearch from '../../shared/ui/InputSearch'
import Avatar from '../../shared/ui/Avatar'
import Slider from '../../shared/ui/Slider'
import Spinner from '../../shared/ui/Spinner'
import TgSwitch from '../TgSwitch'
import TgIcon from '../TgIcon'
import LottieSticker from '../LottieSticker'
import AvatarCropper from '../settings/AvatarCropper'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupEdit, PERMS, SLOWMODE_STEPS, slowmodeLabel, type EditMember, type GroupEdit } from '../../core/hooks/useGroupEdit'
import { RIGHTS } from '../../core/hooks/useGroupInfo'
import { useGroupCandidates } from '../../core/hooks/useGroupCandidates'
import UserAvatar from '../UserAvatar'
import { useAvatarSrc } from '../useAvatarSrc'
import { gradientFor } from '../../core/dialogToChat'
import type { Chat } from '../../data'
import s from './GroupEditFlow.module.scss'

const EMOJIS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🎉', '😱', '👎', '💯', '🙏']

type Sub =
  | null
  | 'type'
  | 'links'
  | 'reactions'
  | 'permissions'
  | 'admins'
  | 'members'
  | 'banned'

export default function GroupEditFlow({ chatId, chat, onClose }: { chatId: number; chat: Chat; onClose: () => void }) {
  const t = useT()
  const managers = useManagers()
  const g = useGroupEdit(chatId, managers)
  const [sub, setSub] = useState<Sub>(null)

  // Имя/описание: локальный черновик; галочка появляется при изменениях (tweb nextBtn)
  const [draft, setDraft] = useState<{ title: string; about: string } | null>(null)
  const title = draft?.title ?? g.card?.title ?? chat.name
  const about = draft?.about ?? g.card?.about ?? ''
  const dirty = draft != null && (draft.title !== (g.card?.title ?? '') || draft.about !== (g.card?.about ?? ''))
  const [saving, setSaving] = useState(false)

  // Фото: file input → кроппер → savePhoto
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const avatarSrc = useAvatarSrc(chat.avatarUrl)

  const save = async () => {
    if (!dirty || !title.trim() || saving) return
    setSaving(true)
    try {
      await g.saveInfo(title.trim(), about.trim())
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  const card = g.card
  const canChangeInfo = card != null && (card.myRole === 'creator' || card.myRole === 'admin')
  const reactionsValue =
    card?.reactionsMode === 'none' ? t('Disabled')
    : card?.reactionsMode === 'some' ? `${card.reactionsAllowed.length}/${EMOJIS.length}`
    : t('All')
  const permsCount = PERMS.filter((p) => ((card?.defaultPermissions ?? 31) & p.bit) !== 0).length

  return (
    <SettingsScreen
      title="Edit"
      onBack={onClose}
      zIndex={60}
      headerRight={
        dirty && title.trim() ? (
          <IconButton onClick={() => void save()} color="var(--tg-accent)">
            {saving ? <Spinner size={22} /> : <TgIcon name="check" />}
          </IconButton>
        ) : undefined
      }
    >
      {/* аватар + имя + описание (tweb editPeer) */}
      <Section footer="You can provide an optional description for your group.">
        <div className={s.infoCard}>
          <div className={s.avatarWrap} onClick={() => fileRef.current?.click()}>
            <Avatar size="profile" background={gradientFor(chatId)} src={avatarSrc} text={chat.avatarText} />
            <div className={s.avatarOverlay}>
              <TgIcon name="cameraadd" size={36} />
            </div>
            <input
              ref={fileRef}
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
          <Input label={t('Group Name')} value={title} onChange={(v) => setDraft({ title: v, about })} wrapClassName={s.field} />
          <Input label={t('Description')} value={about} onChange={(v) => setDraft({ title, about: v })} wrapClassName={s.field} />
        </div>
      </Section>

      {canChangeInfo && (
        <Section>
          <Row icon={<TgIcon name="lock" size={22} />} label="Group Type" value={t(card!.isPublic ? 'Public' : 'Private')} chevron onClick={() => setSub('type')} />
          <Row icon={<TgIcon name="link" size={22} />} label="Invite Links" value={String(Math.max(g.invites.length, 1))} chevron onClick={() => setSub('links')} />
          <Row icon={<TgIcon name="reactions" size={22} />} label="Reactions" value={reactionsValue} chevron onClick={() => setSub('reactions')} />
          {g.canBan && (
            <Row icon={<TgIcon name="permissions" size={22} />} label="Permissions" value={`${permsCount}/${PERMS.length}`} chevron onClick={() => setSub('permissions')} />
          )}
        </Section>
      )}

      <Section>
        <Row icon={<TgIcon name="admin" size={22} />} label="Administrators" value={String(g.admins.length)} chevron onClick={() => setSub('admins')} />
        <Row icon={<TgIcon name="newgroup" size={22} />} label="Members" value={String(card?.memberCount ?? g.members.length)} chevron onClick={() => setSub('members')} />
        {g.canBan && (
          <Row icon={<TgIcon name="deleteuser" size={22} />} label="Removed Users" value={g.bans.length ? String(g.bans.length) : t('None')} chevron onClick={() => setSub('banned')} />
        )}
      </Section>

      {canChangeInfo && (
        <Section footer="New members will see earlier messages when this is on.">
          <Row
            label="Chat history for new members"
            toggle
            checked={card?.historyForNew ?? true}
            onClick={() => void g.saveHistory(!(card?.historyForNew ?? true))}
          />
        </Section>
      )}

      <Section>
        <Row
          icon={<TgIcon name="delete" size={22} color="#ff595a" />}
          label={g.isCreator ? 'Delete and Leave Group' : 'Leave Group'}
          danger
          onClick={() => {
            void g.deleteOrLeave().then(onClose)
          }}
        />
      </Section>

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(blob, w, h) => {
            setCropFile(null)
            void g.savePhoto(blob, w, h)
          }}
        />
      )}

      <AnimatePresence>
        {sub === 'type' && <ChatTypeScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'links' && <InviteLinksScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'reactions' && <ReactionsScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'permissions' && <PermissionsScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'admins' && <AdminsScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'members' && <MembersScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'banned' && <RemovedUsersScreen g={g} onBack={() => setSub(null)} />}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// ── Тип группы (tweb chatType) ──────────────────────────────────────────────
function ChatTypeScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [isPublic, setIsPublic] = useState(!!g.card?.isPublic)
  const [username, setUsername] = useState(g.card?.username ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changed = isPublic !== !!g.card?.isPublic || (isPublic && username !== (g.card?.username ?? ''))
  const primary = g.invites[0]

  const apply = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    const res = await g.saveType(isPublic, username.trim())
    setSaving(false)
    if (res === 'ok') onBack()
    else setError(res === 'taken' ? t('This link is already taken.') : t('Invalid link.'))
  }

  return (
    <SettingsScreen
      title="Group Type"
      onBack={onBack}
      zIndex={70}
      headerRight={
        changed ? (
          <IconButton onClick={() => void apply()} color="var(--tg-accent)">
            {saving ? <Spinner size={22} /> : <TgIcon name="check" />}
          </IconButton>
        ) : undefined
      }
    >
      <Section caption="Group Type">
        <Row
          label="Private Group"
          sublabel={t('Private groups can only be joined if you were invited or have an invite link.')}
          selected={!isPublic}
          onClick={() => setIsPublic(false)}
        />
        <Row
          label="Public Group"
          sublabel={t('Public groups can be found in search, chat history is available to everyone and anyone can join.')}
          selected={isPublic}
          onClick={() => setIsPublic(true)}
        />
      </Section>

      {isPublic ? (
        <Section footer="People can share this link with others and find your group using Telegram search.">
          <div className={s.usernameWrap}>
            <Text size={16} color="var(--tg-textSecondary)">t.me/</Text>
            <input
              className={s.usernameInput}
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(null) }}
              placeholder={t('Link')}
            />
          </div>
          {error && <Text size={13.5} color="#ff595a" className={s.usernameError}>{error}</Text>}
        </Section>
      ) : (
        primary && (
          <Section footer="People can join your group by following this link. You can revoke the link any time.">
            <div className={s.linkBox} onClick={() => void navigator.clipboard.writeText(primary.url)}>
              <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>{primary.url}</Text>
            </div>
            <Row
              icon={<TgIcon name="delete" size={22} color="#ff595a" />}
              label="Revoke Link"
              danger
              onClick={() => {
                void g.revokeInvite(primary.token).then(() => g.createInvite())
              }}
            />
          </Section>
        )
      )}
    </SettingsScreen>
  )
}

// ── Пригласительные ссылки (tweb chatInviteLinks, уточка UtyanLinks) ─────────
function InviteLinksScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (token: string, url: string) => {
    void navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 1500)
  }
  const primary = g.invites[0]
  const extra = g.invites.slice(1)

  return (
    <SettingsScreen title="Invite Links" onBack={onBack} zIndex={70}>
      <div className={s.duck}>
        <LottieSticker name="UtyanLinks" size={120} loop />
        <Text size={14.5} color="var(--tg-textSecondary)" className={s.duckCaption}>
          {t('Anyone who has Telegram installed will be able to join your group by following this link.')}
        </Text>
      </div>

      <Section caption="Invite Link">
        {primary ? (
          <>
            <div className={s.linkBox} onClick={() => copy(primary.token, primary.url)}>
              <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>{primary.url}</Text>
              <Text size={13} color={copied === primary.token ? 'var(--tg-accent)' : 'var(--tg-textFaint)'}>
                {copied === primary.token ? t('Link copied to clipboard.') : t('Copy Link')}
              </Text>
            </div>
            <Row
              icon={<TgIcon name="delete" size={22} color="#ff595a" />}
              label="Revoke Link"
              danger
              onClick={() => void g.revokeInvite(primary.token).then(() => g.createInvite())}
            />
          </>
        ) : (
          <Row icon={<TgIcon name="plus" size={22} color="var(--tg-accent)" />} label="Create a New Link" accent onClick={() => void g.createInvite()} />
        )}
      </Section>

      <Section
        caption="Additional Links"
        footer="You can create additional invite links and revoke them at any time."
      >
        <Row icon={<TgIcon name="plus" size={22} color="var(--tg-accent)" />} label="Create a New Link" accent onClick={() => void g.createInvite()} />
        {extra.map((l) => (
          <EntryRow
            key={l.token}
            left={<TgIcon name="link" size={22} color="var(--tg-textFaint)" />}
            title={l.url.replace(/^https?:\/\//, '')}
            sub={copied === l.token ? t('Link copied to clipboard.') : l.requiresApproval ? t('Approve new members') : undefined}
            onRemove={() => void g.revokeInvite(l.token)}
          />
        ))}
      </Section>
    </SettingsScreen>
  )
}

// ── Реакции (tweb chatReactions) ─────────────────────────────────────────────
function ReactionsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const [mode, setMode] = useState<'all' | 'some' | 'none'>(g.card?.reactionsMode ?? 'all')
  const [allowed, setAllowed] = useState<string[]>(g.card?.reactionsAllowed ?? [])

  const apply = (m: 'all' | 'some' | 'none', list: string[]) => {
    setMode(m)
    setAllowed(list)
    void g.saveReactions(m, m === 'some' ? list : [])
  }
  const caption =
    mode === 'all' ? 'Members of this group can use any emoji as reactions to messages.'
    : mode === 'some' ? 'You can select emoji that will allow members of this group to react to messages.'
    : 'Members of this group cannot react to messages.'

  return (
    <SettingsScreen title="Reactions" onBack={onBack} zIndex={70}>
      <Section caption="Available reactions" footer={caption}>
        <Row label="All reactions" selected={mode === 'all'} onClick={() => apply('all', allowed)} />
        <Row label="Some reactions" selected={mode === 'some'} onClick={() => apply('some', allowed.length ? allowed : ['👍', '👎'])} />
        <Row label="No reactions" selected={mode === 'none'} onClick={() => apply('none', allowed)} />
      </Section>
      {mode === 'some' && (
        <Section caption="Only allow these reactions">
          {EMOJIS.map((e) => {
            const on = allowed.includes(e)
            return (
              <div key={e} className={s.emojiRow} onClick={() => apply('some', on ? allowed.filter((x) => x !== e) : [...allowed, e])}>
                <span className={s.emoji}>{e}</span>
                <TgSwitch checked={on} />
              </div>
            )
          })}
        </Section>
      )}
    </SettingsScreen>
  )
}

// ── Разрешения (tweb groupPermissions: 5 toggle'ов + slowmode) ───────────────
function PermissionsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const [perms, setPerms] = useState(g.card?.defaultPermissions ?? 31)
  const [slowIdx, setSlowIdx] = useState(Math.max(0, SLOWMODE_STEPS.indexOf(g.card?.slowmodeSeconds ?? 0)))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // изменения сохраняются с коротким дебаунсом (tweb батчит галочкой; здесь — авто)
  const push = (nextPerms: number, nextIdx: number) => {
    setPerms(nextPerms)
    setSlowIdx(nextIdx)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void g.savePermissions(nextPerms, SLOWMODE_STEPS[nextIdx]), 400)
  }

  return (
    <SettingsScreen title="Permissions" onBack={onBack} zIndex={70}>
      <Section caption="What can members of this group do?">
        {PERMS.map((p) => (
          <Row
            key={p.bit}
            label={p.label}
            toggle
            checked={(perms & p.bit) !== 0}
            onClick={() => push(perms ^ p.bit, slowIdx)}
          />
        ))}
      </Section>
      <Section caption="Slow Mode" footer="Choose how often members of the group are able to send messages.">
        <div className={s.slowmode}>
          <div className={s.slowLabels}>
            {SLOWMODE_STEPS.map((sec, i) => (
              <span key={sec} className={i === slowIdx ? s.slowActive : undefined}>{slowmodeLabel(sec)}</span>
            ))}
          </div>
          <Slider min={0} max={SLOWMODE_STEPS.length - 1} step={1} value={slowIdx} onChange={(v) => push(perms, v)} />
        </div>
      </Section>
    </SettingsScreen>
  )
}

// ── Администраторы (tweb chatAdministrators + userPermissions/EditAdmin) ─────
function AdminsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<EditMember | null>(null)
  const [picking, setPicking] = useState(false)
  const list = useMemo(
    () => g.admins.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.admins, q],
  )
  const candidates = useMemo(() => g.members.filter((m) => m.role === 'member'), [g.members])

  return (
    <SettingsScreen title="Administrators" onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Section>
        {g.canManageAdmins && (
          <Row icon={<TgIcon name="adduser" size={22} color="var(--tg-accent)" />} label="Add Admin" accent onClick={() => setPicking(true)} />
        )}
        {list.map((m) => (
          <div key={m.userId} className={s.memberRow} onClick={() => g.canManageAdmins && m.role !== 'creator' && setEditing(m)}>
            <UserAvatar id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--tg-textPrimary)">{m.name}</Text>
              <Text noWrap size={14} color="var(--tg-textSecondary)">
                {t(m.role === 'creator' ? 'Owner' : 'Admin')}
              </Text>
            </div>
          </div>
        ))}
      </Section>

      <AnimatePresence>
        {picking && (
          <MemberPicker
            title="Add Admin"
            members={candidates}
            onBack={() => setPicking(false)}
            onPick={(m) => {
              setPicking(false)
              setEditing(m)
            }}
          />
        )}
        {editing && (
          <AdminRightsScreen
            member={editing}
            onBack={() => setEditing(null)}
            onSave={(bits) => {
              void g.promote(editing.userId, bits).then(() => setEditing(null))
            }}
            onDismiss={editing.role === 'admin' ? () => void g.demote(editing.userId).then(() => setEditing(null)) : undefined}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// экран прав админа (tweb EditAdmin «What can this admin do?»)
function AdminRightsScreen({
  member, onBack, onSave, onDismiss,
}: {
  member: EditMember
  onBack: () => void
  onSave: (bits: number) => void
  onDismiss?: () => void
}) {
  const [bits, setBits] = useState(255) // все права по умолчанию

  return (
    <SettingsScreen
      title="Admin Rights"
      onBack={onBack}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => onSave(bits)} color="var(--tg-accent)">
          <TgIcon name="check" />
        </IconButton>
      }
    >
      <Section>
        <div className={s.memberRow}>
          <UserAvatar id={member.userId} name={member.name} avatarUrl={member.avatarUrl} />
          <div className={s.memberBody}>
            <Text noWrap size={16} color="var(--tg-textPrimary)">{member.name}</Text>
          </div>
        </div>
      </Section>
      <Section caption="What can this admin do?">
        {RIGHTS.map((r) => (
          <Row
            key={r.bit}
            label={r.label}
            translate={false}
            toggle
            checked={(bits & r.bit) !== 0}
            onClick={() => setBits((b) => b ^ r.bit)}
          />
        ))}
      </Section>
      {onDismiss && (
        <Section>
          <Row icon={<TgIcon name="deleteuser" size={22} color="#ff595a" />} label="Dismiss Admin" danger onClick={onDismiss} />
        </Section>
      )}
    </SettingsScreen>
  )
}

// ── Участники (tweb chatMembers) ─────────────────────────────────────────────
function MembersScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const candidates = useGroupCandidates(managers)
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const list = useMemo(
    () => g.members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.members, q],
  )
  const memberIds = useMemo(() => new Set(g.members.map((m) => m.userId)), [g.members])
  const addable = useMemo(
    () => candidates.filter((c) => !memberIds.has(c.id)).map((c) => ({ userId: c.id, name: c.name, avatarUrl: c.avatarUrl, role: 'member', rights: 0 })),
    [candidates, memberIds],
  )

  return (
    <SettingsScreen title="Members" onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Section>
        <Row icon={<TgIcon name="adduser" size={22} color="var(--tg-accent)" />} label="Add Members" accent onClick={() => setPicking(true)} />
        {list.map((m) => (
          <div key={m.userId} className={s.memberRow}>
            <UserAvatar id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--tg-textPrimary)">{m.name}</Text>
              <Text noWrap size={14} color="var(--tg-textSecondary)">
                {t(m.role === 'creator' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member')}
              </Text>
            </div>
            {g.canBan && m.role !== 'creator' && (
              <>
                <IconButton size="small" color="var(--tg-textFaint)" onClick={() => void g.kick(m.userId)} title={t('Remove from group')}>
                  <TgIcon name="close" size={20} />
                </IconButton>
                <IconButton size="small" color="#ff595a" onClick={() => void g.ban(m.userId)} title={t('Ban and remove from group')}>
                  <TgIcon name="deleteuser" size={20} />
                </IconButton>
              </>
            )}
          </div>
        ))}
      </Section>

      <AnimatePresence>
        {picking && (
          <MemberPicker
            title="Add Members"
            members={addable}
            onBack={() => setPicking(false)}
            onPick={(m) => {
              setPicking(false)
              void g.addMember(m.userId)
            }}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// ── Чёрный список (tweb removedUsers, уточка UtyanSearch при пустоте) ────────
function RemovedUsersScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const list = useMemo(
    () => g.bans.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())),
    [g.bans, q],
  )
  const bannable = useMemo(
    () => g.members.filter((m) => m.role === 'member'),
    [g.members],
  )

  return (
    <SettingsScreen title="Removed Users" onBack={onBack} zIndex={70}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Text size={13.5} color="var(--tg-textSecondary)" className={s.bansCaption}>
        {t('Users removed by group admins cannot rejoin via invite links.')}
      </Text>
      {list.length === 0 ? (
        <div className={s.duck}>
          <LottieSticker name="UtyanSearch" size={120} />
          <Text size={17} weight={600} color="var(--tg-textPrimary)">{t('No Results')}</Text>
          <Text size={14.5} color="var(--tg-textSecondary)">{t('Try searching.')}</Text>
        </div>
      ) : (
        <Section>
          {list.map((b) => (
            <div key={b.userId} className={s.memberRow}>
              <UserAvatar id={b.userId} name={b.name} avatarUrl={b.avatarUrl} />
              <div className={s.memberBody}>
                <Text noWrap size={16} color="var(--tg-textPrimary)">{b.name}</Text>
              </div>
              <IconButton size="small" color="var(--tg-accent)" onClick={() => void g.unban(b.userId)} title={t('Unban')}>
                <TgIcon name="close" size={20} />
              </IconButton>
            </div>
          ))}
        </Section>
      )}

      {g.canBan && (
        <div className={s.fab} onClick={() => setPicking(true)}>
          <TgIcon name="adduser" />
        </div>
      )}

      <AnimatePresence>
        {picking && (
          <MemberPicker
            title="Removed Users"
            members={bannable}
            onBack={() => setPicking(false)}
            onPick={(m) => {
              setPicking(false)
              void g.ban(m.userId)
            }}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// ── общий пикер участника (для «добавить админа/участника/в чёрный список») ──
function MemberPicker({
  title, members, onBack, onPick,
}: {
  title: string
  members: EditMember[]
  onBack: () => void
  onPick: (m: EditMember) => void
}) {
  const t = useT()
  const [q, setQ] = useState('')
  const list = useMemo(
    () => members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())),
    [members, q],
  )
  return (
    <SettingsScreen title={title} onBack={onBack} zIndex={80}>
      <div className={s.search}><InputSearch value={q} onChange={setQ} placeholder={t('Search')} /></div>
      <Section>
        {list.length === 0 && (
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: 12 }}>{t('No Results')}</Text>
        )}
        {list.map((m) => (
          <div key={m.userId} className={s.memberRow} onClick={() => onPick(m)}>
            <UserAvatar id={m.userId} name={m.name} avatarUrl={m.avatarUrl} />
            <div className={s.memberBody}>
              <Text noWrap size={16} color="var(--tg-textPrimary)">{m.name}</Text>
            </div>
          </div>
        ))}
      </Section>
    </SettingsScreen>
  )
}

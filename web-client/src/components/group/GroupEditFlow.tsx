// GroupEditFlow — корневой экран редактирования группы И канала (порт tweb
// sidebarRight editChat). Диспетчер: главный экран (аватар/имя/описание + строки
// разделов) + стек под-экранов в screens/ (chatType / chatInviteLinks /
// chatReactions / chatDiscussion / groupPermissions / chatAdministrators /
// chatMembers / removedUsers / restricted). Один компонент под оба типа:
// isChannel = chat.type === 'channel'. Каркас — SettingsScreen/Section/Row
// (settings/kit), данные — useGroupEdit.
import { useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SettingsScreen, Section, Row } from '../settings/kit'
import IconButton from '../../shared/ui/IconButton'
import Input from '../../shared/ui/Input'
import Avatar from '../../shared/ui/Avatar'
import Spinner from '../../shared/ui/Spinner'
import TgIcon from '../TgIcon'
import AvatarCropper from '../settings/AvatarCropper'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { useGroupEdit, PERMS } from '../../core/hooks/useGroupEdit'
import { useAvatarSrc } from '../useAvatarSrc'
import { gradientFor } from '../../core/dialogToChat'
import { loadChats } from '../../stores/chatsStore'
import type { Chat } from '../../data'
import { EMOJIS } from './screens/shared'
import { ChatTypeScreen } from './screens/ChatTypeScreen'
import { InviteLinksScreen } from './screens/InviteLinkScreens'
import { ReactionsScreen } from './screens/ReactionsScreen'
import { DiscussionScreen } from './screens/DiscussionScreen'
import { PermissionsScreen } from './screens/PermissionsScreen'
import { AdminsScreen } from './screens/AdminScreens'
import { MembersScreen } from './screens/MembersScreen'
import { RemovedUsersScreen, RestrictedUsersScreen } from './screens/MemberScreens'
import s from './GroupEditFlow.module.scss'

type Sub =
  | null
  | 'type'
  | 'links'
  | 'reactions'
  | 'discussion'
  | 'permissions'
  | 'admins'
  | 'members'
  | 'banned'
  | 'restricted'

export default function GroupEditFlow({ chatId, chat, onClose }: { chatId: number; chat: Chat; onClose: () => void }) {
  const t = useT()
  const managers = useManagers()
  const g = useGroupEdit(chatId)
  const [sub, setSub] = useState<Sub>(null)
  const isChannel = chat.type === 'channel'

  // Имя/описание: локальный черновик; галочка появляется при изменениях (tweb nextBtn)
  const [draft, setDraft] = useState<{ title: string; about: string } | null>(null)
  const title = draft?.title ?? g.card?.title ?? chat.name
  const about = draft?.about ?? g.card?.about ?? ''
  const dirty = draft != null && (draft.title !== (g.card?.title ?? '') || draft.about !== (g.card?.about ?? ''))
  const [saving, setSaving] = useState(false)

  // Форум-топики группы («Обсуждения»): оптимистичный тумблер + refresh стора.
  const [forumOn, setForumOn] = useState(!!chat.isForum)
  const toggleForum = () => {
    const next = !forumOn
    setForumOn(next)
    void managers.groups.setForum(chatId, next)
      .then(() => loadChats(managers))
      .catch(() => setForumOn(!next))
  }

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
  const activeInvites = g.invites.filter((l) => !l.revoked)
  const linkedId = card?.discussionChatId ?? 0

  return (
    <SettingsScreen
      title="Edit"
      onBack={onClose}
      zIndex={60}
      headerRight={
        dirty && title.trim() ? (
          <IconButton onClick={() => void save()} color="var(--primary-color)">
            {saving ? <Spinner size={22} /> : <TgIcon name="check" />}
          </IconButton>
        ) : undefined
      }
    >
      {/* аватар + имя + описание (tweb editPeer) */}
      <Section footer={isChannel ? 'You can provide an optional description for your channel.' : 'You can provide an optional description for your group.'}>
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
          <Input label={t(isChannel ? 'Channel name' : 'Group Name')} value={title} onChange={(v) => setDraft({ title: v, about })} wrapClassName={s.field} />
          <Input label={t('Description')} value={about} onChange={(v) => setDraft({ title, about: v })} wrapClassName={s.field} />
        </div>
      </Section>

      {canChangeInfo && (
        <Section>
          <Row icon={<TgIcon name="lock" size={22} />} label={isChannel ? 'Channel Type' : 'Group Type'} value={t(card!.isPublic ? 'Public' : 'Private')} chevron onClick={() => setSub('type')} />
          <Row icon={<TgIcon name="link" size={22} />} label="Invite Links" value={String(Math.max(activeInvites.length, 1))} chevron onClick={() => setSub('links')} />
          <Row icon={<TgIcon name="reactions" size={22} />} label="Reactions" value={reactionsValue} chevron onClick={() => setSub('reactions')} />
          {isChannel && (
            <Row icon={<TgIcon name="comments" size={22} />} label="Discussion" value={linkedId ? undefined : t('Add')} chevron onClick={() => setSub('discussion')} />
          )}
          {!isChannel && g.canBan && (
            <Row icon={<TgIcon name="permissions" size={22} />} label="Permissions" value={`${permsCount}/${PERMS.length}`} chevron onClick={() => setSub('permissions')} />
          )}
        </Section>
      )}

      <Section>
        <Row icon={<TgIcon name="admin" size={22} />} label="Administrators" value={String(g.admins.length)} chevron onClick={() => setSub('admins')} />
        <Row icon={<TgIcon name="newgroup" size={22} />} label={isChannel ? 'Subscribers' : 'Members'} value={String(card?.memberCount ?? g.members.length)} chevron onClick={() => setSub('members')} />
        {!isChannel && g.canBan && (
          <Row icon={<TgIcon name="permissions" size={22} />} label="Restricted Users" value={g.restricted.length ? String(g.restricted.length) : t('None')} chevron onClick={() => setSub('restricted')} />
        )}
        {g.canBan && (
          <Row icon={<TgIcon name="deleteuser" size={22} />} label="Removed Users" value={g.bans.length ? String(g.bans.length) : t('None')} chevron onClick={() => setSub('banned')} />
        )}
      </Section>

      {/* Sign Messages (только канал, tweb isBroadcast && canPostMessages) */}
      {isChannel && canChangeInfo && card && (
        <Section footer={card.signatureProfiles ? 'Add names and photos of admins to the messages they post, linking to their profiles.' : 'Add names of admins to the messages they post'}>
          <Row
            label="Sign Messages"
            toggle
            checked={card.signatures}
            onClick={() => void g.saveSignatures(!card.signatures, !card.signatures && card.signatureProfiles)}
          />
          {card.signatures && (
            <Row
              label="Show Authors' Profiles"
              toggle
              checked={card.signatureProfiles}
              onClick={() => void g.saveSignatures(true, !card.signatureProfiles)}
            />
          )}
        </Section>
      )}

      {/* Обсуждения (форум-топики) — только группа (перенесено из info-панели) */}
      {!isChannel && canChangeInfo && (
        <Section footer="Group members can discuss different topics in separate threads.">
          <Row
            icon={<TgIcon name="comments" size={22} />}
            label="Обсуждения"
            translate={false}
            toggle
            checked={forumOn}
            onClick={toggleForum}
          />
        </Section>
      )}

      {/* «Chat history for new members» — только группа */}
      {!isChannel && canChangeInfo && (
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
          label={isChannel ? 'Delete Channel' : g.isCreator ? 'Delete and Leave Group' : 'Leave Group'}
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
        {sub === 'type' && <ChatTypeScreen g={g} isChannel={isChannel} onBack={() => setSub(null)} />}
        {sub === 'links' && <InviteLinksScreen g={g} isChannel={isChannel} onBack={() => setSub(null)} />}
        {sub === 'reactions' && <ReactionsScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'discussion' && <DiscussionScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'permissions' && <PermissionsScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'admins' && <AdminsScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'members' && <MembersScreen g={g} isChannel={isChannel} onBack={() => setSub(null)} />}
        {sub === 'banned' && <RemovedUsersScreen g={g} onBack={() => setSub(null)} />}
        {sub === 'restricted' && <RestrictedUsersScreen g={g} onBack={() => setSub(null)} />}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// GroupEditFlow — корневой экран редактирования группы И канала (порт tweb
// sidebarRight editChat). Диспетчер: главный экран (аватар/имя/описание + строки
// разделов) + стек под-экранов в screens/ (chatType / chatInviteLinks /
// chatReactions / chatDiscussion / groupPermissions / chatAdministrators /
// chatMembers / removedUsers / restricted). Один компонент под оба типа:
// isChannel = chat.type === 'channel'. Каркас — SettingsScreen/Section/Row
// (settings/kit), данные — useGroupEdit.
import { useRef, useState } from 'react'
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
import { allowedMemberPerms, hasRights } from '../../core/peers/rights'
import { getLinkedChatPeerId } from '../../core/peers/peer'
import { isPublic as chatIsPublic } from '../../core/peers/predicates'
import { useMediaUrl } from '../../core/hooks/useMediaUrl'
import { gradientFor } from '../../core/dialogToChat'
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
  const title = draft?.title ?? g.card?.chat.title ?? chat.name
  const about = draft?.about ?? g.card?.fullChat.about ?? ''
  const dirty = draft != null && (draft.title !== (g.card?.chat.title ?? '') || draft.about !== (g.card?.fullChat.about ?? ''))
  const [saving, setSaving] = useState(false)

  // Форум-топики группы («Обсуждения»): оптимистичный тумблер + refresh стора.
  const [forumOn, setForumOn] = useState(!!chat.isForum)
  const toggleForum = () => {
    const next = !forumOn
    setForumOn(next)
    void managers.groups.setForum(chatId, next)
      .then(() => managers.dialogs.refresh())
      .catch(() => setForumOn(!next))
  }

  // Фото: file input → кроппер → savePhoto
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const avatarSrc = useMediaUrl(chat.photoId ?? null)

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
  // Право менять инфо — вопрос к конструктору (`hasRights`), а не к строке
  // `my_role`, которой на проводе больше нет.
  const canChangeInfo = hasRights(card?.chat, 'change_info')
  const reactions = card?.fullChat.available_reactions
  const reactionsValue =
    reactions?._ === 'chatReactionsNone' ? t('Checkbox.Disabled')
    : reactions?._ === 'chatReactionsSome' ? `${reactions.reactions.length}/${EMOJIS.length}`
    : t('FilterAllChatsShort')
  // ⚠ `default_banned_rights` это ЗАПРЕТЫ; перевод в наш битмаск «что можно» —
  // единственный, в `allowedMemberPerms`.
  const allowedPerms = allowedMemberPerms(card?.chat)
  const permsCount = PERMS.filter((p) => (allowedPerms & p.bit) !== 0).length
  const activeInvites = g.invites.filter((l) => !l.revoked)
  const linkedId = getLinkedChatPeerId(card?.fullChat)
  // «История видна новым участникам» и `hidden_prehistory` схемы — ОДНО И ТО ЖЕ
  // свойство с ПРОТИВОПОЛОЖНЫМ знаком; инверсия читается ровно здесь.
  const historyForNew = !card?.fullChat.pFlags?.hidden_prehistory

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
      sub={
        sub === 'type' ? <ChatTypeScreen g={g} isChannel={isChannel} onBack={() => setSub(null)} /> :
        sub === 'links' ? <InviteLinksScreen g={g} isChannel={isChannel} onBack={() => setSub(null)} /> :
        sub === 'reactions' ? <ReactionsScreen g={g} onBack={() => setSub(null)} /> :
        sub === 'discussion' ? <DiscussionScreen g={g} onBack={() => setSub(null)} /> :
        sub === 'permissions' ? <PermissionsScreen g={g} onBack={() => setSub(null)} /> :
        sub === 'admins' ? <AdminsScreen g={g} onBack={() => setSub(null)} /> :
        sub === 'members' ? <MembersScreen g={g} isChannel={isChannel} onBack={() => setSub(null)} /> :
        sub === 'banned' ? <RemovedUsersScreen g={g} onBack={() => setSub(null)} /> :
        sub === 'restricted' ? <RestrictedUsersScreen g={g} onBack={() => setSub(null)} /> :
        null
      }
    >
      {/* аватар + имя + описание (tweb editPeer) */}
      {/* Шапка редактирования 1:1 с дампом 15-right-12: кликабельный
          `.avatar-edit` с иконкой-камерой поверх аватара, ниже — секция
          `no-delimiter` с `.input-wrapper` (имя + описание) и подписью
          `.sidebar-left-section-caption`. */}
      {/* `.avatar-edit` центрируется сам — `.page-chats .avatar-edit
          { margin: 1rem auto 2rem }` (styles/tweb/pages/_chats.scss:40-45),
          своей обёртки в оригинале нет. */}
      <div className="avatar-edit" onClick={() => fileRef.current?.click()}>
          <Avatar size="profile" background={gradientFor(chatId)} src={avatarSrc} text={chat.avatarText} />
          <span className="tgico avatar-edit-icon">
            <TgIcon name="cameraadd" size={36} />
          </span>
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
      <div className="sidebar-left-section-container">
        <div className="sidebar-left-section no-delimiter">
          <div className="sidebar-left-section-content">
            <div className="input-wrapper">
              <Input label={t(isChannel ? 'Channel name' : 'Group Name')} value={title} onChange={(v) => setDraft({ title: v, about })} />
              <Input label={t('DescriptionPlaceholder')} value={about} onChange={(v) => setDraft({ title, about: v })} />
            </div>
          </div>
          <div className="sidebar-left-section-content sidebar-left-section-caption">
            {t(isChannel ? 'You can provide an optional description for your channel.' : 'You can provide an optional description for your group.')}
          </div>
        </div>
      </div>

      {canChangeInfo && (
        <Section>
          <Row icon={<TgIcon name="lock" size={22} />} label={isChannel ? 'Channel Type' : 'Group Type'} value={t(chatIsPublic(card?.chat) ? 'Public' : 'Private')} onClick={() => setSub('type')} />
          <Row icon={<TgIcon name="link" size={22} />} label="Invite Links" value={String(Math.max(activeInvites.length, 1))} onClick={() => setSub('links')} />
          <Row icon={<TgIcon name="reactions" size={22} />} label="Reactions" value={reactionsValue} onClick={() => setSub('reactions')} />
          {isChannel && (
            <Row icon={<TgIcon name="comments" size={22} />} label="Discussion" value={linkedId ? undefined : t('Add')} onClick={() => setSub('discussion')} />
          )}
          {!isChannel && g.canBan && (
            <Row icon={<TgIcon name="permissions" size={22} />} label="Permissions" value={`${permsCount}/${PERMS.length}`} onClick={() => setSub('permissions')} />
          )}
        </Section>
      )}

      <Section>
        <Row icon={<TgIcon name="admin" size={22} />} label="Administrators" value={String(g.admins.length)} onClick={() => setSub('admins')} />
        <Row icon={<TgIcon name="newgroup" size={22} />} label={isChannel ? 'Subscribers' : 'Members'} value={String(card?.chat.participants_count ?? g.members.length)} onClick={() => setSub('members')} />
        {!isChannel && g.canBan && (
          <Row icon={<TgIcon name="permissions" size={22} />} label="Restricted Users" value={g.restricted.length ? String(g.restricted.length) : t('BlockedEmpty')} onClick={() => setSub('restricted')} />
        )}
        {g.canBan && (
          <Row icon={<TgIcon name="deleteuser" size={22} />} label="Removed Users" value={g.bans.length ? String(g.bans.length) : t('BlockedEmpty')} onClick={() => setSub('banned')} />
        )}
      </Section>

      {/* Sign Messages (только канал, tweb isBroadcast && canPostMessages) */}
      {isChannel && canChangeInfo && card && (() => {
        // Флаг схемы «выключен» — это ОТСУТСТВИЕ ключа в `pFlags`, а не `false`
        // (правило фазы 0), поэтому здесь он приводится к булеву один раз.
        const signatures = !!card.chat.pFlags?.signatures
        const signatureProfiles = !!card.chat.pFlags?.signature_profiles
        return (
        <Section footer={signatureProfiles ? 'Add names and photos of admins to the messages they post, linking to their profiles.' : 'Add names of admins to the messages they post'}>
          <Row
            label="Sign Messages"
            toggle
            checked={signatures}
            onClick={() => void g.saveSignatures(!signatures, !signatures && signatureProfiles)}
          />
          {signatures && (
            <Row
              label="Show Authors' Profiles"
              toggle
              checked={signatureProfiles}
              onClick={() => void g.saveSignatures(true, !signatureProfiles)}
            />
          )}
        </Section>
        )
      })()}

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

      {/* «Chat history for new members» — только группа. tweb рисует эту строку
          КВАДРАТНЫМ чекбоксом, а не тумблером (дамп `15-right-12-edit-group`:
          `label.rp.row.no-subtitle.row-with-padding` > `div.row-title` +
          `label.checkbox-field.checkbox-without-caption`). */}
      {!isChannel && canChangeInfo && (
        <Section footer="New members will see earlier messages when this is on.">
          <Row
            label="Chat history for new members"
            checkbox
            checked={historyForNew}
            onClick={() => void g.saveHistory(!historyForNew)}
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

    </SettingsScreen>
  )
}

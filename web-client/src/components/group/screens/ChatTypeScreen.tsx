// group/screens/ChatTypeScreen.tsx
// Тип чата (tweb chatType): приватный/публичный + @username, для группы и канала.
import { useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import IconButton from '../../../shared/ui/IconButton'
import Spinner from '../../../shared/ui/Spinner'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import type { GroupEdit } from '../../../core/hooks/useGroupEdit'
import s from '../GroupEditFlow.module.scss'

export function ChatTypeScreen({ g, isChannel, onBack }: { g: GroupEdit; isChannel: boolean; onBack: () => void }) {
  const t = useT()
  const [isPublic, setIsPublic] = useState(!!g.card?.isPublic)
  const [username, setUsername] = useState(g.card?.username ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changed = isPublic !== !!g.card?.isPublic || (isPublic && username !== (g.card?.username ?? ''))
  const primary = g.invites.find((l) => !l.revoked)

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
      title={isChannel ? 'Channel Type' : 'Group Type'}
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
      <Section caption={isChannel ? 'Channel Type' : 'Group Type'}>
        <Row
          label={isChannel ? 'Private Channel' : 'Private Group'}
          sublabel={isChannel
            ? t('Private channels can only be joined via an invite link.')
            : t('Private groups can only be joined if you were invited or have an invite link.')}
          selected={!isPublic}
          onClick={() => setIsPublic(false)}
        />
        <Row
          label={isChannel ? 'Public Channel' : 'Public Group'}
          sublabel={isChannel
            ? t('Public channels can be found in search and anyone can join.')
            : t('Public groups can be found in search, chat history is available to everyone and anyone can join.')}
          selected={isPublic}
          onClick={() => setIsPublic(true)}
        />
      </Section>

      {isPublic ? (
        <Section footer={isChannel
          ? 'People can share this link with others and find your channel using Telegram search.'
          : 'People can share this link with others and find your group using Telegram search.'}>
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
          <Section footer={isChannel
            ? 'People can join your channel by following this link. You can revoke the link any time.'
            : 'People can join your group by following this link. You can revoke the link any time.'}>
            <div className={s.linkBox} onClick={() => void navigator.clipboard.writeText(primary.url)}>
              <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>{primary.url}</Text>
            </div>
            <Row
              icon={<TgIcon name="delete" size={22} color="#ff595a" />}
              label="Revoke Link"
              danger
              onClick={() => {
                void g.editInvite(primary.token, { revoked: true }).then(() => g.createInvite())
              }}
            />
          </Section>
        )
      )}
    </SettingsScreen>
  )
}

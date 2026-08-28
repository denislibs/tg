// group/screens/ChatTypeScreen.tsx
// Тип чата (tweb chatType): приватный/публичный + @username, для группы и канала.
import { useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Input from '../../../shared/ui/Input'
import IconButton from '../../../shared/ui/IconButton'
import Spinner from '../../../shared/ui/Spinner'
import TgIcon from '../../TgIcon'
import { useT } from '../../../i18n'
import type { GroupEdit } from '../../../core/hooks/useGroupEdit'
import { isPublic as chatIsPublic } from '../../../core/peers/predicates'

export function ChatTypeScreen({ g, isChannel, onBack }: { g: GroupEdit; isChannel: boolean; onBack: () => void }) {
  const t = useT()
  const [isPublic, setIsPublic] = useState(chatIsPublic(g.card?.chat))
  const [username, setUsername] = useState(g.card?.chat.username ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const changed = isPublic !== chatIsPublic(g.card?.chat) || (isPublic && username !== (g.card?.chat.username ?? ''))
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
          <IconButton onClick={() => void apply()} color="var(--primary-color)">
            {saving ? <Spinner size={22} /> : <TgIcon name="check" />}
          </IconButton>
        ) : undefined
      }
    >
      {/* Выбор типа — радио-строки 1:1 с дампом 15-right-17:
          `label.row.row-with-padding.row-clickable.hover-effect.rp` с
          `.row-subtitle` и `label.radio-field.disable-hover > input[type=radio]
          + div.radio-field-main` (стили — `_checkbox.scss` / `_row.scss`). */}
      <Section caption={isChannel ? 'Channel Type' : 'Group Type'}>
        <form>
          {[false, true].map((pub) => (
            <label key={String(pub)} className="row row-with-padding row-clickable hover-effect rp">
              <div className="row-subtitle">
                {pub
                  ? t(isChannel
                    ? 'Public channels can be found in search and anyone can join.'
                    : 'Public groups can be found in search, chat history is available to everyone and anyone can join.')
                  : t(isChannel
                    ? 'Private channels can only be joined via an invite link.'
                    : 'Private groups can only be joined if you were invited or have an invite link.')}
              </div>
              <label className="radio-field disable-hover">
                <input
                  type="radio"
                  name="chat-type"
                  checked={isPublic === pub}
                  onChange={() => setIsPublic(pub)}
                />
                <div className="radio-field-main">
                  {t(pub
                    ? (isChannel ? 'Public Channel' : 'Public Group')
                    : (isChannel ? 'Private Channel' : 'Private Group'))}
                </div>
              </label>
            </label>
          ))}
        </form>
      </Section>

      {isPublic ? (
        <Section footer={isChannel
          ? 'People can share this link with others and find your channel using Telegram search.'
          : 'People can share this link with others and find your group using Telegram search.'}>
          {/* Поле ссылки — вендорный `.input-wrapper > .input-field`
              (дамп 15-right-17); ошибка красит поле, как в tweb. */}
          <div className="input-wrapper">
            <Input
              label={t('Link')}
              value={username}
              onChange={(v) => { setUsername(v); setError(null) }}
              wrapClassName={error ? 'error' : undefined}
            />
          </div>
          {/* Текст ошибки — подпись секции красным (tweb `.input-field.error`
              + caption); отдельного узла у оригинала здесь нет. */}
          {error && <div className="sidebar-left-section-content sidebar-left-section-caption danger">{error}</div>}
        </Section>
      ) : (
        primary && (
          <Section footer={isChannel
            ? 'People can join your channel by following this link. You can revoke the link any time.'
            : 'People can join your group by following this link. You can revoke the link any time.'}>
            {/* Ссылка-приглашение — обычная кликабельная `.row` (дамп 15-right-17) */}
            <Row label={primary.url} translate={false} onClick={() => void navigator.clipboard.writeText(primary.url)} />
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

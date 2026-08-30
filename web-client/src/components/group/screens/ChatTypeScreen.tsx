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
    else setError(res === 'taken' ? t('LinkTaken') : t('LinkInvalid'))
  }

  return (
    <SettingsScreen
      title={isChannel ? 'ChannelType' : 'GroupType'}
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
      <Section caption={isChannel ? 'ChannelType' : 'GroupType'}>
        <form>
          {[false, true].map((pub) => (
            <label key={String(pub)} className="row row-with-padding row-clickable hover-effect rp">
              <div className="row-subtitle">
                {pub
                  ? t(isChannel
                    ? 'ChannelPublicInfo'
                    : 'MegaPublicInfo')
                  : t(isChannel
                    ? 'ChannelPrivateInfo'
                    : 'MegaPrivateInfo')}
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
                    ? (isChannel ? 'ChannelPublic' : 'MegaPublic')
                    : (isChannel ? 'ChannelPrivate' : 'MegaPrivate'))}
                </div>
              </label>
            </label>
          ))}
        </form>
      </Section>

      {isPublic ? (
        <Section footer={isChannel
          ? 'Channel.UsernameAboutChannel'
          : 'Channel.UsernameAboutGroup'}>
          {/* Поле ссылки — вендорный `.input-wrapper > .input-field`
              (дамп 15-right-17); ошибка красит поле, как в tweb. */}
          <div className="input-wrapper">
            <Input
              label={t('SetUrlPlaceholder')}
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
            ? 'ChannelPrivateLinkHelp'
            : 'MegaPrivateLinkHelp'}>
            {/* Ссылка-приглашение — обычная кликабельная `.row` (дамп 15-right-17) */}
            <Row label={primary.url} translate={false} onClick={() => void navigator.clipboard.writeText(primary.url)} />
            <Row
              icon={<TgIcon name="delete" size={22} color="#ff595a" />}
              label="RevokeLink"
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

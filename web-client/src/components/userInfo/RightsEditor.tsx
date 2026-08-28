// userInfo/RightsEditor.tsx
// Экран прав администратора — порт tweb `sidebarRight/tabs/userPermissions.tsx`.
// Эталон разметки — живой дамп `docs/tweb/dom/dumps/15-right-16-user-admin-rights`:
//
//   div.tabs-tab.sidebar-slider-item.scrollable-y-bordered
//      .edit-peer-container.user-permissions-container.active
//     > div.sidebar-header
//         > button.btn-icon.sidebar-close-button + div.sidebar-header__title
//         + button.btn-icon.primary.appear-zoom.rp        ← «применить», зумом
//     + div.sidebar-content > div.scrollable.scrollable-y
//         > div.sidebar-left-section-container > … > div.chatlist-container
//             > ul.chatlist.chatlist-new > a.row.chatlist-chat  ← строка участника
//         + div.sidebar-left-h2.sidebar-left-section-name        ← «What can this admin do?»
//         + label.row.no-subtitle.row-with-toggle…               ← право с тумблером
//
// Выезд экрана — задача владельца (UserInfoPanel): в tweb сабвью профиля это
// вкладки `.tabs-tab` правого сайдбар-слайдера (`components/slider.ts:39-44`).
import { useState } from 'react'
import UserAvatar from '../UserAvatar'
import TgIcon from '../TgIcon'
import { Row } from '../settings/kit'
import { RIGHTS, type RealMember } from '../../core/hooks/useGroupInfo'
import { useT, useLang } from '../../i18n'
import { userStatusLabel } from '../../core/presence'
import { isUserStatusOnline } from '../../core/peers/peer'

export default function RightsEditor({
  member,
  onBack,
  onSave,
  onRemove,
}: {
  member: RealMember
  onBack: () => void
  onSave: (bitmask: number) => void | Promise<void>
  onRemove: () => void | Promise<void>
}) {
  const t = useT()
  const [lang] = useLang()
  const isAdmin = member.role === 'creator' || member.role === 'admin'
  const initial = isAdmin ? RIGHTS.reduce((acc, r) => acc | r.bit, 0) : 0
  const [bits, setBits] = useState(initial)
  const [saving, setSaving] = useState(false)

  const toggle = (bit: number) => setBits((b) => (b & bit ? b & ~bit : b | bit))
  const run = async (fn: () => void | Promise<void>) => {
    if (saving) return
    setSaving(true)
    try { await fn() } finally { setSaving(false) }
  }

  return (
    <div className="tabs-tab sidebar-slider-item scrollable-y-bordered edit-peer-container user-permissions-container active">
      <div className="sidebar-header">
        <button type="button" className="btn-icon sidebar-close-button" onClick={onBack} aria-label={t('Back')}>
          <TgIcon name="back" />
        </button>
        <div className="sidebar-header__title">{t('Admin Rights')}</div>
        {/* «Применить» — та же кнопка-галка, что в оригинале: появляется зумом
            (`appear-zoom`), пока экран сохраняется — заблокирована. */}
        <button
          type="button"
          className="btn-icon primary appear-zoom rp"
          onClick={() => void run(() => onSave(bits))}
          disabled={saving}
          aria-label={t('Save')}
        >
          <TgIcon name="check" />
        </button>
      </div>

      <div className="sidebar-content">
        <div className="scrollable scrollable-y">
          <div className="sidebar-left-section-container">
            <div className="sidebar-left-section">
              <div className="sidebar-left-section-content">
                <div className="chatlist-container">
                  <ul className="chatlist chatlist-new">
                    <a className="row no-wrap row-with-padding row-clickable hover-effect chatlist-chat chatlist-chat-abitbigger" data-peer-id={member.userId}>
                      <div className="row-row row-subtitle-row dialog-subtitle">
                        <div className="row-subtitle no-wrap">{userStatusLabel(member.status, lang)}</div>
                      </div>
                      <div className="row-row row-title-row dialog-title">
                        <div className="row-title no-wrap user-title">
                          <span className="peer-title">{member.title}</span>
                        </div>
                      </div>
                      <UserAvatar
                        id={member.userId}
                        name={member.title}
                        photoId={member.photoId}
                        online={isUserStatusOnline(member.status, Date.now() / 1000)}
                        className="dialog-avatar row-media row-media-abitbigger"
                      />
                    </a>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar-left-section-container">
            <div className="sidebar-left-section">
              {/* Заголовок группы прав — `sidebar-left-h2` из оригинала */}
              <div className="sidebar-left-h2 sidebar-left-section-name">{t('What can this admin do?')}</div>
              <div className="sidebar-left-section-content">
                {RIGHTS.map((r) => (
                  <Row
                    key={r.bit}
                    label={r.label}
                    translate={false}
                    toggle
                    checked={(bits & r.bit) !== 0}
                    onClick={() => toggle(r.bit)}
                  />
                ))}
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="sidebar-left-section-container">
              <div className="sidebar-left-section">
                <div className="sidebar-left-section-content">
                  <Row
                    icon={<TgIcon name="deleteuser" size={24} />}
                    label="Dismiss Admin"
                    danger
                    onClick={() => void run(onRemove)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

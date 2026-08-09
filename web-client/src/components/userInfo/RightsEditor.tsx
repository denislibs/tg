// userInfo/RightsEditor.tsx
// Экран прав администратора (порт tweb sidebarRight/tabs/userPermissions.tsx):
// строка участника + тумблер на каждое право. Выезд экрана — задача владельца
// (UserInfoPanel), как в tweb, где сабвью профиля это вкладки `.tabs-tab`
// правого сайдбар-слайдера (`tweb components/slider.ts:39-44`).
import { useState } from 'react'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgSwitch from '../TgSwitch'
import TgIcon from '../TgIcon'
import { RIGHTS, type RealMember } from '../../core/hooks/useGroupInfo'
import classNames from '../../shared/lib/classNames'
import s from '../UserInfoPanel.module.scss'

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
  const isAdmin = member.role === 'creator' || member.role === 'admin'
  const initial = isAdmin ? RIGHTS.reduce((acc, r) => acc | r.bit, 0) : 0
  const [bits, setBits] = useState(initial)
  const [saving, setSaving] = useState(false)

  const toggle = (bit: number) => setBits((b) => (b & bit ? b & ~bit : b | bit))

  // `slideIn` — въезд справа, тот же, что у остальных экранов правой панели
  // (UserInfoPanel.module.scss:743, порт входной половины tweb
  // transition.ts:23-42). Отдельным классом, потому что `.rights` шарится.
  return (
    <div className={classNames(s.rights, s.slideIn)}>
      <div className={s.rightsHeader}>
        <IconButton onClick={onBack} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text noWrap size={19} weight={600} color="var(--primary-text-color)" style={{ flex: 1 }}>
          {member.displayName}
        </Text>
      </div>

      <div className={s.body}>
        <div className={s.section} style={{ marginTop: 0 }}>
          <Text size={14} weight={600} color="var(--primary-color)" className={s.sectionTitle}>
            Права администратора
          </Text>
          <div className={s.cardPlain}>
            {RIGHTS.map((r) => (
              <div key={r.bit} onClick={() => toggle(r.bit)} className={s.rightRow}>
                <Text size={16} color="var(--primary-text-color)" style={{ flex: 1 }}>{r.label}</Text>
                <TgSwitch checked={(bits & r.bit) !== 0} />
              </div>
            ))}
          </div>
        </div>

        <div className={s.section} style={{ marginTop: 12 }}>
          <div
            onClick={async () => {
              if (saving) return
              setSaving(true)
              try {
                await onSave(bits)
              } finally {
                setSaving(false)
              }
            }}
            className={s.saveBtn}
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            Сохранить
          </div>
          {isAdmin && (
            <div
              onClick={async () => {
                if (saving) return
                setSaving(true)
                try {
                  await onRemove()
                } finally {
                  setSaving(false)
                }
              }}
              className={s.removeBtn}
            >
              Снять права
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// group/screens/PermissionsScreen.tsx
// Разрешения группы (tweb groupPermissions: тумблеры прав + slowmode + платные
// сообщения владельца).
import { useRef, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import Slider from '../../../shared/ui/Slider'
import { useT } from '../../../i18n'
import { type GroupEdit, PERMS, SLOWMODE_STEPS, slowmodeLabel } from '../../../core/hooks/useGroupEdit'
import s from '../GroupEditFlow.module.scss'

export function PermissionsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  const t = useT()
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

  // Платные сообщения (Telegram paid messages): плата в звёздах, меняет только владелец.
  const [charge, setCharge] = useState(g.card?.chargeStars ?? 0)
  const chargeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushCharge = (next: number) => {
    const v = Math.max(0, Math.min(10000, Math.round(next) || 0))
    setCharge(v)
    if (chargeTimer.current) clearTimeout(chargeTimer.current)
    chargeTimer.current = setTimeout(() => void g.saveChargeStars(v), 500)
  }

  return (
    <SettingsScreen title="Permissions" onBack={onBack} zIndex={70}>
      {/* Строки прав — ровно та форма, что в дампе `15-right-13-group-permissions`:
          `label.row.no-subtitle.row-with-toggle.row-clickable.hover-effect.rp`
          с тумблером-ограничением (`checkbox-field-toggle-restriction`: снятый
          тумблер красный, а не серый). Квадратный чекбокс
          (`div.checkbox-box`) в этом экране tweb рисует ТОЛЬКО у под-прав
          аккордеона «Send Media» (Send Photos / Videos / …) — такой вложенности
          у нашей маски `PERMS` нет (см. `core/hooks/useGroupEdit.ts`). */}
      <Section caption="What can members of this group do?">
        {PERMS.map((p) => (
          <Row
            key={p.bit}
            label={p.label}
            toggle
            restriction
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
      {/* Платные сообщения (Telegram paid messages) — только владелец группы. */}
      {g.isCreator && (
        <Section caption="Paid messages" footer="Charge stars per message from non-admins. 0 disables paid messages.">
          <div className={s.chargeRow}>
            <Text size={15} color="var(--primary-text-color)">{t('Stars per message')}</Text>
            <input
              type="number"
              min={0}
              max={10000}
              value={charge}
              onChange={(e) => pushCharge(Number(e.target.value))}
              className={s.chargeInput}
            />
          </div>
        </Section>
      )}
    </SettingsScreen>
  )
}

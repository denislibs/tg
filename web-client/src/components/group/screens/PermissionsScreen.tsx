// group/screens/PermissionsScreen.tsx
// Разрешения группы (tweb groupPermissions: тумблеры прав + slowmode + платные
// сообщения владельца).
import { useRef, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Slider from '../../../shared/ui/Slider'
import classNames from '../../../shared/lib/classNames'
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
        {/* Слоумод 1:1 с дампом 15-right-13: `div.range-setting-selector
            .range-steps-selector > div.progress-line` (наш вендорный `Slider`),
            а засечки-подписи — `.range-setting-selector-option[.active]
            [.is-first][.is-last]` c `-option-text`, позиционируемые процентом
            слева. Раскладку контейнера даёт `_rightSidebar.scss`
            (`.group-permissions-container .range-steps-selector`). */}
        <div className="range-setting-selector range-steps-selector">
          <Slider
            min={0}
            max={SLOWMODE_STEPS.length - 1}
            step={1}
            value={slowIdx}
            onChange={(v) => push(perms, v)}
            style={{ marginBlock: 0 }}
          >
            {SLOWMODE_STEPS.map((sec, i) => (
              <div
                key={sec}
                className={classNames(
                  'range-setting-selector-option',
                  i === slowIdx ? 'active is-chosen' : '',
                  i === 0 ? 'is-first' : '',
                  i === SLOWMODE_STEPS.length - 1 ? 'is-last' : '',
                )}
                style={{ left: `${(i / (SLOWMODE_STEPS.length - 1)) * 100}%` }}
              >
                <div className="range-setting-selector-option-text">{slowmodeLabel(sec)}</div>
              </div>
            ))}
          </Slider>
        </div>
      </Section>
      {/* Платные сообщения (Telegram paid messages) — только владелец группы. */}
      {g.isCreator && (
        <Section caption="Paid messages" footer="Charge stars per message from non-admins. 0 disables paid messages.">
          {/* Плата за сообщение — обычная `.row` с правым слотом
              (`row-right`, tweb row.ts:280-283), в слоте — числовое поле. */}
          <Row
            label="Stars per message"
            right={
              <input
                type="number"
                min={0}
                max={10000}
                value={charge}
                onChange={(e) => pushCharge(Number(e.target.value))}
                className={s.chargeInput}
                aria-label={t('Stars per message')}
              />
            }
          />
        </Section>
      )}
    </SettingsScreen>
  )
}

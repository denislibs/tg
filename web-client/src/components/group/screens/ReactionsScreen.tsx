// group/screens/ReactionsScreen.tsx
// Реакции (tweb chatReactions): все / выборочные / выключены.
import { useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import TgSwitch from '../../TgSwitch'
import type { GroupEdit } from '../../../core/hooks/useGroupEdit'
import { EMOJIS } from './shared'
import s from '../GroupEditFlow.module.scss'

export function ReactionsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
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

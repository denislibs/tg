// group/screens/ReactionsScreen.tsx
// Реакции (tweb chatReactions): все / выборочные / выключены.
import { useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import type { GroupEdit } from '../../../core/hooks/useGroupEdit'
import { EMOJIS } from './shared'

export function ReactionsScreen({ g, onBack }: { g: GroupEdit; onBack: () => void }) {
  // Политика реакций — ОБЪЕДИНЕНИЕ `ChatReactions`, а не пара «строка + список»:
  // режим это ВЫБОР КОНСТРУКТОРА (`chatReactionsAll`/`Some`/`None`), и tweb
  // (`chatReactions`) читает его ровно тем же ветвлением по `_`. Обратное
  // направление (пара → конструктор) делает бэкенд — ручка `PUT /reactions`
  // осталась прежней.
  const reactions = g.card?.fullChat.available_reactions
  const [mode, setMode] = useState<'all' | 'some' | 'none'>(
    reactions?._ === 'chatReactionsNone' ? 'none' : reactions?._ === 'chatReactionsSome' ? 'some' : 'all',
  )
  const [allowed, setAllowed] = useState<string[]>(
    reactions?._ === 'chatReactionsSome' ? reactions.reactions.map((r) => r.emoticon) : [],
  )

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
              // Реакция — обычная `.row` с тумблером; эмодзи в слоте иконки
              // (tweb chatReactions: `Row({checkboxField, icon})`).
              <Row
                key={e}
                icon={<span className="reaction-emoji">{e}</span>}
                label={e}
                translate={false}
                toggle
                checked={on}
                onClick={() => apply('some', on ? allowed.filter((x) => x !== e) : [...allowed, e])}
              />
            )
          })}
        </Section>
      )}
    </SettingsScreen>
  )
}

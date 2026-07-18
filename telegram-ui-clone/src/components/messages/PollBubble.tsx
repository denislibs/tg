// Баббл опроса — порт tweb pollMessageContent: вопрос жирным + подпись типа,
// варианты (радио у одиночного/викторины, чекбокс у мультивыбора; после
// голосования — процент, полоса-бар, счётчик), футер («Голосовать» у
// мультивыбора / счётчик голосов). Викторина: зелёная/красная подсветка.
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useManagers } from '../../core/hooks/useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import { useChatsStore } from '../../stores/chatsStore'
import type { Poll } from '../../core/models'
import { useT } from '../../i18n'
import s from './PollBubble.module.scss'

export default function PollBubble({ poll, out }: { poll: Poll; out: boolean }) {
  const t = useT()
  const managers = useManagers()
  // опрос рендерится только в открытом чате — его id и есть чат опроса
  const chatId = useChatsStore((st) => st.activeChatId) ?? 0
  const [pending, setPending] = useState<number[]>([]) // выбор в мультивыборе до «Голосовать»
  const [busy, setBusy] = useState(false)

  const voted = poll.myVotes.length > 0
  const showResults = voted || poll.closed
  const total = poll.counts.reduce((a, b) => a + b, 0)

  const typeLabel = poll.closed
    ? t('Final Results')
    : poll.quiz
      ? poll.anonymous ? t('Anonymous Quiz') : t('Quiz')
      : poll.anonymous ? t('Anonymous Poll') : t('Poll')

  const sendVote = (options: number[]) => {
    if (busy) return
    setBusy(true)
    void managers.messages
      .votePoll(poll.id, options)
      .then((p) => useMessagesStore.getState().setPoll(chatId, p))
      .finally(() => setBusy(false))
    setPending([])
  }

  const onOption = (idx: number) => {
    if (poll.closed || showResults) return
    if (poll.multiple) {
      setPending((cur) => (cur.includes(idx) ? cur.filter((x) => x !== idx) : [...cur, idx]))
    } else {
      // одиночный/викторина: один тап — голос (tweb wrappedSendVote)
      sendVote([idx])
    }
  }

  return (
    <div className={classNames(s.poll, out ? s.out : '')}>
      <div className={s.question}>{poll.question}</div>
      <Text size={13} color="var(--b-time)">{typeLabel}</Text>

      <div className={s.options}>
        {poll.options.map((opt, idx) => {
          const count = poll.counts[idx] ?? 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const chosen = poll.myVotes.includes(idx)
          const isCorrect = poll.correctOption === idx
          const isWrongChosen = poll.quiz && chosen && poll.correctOption != null && !isCorrect
          const barClass = poll.quiz && poll.correctOption != null
            ? isCorrect ? s.barCorrect : isWrongChosen ? s.barWrong : s.bar
            : s.bar
          return (
            <div
              key={idx}
              className={classNames(s.option, !showResults && !poll.closed ? s.clickable : '')}
              onClick={() => onOption(idx)}
            >
              <div className={s.left}>
                {showResults ? (
                  <Text size={12} weight={600} color="var(--b-text)">{pct}%</Text>
                ) : (
                  <span className={classNames(s.check, poll.multiple ? s.square : '', pending.includes(idx) ? s.checked : '')}>
                    {pending.includes(idx) && <TgIcon name="check" size={14} color="#fff" />}
                  </span>
                )}
              </div>
              <div className={s.body}>
                <div className={s.labelRow}>
                  <Text size={15} color="var(--b-text)" style={{ flex: 1 }}>{opt}</Text>
                  {showResults && (
                    <span className={s.stats}>
                      {chosen && (
                        <TgIcon
                          name={isWrongChosen ? 'close' : 'check'}
                          size={14}
                          color={isWrongChosen ? '#e5484d' : 'var(--tg-accent)'}
                        />
                      )}
                      <Text size={12} color="var(--b-time)">{count}</Text>
                    </span>
                  )}
                </div>
                {showResults && (
                  <div className={s.track}>
                    <div className={barClass} style={{ width: `${Math.max(pct, count > 0 ? 5 : 0)}%` }} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className={s.footer}>
        {poll.multiple && !showResults ? (
          <span
            className={classNames(s.voteBtn, pending.length > 0 && !busy ? s.voteActive : '')}
            onClick={() => pending.length > 0 && sendVote(pending)}
          >
            {t('Vote')}
          </span>
        ) : (
          <Text size={13} color="var(--b-time)">
            {total === 0
              ? t(poll.closed ? 'No votes' : 'No votes yet')
              : `${poll.totalVoters} ${t(poll.quiz ? 'answered' : 'voted')}`}
          </Text>
        )}
      </div>
    </div>
  )
}

// Баббл опроса — порт tweb pollMessageContent: вопрос жирным + подпись типа,
// варианты (радио у одиночного/викторины, чекбокс у мультивыбора; после
// голосования — процент, полоса-бар, счётчик), футер («Голосовать» у
// мультивыбора / счётчик голосов). Викторина: зелёная/красная подсветка.
//
// Читается ВЛОЖЕНИЕ `messageMediaPoll` целиком, без плоской проекции: сам опрос
// (вопрос и варианты) и его итоги — РАЗНЫЕ конструкторы, и «мой выбор» живёт в
// итогах флагом варианта (`pollAnswerVoters.pFlags.chosen`), а не отдельным
// массивом индексов рядом со счётчиками. Вариант адресуется своим КЛЮЧОМ
// (`option`), не позицией в массиве: позиции в схеме нет вовсе.
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useManagers } from '../../core/hooks/useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import { useChatsStore } from '../../stores/chatsStore'
import { pollOptionIndex, pollVotersFor, type MessageMediaPoll } from '../../core/media/messageMedia'
import { useT } from '../../i18n'
import s from './PollBubble.module.scss'

export default function PollBubble({ media, out }: { media: MessageMediaPoll; out: boolean }) {
  const t = useT()
  const managers = useManagers()
  // опрос рендерится только в открытом чате — его id и есть чат опроса
  const peerId = useChatsStore((st) => st.activePeerId) ?? 0
  const [pending, setPending] = useState<string[]>([]) // ключи вариантов в мультивыборе до «Голосовать»
  const [busy, setBusy] = useState(false)

  const { poll, results } = media
  const closed = !!poll.pFlags?.closed
  const quiz = !!poll.pFlags?.quiz
  const multiple = !!poll.pFlags?.multiple_choice
  // Анонимность — ОТРИЦАНИЕ `public_voters`: в схеме вопрос задан с другой
  // стороны, и «анонимный» это отсутствие ключа.
  const anonymous = !poll.pFlags?.public_voters

  const voted = (results.results ?? []).some((r) => r.pFlags?.chosen)
  const showResults = voted || closed
  const total = (results.results ?? []).reduce((a, r) => a + (r.voters ?? 0), 0)
  // Правильный ответ викторины сервер раскрывает только тому, кому положено, —
  // здесь он либо есть флагом, либо его нет вовсе.
  const correct = (results.results ?? []).find((r) => r.pFlags?.correct)?.option

  const typeLabel = closed
    ? t('Final Results')
    : quiz
      ? anonymous ? t('Anonymous Quiz') : t('Quiz')
      : anonymous ? t('Anonymous Poll') : t('Poll')

  const sendVote = (options: string[]) => {
    if (busy) return
    setBusy(true)
    // Ответ несёт МОЙ выбор (`pFlags.chosen`), которого нет в общем WS
    // poll_update → ставим вложение в стор здесь (не merge); WS затем
    // реконсилит агрегат.
    void managers.messages
      .votePoll(peerId, poll.id, options.map(pollOptionIndex))
      .then((p) => useMessagesStore.getState().setPollMedia(peerId, p))
      .finally(() => setBusy(false))
    setPending([])
  }

  const onOption = (option: string) => {
    if (closed || showResults) return
    if (multiple) {
      setPending((cur) => (cur.includes(option) ? cur.filter((x) => x !== option) : [...cur, option]))
    } else {
      // одиночный/викторина: один тап — голос (tweb wrappedSendVote)
      sendVote([option])
    }
  }

  return (
    <div className={classNames(s.poll, out ? s.out : '')}>
      <div className={s.question}>{poll.question.text}</div>
      <Text size={13} color="var(--message-time-color)">{typeLabel}</Text>

      <div className={s.options}>
        {poll.answers.map((answer) => {
          const voters = pollVotersFor(results, answer.option)
          const count = voters?.voters ?? 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const chosen = !!voters?.pFlags?.chosen
          const isCorrect = correct != null && answer.option === correct
          const isWrongChosen = quiz && chosen && correct != null && !isCorrect
          const barClass = quiz && correct != null
            ? isCorrect ? s.barCorrect : isWrongChosen ? s.barWrong : s.bar
            : s.bar
          return (
            <div
              key={answer.option}
              className={classNames(s.option, !showResults && !closed ? s.clickable : '')}
              onClick={() => onOption(answer.option)}
            >
              <div className={s.left}>
                {showResults ? (
                  <Text size={12} weight={600} color="var(--b-text)">{pct}%</Text>
                ) : (
                  <span className={classNames(s.check, multiple ? s.square : '', pending.includes(answer.option) ? s.checked : '')}>
                    {pending.includes(answer.option) && <TgIcon name="check" size={14} color="#fff" />}
                  </span>
                )}
              </div>
              <div className={s.body}>
                <div className={s.labelRow}>
                  <Text size={15} color="var(--b-text)" style={{ flex: 1 }}>{answer.text.text}</Text>
                  {showResults && (
                    <span className={s.stats}>
                      {chosen && (
                        <TgIcon
                          name={isWrongChosen ? 'close' : 'check'}
                          size={14}
                          color={isWrongChosen ? '#e5484d' : 'var(--primary-color)'}
                        />
                      )}
                      <Text size={12} color="var(--message-time-color)">{count}</Text>
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
        {multiple && !showResults ? (
          <span
            className={classNames(s.voteBtn, pending.length > 0 && !busy ? s.voteActive : '')}
            onClick={() => pending.length > 0 && sendVote(pending)}
          >
            {t('Vote')}
          </span>
        ) : (
          <Text size={13} color="var(--message-time-color)">
            {total === 0
              ? t(closed ? 'No votes' : 'No votes yet')
              : `${results.total_voters ?? 0} ${t(quiz ? 'answered' : 'voted')}`}
          </Text>
        )}
      </div>
    </div>
  )
}

// Модалка «Новый опрос» — порт tweb popupCreatePoll (стоковый набор):
// вопрос (255) + варианты (2..10, по 100) с авто-добавлением пустой строки,
// тумблеры «Анонимное голосование» / «Несколько ответов» / «Викторина»
// (викторина исключает мультивыбор; правильный ответ — радио в списке).
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgSwitch from './TgSwitch'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import classNames from '../shared/lib/classNames'
import { useT } from '../i18n'
import s from './CreatePollPopup.module.scss'

export interface NewPollData {
  question: string
  options: string[]
  anonymous: boolean
  multiple: boolean
  quiz: boolean
  correctOption?: number
}

const MAX_OPTIONS = 10

export default function CreatePollPopup({ onCreate, onClose }: {
  onCreate: (p: NewPollData) => void
  onClose: () => void
}) {
  const t = useT()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [anonymous, setAnonymous] = useState(true)
  const [multiple, setMultiple] = useState(false)
  const [quiz, setQuiz] = useState(false)
  const [correct, setCorrect] = useState<number | null>(null)

  const setOption = (i: number, v: string) => {
    setOptions((cur) => {
      const next = cur.slice()
      next[i] = v
      // авто-добавление пустой строки, пока меньше лимита (tweb)
      if (i === next.length - 1 && v.trim() && next.length < MAX_OPTIONS) next.push('')
      return next
    })
  }
  const removeOption = (i: number) => {
    setOptions((cur) => {
      const next = cur.filter((_, x) => x !== i)
      while (next.length < 2) next.push('')
      return next
    })
    setCorrect((c) => (c == null ? null : c === i ? null : c > i ? c - 1 : c))
  }

  const filled = options.map((o) => o.trim()).filter(Boolean)
  const canCreate =
    question.trim().length > 0 &&
    question.length <= 255 &&
    filled.length >= 2 &&
    filled.every((o) => o.length <= 100) &&
    (!quiz || (correct != null && options[correct]?.trim()))

  const submit = () => {
    if (!canCreate) return
    // индекс правильного ответа в СЖАТОМ списке (без пустых строк)
    let correctIdx: number | undefined
    if (quiz && correct != null) {
      correctIdx = options.slice(0, correct).map((o) => o.trim()).filter(Boolean).length
    }
    onCreate({
      question: question.trim(),
      options: filled,
      anonymous,
      multiple: quiz ? false : multiple,
      quiz,
      correctOption: correctIdx,
    })
  }

  return (
    <Popup open title={t('New Poll')} onClose={onClose} width={420} action={{ label: t('Create'), onClick: submit }}>
      <div className={s.body}>
        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Ask a Question')}</Text>
        <input
          className={s.question}
          value={question}
          maxLength={255}
          placeholder={t('Ask a Question')}
          onChange={(e) => setQuestion(e.target.value)}
        />

        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Poll options')}</Text>
        {options.map((opt, i) => (
          <div key={i} className={s.optionRow}>
            {quiz && (
              <span
                className={classNames(s.radio, correct === i ? s.radioOn : '')}
                onClick={() => opt.trim() && setCorrect(i)}
              />
            )}
            <input
              className={s.option}
              value={opt}
              maxLength={100}
              placeholder={i === options.length - 1 && !opt ? t('Add an Option') : t('Option')}
              onChange={(e) => setOption(i, e.target.value)}
            />
            {opt !== '' && (
              <IconButton size="small" onClick={() => removeOption(i)} aria-label={t('Delete')}>
                <TgIcon name="close" size={18} color="var(--tg-textSecondary)" />
              </IconButton>
            )}
          </div>
        ))}

        <div className={s.switches}>
          <div className={s.switchRow} onClick={() => setAnonymous((v) => !v)}>
            <Text size={15.5}>{t('Anonymous Voting')}</Text>
            <TgSwitch checked={anonymous} />
          </div>
          <div
            className={classNames(s.switchRow, quiz ? s.disabled : '')}
            onClick={() => !quiz && setMultiple((v) => !v)}
          >
            <Text size={15.5}>{t('Multiple Answers')}</Text>
            <TgSwitch checked={multiple && !quiz} />
          </div>
          <div className={s.switchRow} onClick={() => setQuiz((v) => !v)}>
            <Text size={15.5}>{t('Quiz Mode')}</Text>
            <TgSwitch checked={quiz} />
          </div>
          {quiz && (
            <Text size={13} color="var(--tg-textSecondary)" style={{ padding: '2px 4px' }}>
              {t('Select the correct answer in the list of options.')}
            </Text>
          )}
        </div>
      </div>
    </Popup>
  )
}

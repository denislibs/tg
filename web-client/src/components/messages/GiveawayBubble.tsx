// Баббл розыгрыша (по мотивам tweb chat/giveaway.tsx): трофей + приз +
// участники + дата/обратный отсчёт + кнопка участия.
//
// ── Что во вложении, а что нет ──────────────────────────────────────────────
// Вложение (`messageMediaGiveaway` до розыгрыша, `messageMediaGiveawayResults`
// после — РАЗНЫЕ конструкторы, а не поле `status`) несёт то, что одинаково у
// всех: приз, число победителей, срок, список победителей.
//
// ЛИЧНОЕ («участвую ли», «выиграл ли», сколько участников) во вложении не едет
// и не может: тело кадра одно на всех получателей. Его отдаёт отдельная ручка
// `GET /giveaways/{id}` — ровно как `payments.getGiveawayInfo` у оригинала,
// который дёргает попап розыгрыша (tweb `popupGiveaway`). «Выиграл ли я» при
// этом можно было бы вывести и из вектора `winners`, но у ответа ручки это
// готовый флаг — и он же единственный источник «участвую ли».
import { useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import { useManagers } from '../../core/hooks/useManagers'
import { useMiddlewareHelper } from '../../core/hooks/useMiddlewareHelper'
import type { GiveawayState } from '../../core/models'
import type { MessageMediaGiveaway, MessageMediaGiveawayResults } from '../../core/media/messageMedia'
import { useT } from '../../i18n'
import s from './GiveawayBubble.module.scss'

// countdown форматирует остаток до окончания розыгрыша в компактную строку.
function formatCountdown(ms: number, t: (k: string) => string): string {
  if (ms <= 0) return t('Ended')
  const sec = Math.floor(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const ss = sec % 60
  if (d > 0) return `${d}${t('d')} ${h}${t('h')}`
  if (h > 0) return `${h}${t('h')} ${m}${t('m')}`
  if (m > 0) return `${m}${t('m')} ${ss}${t('s')}`
  return `${ss}${t('s')}`
}

export default function GiveawayBubble({ media }: { media: MessageMediaGiveaway | MessageMediaGiveawayResults }) {
  const t = useT()
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [state, setState] = useState<GiveawayState | null>(null)

  const active = media._ === 'messageMediaGiveaway'
  const untilMs = media.until_date * 1000
  const remaining = untilMs - now
  const winnersCount = media._ === 'messageMediaGiveaway' ? media.quantity : media.winners_count

  // Тикер обратного отсчёта — только пока розыгрыш активен.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  // Личное состояние зрителя — отдельным запросом (см. шапку). Актуальность —
  // штатным middleware: поздний ответ снесённого бабла в стейт не пишет.
  useEffect(() => {
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.boosts.getGiveaway(media.id)
      .then((info) => { if (middleware()) setState(info) })
      .catch(() => {})
    return () => { scope.destroy() }
  }, [media.id, managers, middlewareHelper])

  // Вид приза выражен тем, КАКОЙ параметр присутствует: `months` (подписка) или
  // `stars` (звёзды победителю). Строкового `prize_kind` в схеме нет.
  const prizeText = media.stars
    ? `${media.stars} ${t('Stars')}`
    : `${t('Telegram Premium')} · ${media.months ?? 0} ${t('mo')}`

  const participating = state?._ === 'payments.giveawayInfo' && !!state.pFlags?.participating
  const iWon = state?._ === 'payments.giveawayInfoResults' && !!state.pFlags?.winner

  const onParticipate = () => {
    if (busy) return
    setBusy(true)
    // Ответ — то же ЛИЧНОЕ состояние, что отдаёт `GET /giveaways/{id}`;
    // сообщение он не трогает вовсе.
    void managers.messages
      .participateGiveaway(media.id)
      .then(setState)
      .finally(() => setBusy(false))
  }

  return (
    <div className={s.giveaway}>
      <div className={s.sticker}>
        <span className={s.trophy}>🏆</span>
        <span className={s.counter}>x{winnersCount}</span>
      </div>

      <div className={s.row}>
        <div className={s.rowTitle}>{t('Giveaway Prizes')}</div>
        <Text size={14} color="var(--b-text)" style={{ textAlign: 'center' }}>
          <b>{winnersCount}</b> {prizeText}
        </Text>
      </div>

      <div className={s.row}>
        <div className={s.rowTitle}>{t('Participants')}</div>
        <Text size={14} color="var(--b-text)">{state?.participants ?? 0}</Text>
      </div>

      <div className={s.row}>
        <div className={s.rowTitle}>{active ? t('Winners Selection Date') : t('Giveaway Ended')}</div>
        <Text size={14} weight={600} color="var(--primary-color)">
          {active ? formatCountdown(remaining, t) : t('Winners selected')}
        </Text>
      </div>

      {!active && iWon && (
        <div className={s.won}>🎉 {t('You won the giveaway!')}</div>
      )}

      {active && (
        participating ? (
          <div className={s.participating}>✓ {t('You are participating')}</div>
        ) : (
          <button className={s.btn} disabled={busy} onClick={onParticipate}>
            {t('Participate')}
          </button>
        )
      )}
    </div>
  )
}

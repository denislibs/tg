// Попап буста канала — порт tweb popups/boost.ts: полоса прогресса уровня
// (Level N → Level N+1, заполнение = доля до следующего уровня, плавающая
// подсказка со счётчиком бустов), заголовок/описание и кнопка «Boost Channel».
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useChannelBoosts } from '../core/hooks/useChannelBoosts'
import { boostProgress } from '../core/models'
import { useT } from '../i18n'
import s from './BoostPopup.module.scss'

export default function BoostPopup({ chatId, onClose }: { chatId: number; onClose: () => void }) {
  const t = useT()
  const { status, boost } = useChannelBoosts(chatId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const level = status?.level ?? 0
  const boosts = status?.boostsCount ?? 0
  const { progress, need } = boostProgress({
    boostsCount: boosts,
    currentLevelBoosts: status?.currentLevelBoosts ?? 0,
    nextLevelBoosts: status?.nextLevelBoosts ?? 0,
  })

  const doBoost = () => {
    if (busy) return
    setBusy(true)
    setErr('')
    void boost()
      .catch(() => setErr(t('Could not boost. You need Telegram Premium and a free boost slot.')))
      .finally(() => setBusy(false))
  }

  const description = status?.boostedByMe
    ? t('You are boosting this channel.')
    : need > 0
      ? t('This channel needs {n} more boost(s) to reach the next level.').replace('{n}', String(need))
      : t('Help boost this channel to unlock new features.')

  return (
    <Popup open title={t('Boost Channel')} onClose={onClose} width={360}>
      <div className={s.body}>
        <div className={s.bar}>
          <div className={s.hint} style={{ left: `${Math.min(Math.max(progress * 100, 10), 90)}%` }}>
            <TgIcon name="boost" size={13} color="#fff" />
            <span>{boosts}</span>
          </div>
          <div className={s.track}>
            <div className={s.fill} style={{ width: `${progress * 100}%` }} />
          </div>
          <div className={s.levels}>
            <span>{t('Level')} {level}</span>
            <span>{t('Level')} {level + 1}</span>
          </div>
        </div>

        <Text size={15} color="var(--tg-textPrimary)" className={s.desc}>{description}</Text>

        {err && <Text size={13} color="#e5484d" className={s.desc}>{err}</Text>}

        {status && status.boostedByMe ? (
          <div className={s.boosted}>✓ {t('You boosted this channel')}</div>
        ) : (
          <button className={s.btn} disabled={busy} onClick={doBoost}>
            <TgIcon name="boost" size={18} color="#fff" />
            {t('Boost Channel')}
          </button>
        )}
      </div>
    </Popup>
  )
}

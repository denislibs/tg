// Экран «Кошелёк» (Telegram Stars): крупный баланс, покупка звёзд и история
// транзакций. Полноэкранный слайд-скрин поверх списка чатов (как Настройки).
// Пополнение — dev-операция (реального провайдера нет), баланс живёт в
// State (`starsBalance`, единый источник, обновляется и WS-фреймом balance_update).
import { useEffect, useState } from 'react'
import { SettingsScreen, Section } from '../settings/kit'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useNavLayer } from '../../core/hooks/useNavLayer'
import { useStarsBalance, setStarsBalance } from '../../stores/starsStore'
import { useT, useLang } from '../../i18n'
import { friendlyMsgTime } from '../../core/format/friendlyTime'
import type { StarTransaction } from '../../core/managers/starsManager'
import StarIcon from './StarIcon'
import s from './stars.module.scss'
import w from './WalletView.module.scss'

const TOPUP_OPTIONS = [100, 250, 500, 1000, 2500, 5000]

// Иконка и метка по типу транзакции (fallback на title с бэка).
function txMeta(tx: StarTransaction, t: (s: string) => string): { icon: import('../TgIcon').IconName; label: string } {
  switch (tx.kind) {
    case 'topup': return { icon: 'add', label: t('Top-Up') }
    case 'gift_sent': return { icon: 'gift', label: tx.title || t('Gift') }
    case 'gift_converted': return { icon: 'star_filled', label: t('Gift converted') }
    case 'paid_media': return { icon: 'lock', label: t('Paid media') }
    default: return { icon: 'star_filled', label: tx.title || t('Transaction') }
  }
}

export default function WalletView({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  useNavLayer(true, onBack) // Back закрывает «Кошелёк»
  const balance = useStarsBalance()
  const [busy, setBusy] = useState(false)
  const [txs, setTxs] = useState<StarTransaction[]>([])

  const loadTxs = () => { void managers.stars.transactions().then(setTxs).catch(() => {}) }
  useEffect(loadTxs, [managers])

  const topUp = async (amount: number) => {
    if (busy) return
    setBusy(true)
    try {
      const bal = await managers.stars.topUp(amount)
      setStarsBalance(bal)
      loadTxs() // подтянуть свежую запись в историю
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsScreen title="Wallet" onBack={onBack}>
      {/* Крупный баланс */}
      <div className={s.bigBalance}>
        <div className={s.bigBalanceRow}>
          <StarIcon size={32} />
          {balance}
        </div>
        <div className={s.bigBalanceLabel}>{t('Your balance')}</div>
      </div>

      {/* Покупка звёзд */}
      <Section caption="Buy Stars">
        <div className={w.optionsGrid}>
          {TOPUP_OPTIONS.map((amount) => (
            <div key={amount} className={s.option} onClick={() => void topUp(amount)}>
              <div className={s.optionStars}>
                <StarIcon size={18} />
                {amount}
              </div>
            </div>
          ))}
        </div>
        <Text size={13} color="var(--secondary-text-color)" style={{ display: 'block', textAlign: 'center', padding: '10px 4px 2px' }}>
          {t('Demo: top-up adds Stars instantly, no real payment.')}
        </Text>
      </Section>

      {/* История транзакций */}
      {txs.length > 0 && (
        <Section caption="Recent Transactions">
          {txs.map((tx) => {
            const m = txMeta(tx, t)
            const positive = tx.amount > 0
            return (
              <div key={tx.id} className={w.txRow}>
                <div className={w.txIcon}>
                  <TgIcon name={m.icon} size={22} color="var(--secondary-text-color)" />
                </div>
                <div className={w.txBody}>
                  <Text noWrap size={15.5} color="var(--primary-text-color)">{m.label}</Text>
                  <Text noWrap size={13} color="var(--secondary-text-color)">{friendlyMsgTime(tx.date, lang)}</Text>
                </div>
                <div className={w.txAmount} style={{ color: positive ? 'var(--green-color)' : 'var(--primary-text-color)' }}>
                  {positive ? '+' : '−'}{Math.abs(tx.amount)}
                  <StarIcon size={15} />
                </div>
              </div>
            )
          })}
        </Section>
      )}
    </SettingsScreen>
  )
}

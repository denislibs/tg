import Text from '../shared/ui/Text'
import { ALWAYS_YEAR, DayDate } from '../shared/ui/dateNodes'
import TgIcon from './TgIcon'
import { SettingsScreen, Section, Row } from './settings/kit'
import { useT } from '../i18n'
import { usePremiumSubscription } from '../core/hooks/usePremiumSubscription'
import { planById, formatUsd } from '../core/premium/plans'

// Manage-subscription screen (tweb settings sub-screen): shows the active plan,
// its expiry and auto-renew state, and lets the user cancel auto-renew.
export default function PremiumManage({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { sub, loading, cancelling, cancel } = usePremiumSubscription()

  return (
    <SettingsScreen title="Premium.Boarding.Title" onBack={onBack} zIndex={70}>
      <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
        <TgIcon name="star_filled" size={64} color="var(--primary-color)" />
        <Text size={20} weight={600} color="var(--primary-text-color)" style={{ marginTop: 8 }}>
          {t('Premium.Manage.Active')}
        </Text>
      </div>

      {loading ? (
        <Text size={15} color="var(--secondary-text-color)" style={{ textAlign: 'center', padding: 20 }}>
          {t('Loading')}
        </Text>
      ) : sub ? (
        <>
          <Section caption="Stars.Subscription">
            <Row label={t(planById(sub.plan).labelKey)} value={formatUsd(sub.priceCents)} translate={false} />
            <Row
              label={sub.autoRenew ? 'Premium.Manage.RenewsOn' : 'Premium.Manage.ExpiresOn'}
              // Дата окончания — узел `formatDate` ядра (порт tweb
              // `helpers/date.ts:75-105`, ср. `popups/frozen.tsx:30`). Прежний
              // `toLocaleDateString(undefined, …)` брал локаль БРАУЗЕРА.
              //
              // `ALWAYS_YEAR` — не украшение: `formatDate` оригинала опускает
              // год у дат ТЕКУЩЕГО года, а «подписка действует до 3 декабря»
              // без года не отвечает на вопрос, ради которого строку читают.
              // Форма при этом ровно та же, что была до задачи #121:
              // день + месяц словом + год.
              //
              // `fallback` возвращает поведение снесённой проверки
              // `Number.isNaN(d.getTime())`: битая строка с провода показывает
              // сырое значение, а не роняет экран `RangeError`-ом из `Intl`.
              value={(
                <DayDate
                  date={Math.floor(Date.parse(sub.expiresAt) / 1000)}
                  overrideIntlOptions={ALWAYS_YEAR}
                  fallback={sub.expiresAt}
                />
              )}
              translate
            />
          </Section>

          {sub.autoRenew ? (
            <Section footer="Premium.Manage.Hint">
              <Row
                icon={<TgIcon name="close" size={24} color="#ff595a" />}
                label={cancelling ? 'Premium.Manage.Cancelling' : 'Stars.Subscription.Cancel'}
                danger
                onClick={() => void cancel()}
              />
            </Section>
          ) : (
            <Section footer="Premium.Manage.AutoRenewOffHint">
              <Row label="Premium.Manage.AutoRenew" value={t('Off')} translate={false} />
            </Section>
          )}
        </>
      ) : (
        <Text size={15} color="var(--secondary-text-color)" style={{ textAlign: 'center', padding: 20 }}>
          {t('Premium.Manage.NoSubscription')}
        </Text>
      )}
    </SettingsScreen>
  )
}

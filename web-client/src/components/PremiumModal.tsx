// Модалка Telegram Premium — тело порт 1:1 из tweb `components/popups/premium.ts` +
// `components/premium/promoSlideTab.ts` (тарифы/фичи) на глобальные классы
// партиала `styles/tweb/popups/_premium.scss` (эталон — живой дамп
// `docs/tweb/dom/dumps/14-left-24-premium-popup.json`, читать `python3 -c
// "import json;print(json.load(open('...')))"`):
//
//   div.popup.popup-premium.active > div.popup-container.z-depth-1 >
//     div.tabs-container.premium-tabs.fixed-size >
//       div.premium-promo-tab.scrollable.scrollable-y.tabs-tab.premium-tab.active[.not-bottom] >
//         div.popup-header[.not-top][.is-visible] > .popup-header-background
//                                                  + button.btn-icon.popup-close > span.tgico
//                                                  + div.popup-title.i18n
//         div.popup-body >
//           div.popup-premium-header-image-container > (картинка)
//           div.popup-premium-heading-text-container > .-title + .-description (оба span.i18n)
//           form.popup-gift-premium-options > label.row.row-with-padding.row-clickable
//             .hover-effect.rp.row-grid.popup-gift-premium-option[.no-subtitle] (тарифы)
//           div.popup-premium-features-container > div.row.row-clickable.hover-effect.rp
//             .row-with-padding (фичи, row-media.row-media-small.premium-promo-tab-icon)
//     div.action-button-container > button.btn-primary.popup-gift-premium-confirm
//       .action-button.shimmer.rp
//
// НЕ портировано (вне периметра задачи — только «тело» и список тарифов/фич):
// второй таб `premium-feature-tab` (carousel фич с device-frame/dots) — у нас
// нет отдельного детального экрана на каждую фичу, строка фичи кликабельна
// визуально (класс `row-clickable` + ripple, как в tweb), но клик никуда не
// ведёт. `_premium.scss` портирован ЦЕЛИКОМ (правило Б индекса партиалов —
// «класс, который мы ещё не рендерим, не вырезаем»), поэтому стили карусели
// просто не матчатся, пока её нет.
//
// Скрим/карточка/z-depth-1 — общее с остальными попапами (styles/tweb/popups/_popup.scss).
// Показ/скрытие — классы tweb PopupElement (`active`/`hiding`), см. usePopupTransition
// в settings/kit.tsx: скрим набирает opacity, карточка едет translate3d(0, 3rem, 0) → 0
// за --popup-transition-time. Узел живёт в DOM до конца затухания — роль AnimatePresence,
// включая onExitComplete владельца.
//
// Sticky-заголовок (`.popup-header`) в tweb невидим, пока не проскроллили > 100px —
// онScroll-тумблер классов `not-top`/`is-visible`/`not-bottom` порт `onTabScroll`
// (promoSlideTab.ts:369-375) 1:1.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import IconButton from '../shared/ui/IconButton'
import Checkbox from '../shared/ui/Checkbox'
import { useRipple } from '../shared/ui/Ripple/useRipple'
import TgIcon from './TgIcon'
import type { IconName } from './TgIcon'
import PremiumCheckout from './PremiumCheckout'
import classNames from '../shared/lib/classNames'
import { usePopupTransition } from './settings/kit'
import { useT } from '../i18n'
import { PREMIUM_PLANS, planById, formatUsd, perMonthCents, discountPct, type PremiumPlan, type PremiumPlanId } from '../core/premium/plans'
import s from './PremiumModal.module.scss'

interface Feature {
  icon: IconName
  title: string
  subtitle: string
  color: string
  /** tweb `PremiumPromoFeature.new` (featuresConfig.ts) — бейдж `row-title-badge` */
  new?: boolean
}

// Feature list ported from tweb's premium/featuresConfig.ts, using its icon set
// and the orange→green colour ramp (PREMIUM_FEATURES_COLORS) sampled across it.
// «Last Seen Times» — реальный пункт tweb (`featuresConfig.ts` feature `last_seen`,
// `new: true`); заголовок — буквально из живого дампа (`span.i18n "Last Seen
// Times"`), подзаголовок — у нас нет локального langpack-файла tweb (строки тянутся
// с сервера), поэтому это краткий пересказ реальной функции (скрыть Last Seen
// от всех, продолжая видеть чужой), а не выдуманная фича.
const FEATURES: Feature[] = [
  { icon: 'stories', title: 'Stories', subtitle: 'Posting without limits, priority order, stealth mode, saved view history and more.', color: '#ef6922' },
  { icon: 'premium_limits', title: 'Doubled Limits', subtitle: 'Up to 1000 channels, 20 folders, 10 pinned chats and 20 public links.', color: '#e95a2c' },
  { icon: 'premium_filesize', title: 'Larger Uploads', subtitle: 'Upload files of up to 4 GB each.', color: '#e74e33' },
  { icon: 'premium_speed', title: 'Faster Downloads', subtitle: 'Download media and files at the maximum speed.', color: '#db374b' },
  { icon: 'premium_transcription', title: 'Voice-to-Text', subtitle: 'Convert voice messages into text.', color: '#cb3e6d' },
  { icon: 'premium_translate', title: 'Real-Time Translation', subtitle: 'Translate entire chats into your language.', color: '#bc4395' },
  { icon: 'premium_noads', title: 'No Ads', subtitle: 'Get rid of ads in public channels.', color: '#ab4ac4' },
  { icon: 'premium_reactions', title: 'Unique Reactions', subtitle: 'React with a vastly expanded set of emoji.', color: '#9b4fed' },
  { icon: 'premium_stickers', title: 'Premium Stickers', subtitle: 'Unlock exclusive animated stickers.', color: '#8958ff' },
  { icon: 'premium_emoji', title: 'Custom Emoji', subtitle: 'Use unique animated emoji anywhere in chats.', color: '#676bff' },
  { icon: 'premium_lastseen', title: 'Last Seen Times', subtitle: 'Hide your Last Seen time from everyone, while still seeing when others were last online.', color: '#5b79ff', new: true },
  { icon: 'premium_avatars', title: 'Animated Profile Pictures', subtitle: 'Upload a looping video as your profile picture.', color: '#4492ff' },
  { icon: 'premium_status', title: 'Emoji Status', subtitle: 'Show a unique animated status next to your name.', color: '#41a6a5' },
  { icon: 'premium_badge', title: 'Premium Badge', subtitle: 'Show a premium badge next to your name.', color: '#3eb26d' },
  { icon: 'premium_management', title: 'Chat Management', subtitle: 'Change default chat folder, archive and mute new chats.', color: '#3dbd4a' },
]

// Telegram-style gradient premium star — заменяет живой `img.popup-premium-header-image`
// (реального ассета `assets/img/premium-star.png` у нас нет); контейнер несёт
// класс tweb `popup-premium-header-image-container` (позиционирование целиком
// из партиала — абсолют, top:-.75rem, центр по X), сама картинка — свою вёрстку.
function PremiumStar() {
  return (
    <div className="popup-premium-header-image-container">
      <svg viewBox="0 0 100 100" width="96" height="96">
        <defs>
          <linearGradient id="prem-star" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9aa0ff" />
            <stop offset="55%" stopColor="#8d6bff" />
            <stop offset="100%" stopColor="#a45ee6" />
          </linearGradient>
        </defs>
        <path
          fill="url(#prem-star)"
          d="M50 8c2 0 3.8 1.2 4.7 3l9.5 19.2 21.2 3.1c4.4.6 6.2 6 3 9.1L73 54.5l3.6 21.1c.8 4.4-3.8 7.7-7.7 5.6L50 71.3 31.1 81.2c-3.9 2.1-8.5-1.2-7.7-5.6L27 54.5 11.6 42.4c-3.2-3.1-1.4-8.5 3-9.1l21.2-3.1L45.3 11C46.2 9.2 48 8 50 8z"
        />
        {/* sparkles */}
        <circle cx="78" cy="20" r="2.6" fill="#b9a8ff" />
        <circle cx="24" cy="30" r="1.8" fill="#b9a8ff" />
        <circle cx="84" cy="44" r="1.6" fill="#b9a8ff" />
      </svg>
    </div>
  )
}

/**
 * Строка тарифа — tweb `promoSlideTab.ts` `premiumOptionsForm` (row.ts Row с
 * `checkboxField`/`clickable: true`): `label.row.row-with-padding.row-clickable
 * .hover-effect.rp.row-grid.popup-gift-premium-option[.no-subtitle]`. Клик по
 * ЛЮБОЙ точке строки переключает радио нативно (label оборачивает input даже
 * через вложенный `label.checkbox-field` — так же, как в tweb), выделенный
 * ripple — свой per-строка (`useRipple` нельзя звать внутри `.map`, поэтому
 * строка — отдельный компонент).
 */
function PlanRow({ plan, active, onSelect }: { plan: PremiumPlan; active: boolean; onSelect: (id: PremiumPlanId) => void }) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()
  const discount = discountPct(plan)
  const hasSubtitle = discount > 0

  return (
    <label
      className={classNames(
        'row', 'row-with-padding', 'row-clickable', 'hover-effect', 'rp', 'row-grid', 'popup-gift-premium-option',
        hasSubtitle ? '' : 'no-subtitle',
      )}
      onPointerDown={onPointerDown}
    >
      {ripple}
      {hasSubtitle && (
        <div className="row-subtitle">
          <span>
            <span className="popup-gift-premium-discount">{`-${discount}%`}</span>
            <span className="i18n">{`${formatUsd(perMonthCents(plan))} ${t('Stars.Subscriptions.PerMonth')}`}</span>
          </span>
        </div>
      )}
      <Checkbox
        checked={active}
        shape="round"
        asRadio
        name="premium-period"
        className="checkbox-field-absolute disable-hover"
        onToggle={() => onSelect(plan.id)}
      />
      <div className="row-title">
        <span className="i18n">{t(plan.labelKey)}</span>
      </div>
      <span className="row-title-right-secondary row-right">{formatUsd(plan.priceCents)}</span>
    </label>
  )
}

/**
 * Строка фичи — tweb `promoSlideTab.ts::createFeatures` (row.ts Row +
 * `row.createMedia('small')` c классом `premium-promo-tab-icon`): в реальном
 * tweb клик открывает `featureSlideTab` (второй таб, не портирован — см.
 * докблок файла), поэтому классы кликабельности/ripple остаются (визуальный
 * 1:1), а обработчика клика нет.
 */
function FeatureRow({ feature }: { feature: Feature }) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()
  return (
    <div className="row row-clickable hover-effect rp row-with-padding" onPointerDown={onPointerDown}>
      {ripple}
      <div className="row-subtitle">
        <span className="i18n">{t(feature.subtitle)}</span>
      </div>
      <div className="row-title">
        <span className="i18n">{t(feature.title)}</span>
        {feature.new && (
          <span className="i18n row-title-badge" style={{ backgroundColor: feature.color }}>
            {t('New')}
          </span>
        )}
      </div>
      <div className="row-media row-media-small premium-promo-tab-icon" style={{ backgroundColor: feature.color }}>
        <TgIcon name={feature.icon} />
      </div>
    </div>
  )
}

export default function PremiumModal({ open, onClose, onExitComplete }: { open: boolean; onClose: () => void; onExitComplete?: () => void }) {
  const t = useT()
  const [plan, setPlan] = useState<PremiumPlanId>('12m')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const selected = planById(plan)
  const { mounted, cls } = usePopupTransition(open)

  // конец обратного перехода — владельцу (раньше это делал AnimatePresence)
  const wasMounted = useRef(mounted)
  useEffect(() => {
    if (wasMounted.current && !mounted) onExitComplete?.()
    wasMounted.current = mounted
  }, [mounted, onExitComplete])

  // Sticky-заголовок — порт `promoSlideTab.ts::onTabScroll` (369-375): показывается
  // компактный `.popup-header` только после 100px скролла, бордер под скроллером
  // (`not-bottom`) снимается у самого низа. Сбрасываем на каждое свежее открытие —
  // в tweb это новый DOM-инстанс попапа, у нас компонент переиспользуется.
  const tabRef = useRef<HTMLDivElement>(null)
  const [notTop, setNotTop] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [notBottom, setNotBottom] = useState(true)
  useEffect(() => {
    if (!open) return
    setNotTop(false)
    setIsVisible(false)
    setNotBottom(true)
  }, [open])
  const onTabScroll = useCallback(() => {
    const el = tabRef.current
    if (!el) return
    const { scrollTop, scrollHeight, offsetHeight } = el
    setIsVisible(scrollTop > 100)
    setNotTop(scrollTop > 0)
    setNotBottom(scrollHeight - scrollTop > offsetHeight)
  }, [])

  const { onPointerDown: ctaPointerDown, ripple: ctaRipple } = useRipple()

  // Показ/скрытие — классы tweb `PopupElement` (`active`/`hiding`), см.
  // usePopupTransition в settings/kit.tsx: скрим набирает opacity, карточка едет
  // translate3d(0, 3rem, 0) → 0 за --popup-transition-time. Узел живёт в DOM до
  // конца затухания — роль AnimatePresence, включая onExitComplete владельца.
  if (!mounted) return null

  return createPortal(
    // Модификатор попапа и `z-depth-1` — как в живом tweb
    // (дамп `14-left-24-premium-popup.json`: div.popup.popup-premium.active >
    // div.popup-container.z-depth-1).
    <div className={classNames('popup', 'popup-premium', cls, s.overlay)} onClick={onClose}>
      <div className={classNames('popup-container', 'z-depth-1')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="tabs-container premium-tabs fixed-size">
          <div
            ref={tabRef}
            onScroll={onTabScroll}
            className={classNames(
              'premium-promo-tab', 'scrollable', 'scrollable-y', 'tabs-tab', 'premium-tab', 'active',
              notBottom ? 'not-bottom' : '',
            )}
          >
            <div className={classNames('popup-header', notTop ? 'not-top' : '', isVisible ? 'is-visible' : '')}>
              <div className="popup-header-background" />
              <IconButton className="popup-close" onClick={onClose} color="var(--secondary-text-color)">
                <TgIcon name="close" size={22} />
              </IconButton>
              <div className={classNames('popup-title', 'i18n')}>{t('Premium.Boarding.Title')}</div>
            </div>

            <div className="popup-body">
              <PremiumStar />

              <div className="popup-premium-heading-text-container">
                <div className="popup-premium-heading-text-title">
                  <span className="i18n">{t('Premium.Boarding.Title')}</span>
                </div>
                <div className="popup-premium-heading-text-description">
                  <span className="i18n">{t('Premium.Feature.Intro')}</span>
                </div>
              </div>

              <form className="popup-gift-premium-options" onSubmit={(e) => e.preventDefault()}>
                {PREMIUM_PLANS.map((p) => (
                  <PlanRow key={p.id} plan={p} active={p.id === plan} onSelect={setPlan} />
                ))}
              </form>

              <div className="popup-premium-features-container">
                {FEATURES.map((f) => (
                  <FeatureRow key={f.title} feature={f} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* sticky CTA — tweb `createActionButton` (popups/premium.ts:223-256):
            `Button('btn-primary popup-gift-premium-confirm action-button shimmer')`
            + ripple; своей масштаб-анимации по hover/tap у tweb нет — отклик
            даёт только ripple и фон (_button.scss:75-77). */}
        <div className="action-button-container">
          <button
            type="button"
            className="btn-primary popup-gift-premium-confirm action-button shimmer rp"
            onPointerDown={ctaPointerDown}
            onClick={() => setCheckoutOpen(true)}
          >
            {ctaRipple}
            <span className="i18n">{`${t('Premium.SubscribeFor')} ${formatUsd(perMonthCents(selected))} ${t('Stars.Subscriptions.PerMonth')}`}</span>
          </button>
        </div>
      </div>

      {/* Мок-чекаут (оплата картой) для выбранного плана */}
      <PremiumCheckout
        plan={selected}
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onSuccess={onClose}
      />
    </div>,
    document.body,
  )
}

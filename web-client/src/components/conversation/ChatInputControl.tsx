// src/components/conversation/ChatInputControl.tsx
// Плашка-замена инпута — tweb `chat/input.ts:566-568` + `chat/controlPlate.tsx`:
//
//   div.chat-input-control.chat-input-wrapper        ← absolute поверх строки ввода,
//     div.chat-input-plate.rows-wrapper-row            visibility:hidden/opacity:0 (_chat.scss:561-571)
//       div.chat-input-plate-side   > button.btn-icon.hide.rp   (directControlBtn)
//       div.chat-input-plate-center > 8 × button.chat-input-control-button
//       div.chat-input-plate-side   > button.btn-icon.hide.rp   (giftControlBtn)
//
// Ключевое свойство оригинала: ВСЕ восемь кнопок всегда в DOM (создаются один раз,
// input.ts:1454-1512), а `finishPeerChange` (input.ts:2445-2567) лишь снимает `hide`
// с одной — цепочкой `haveSomethingInControl`, где первая сработавшая ветка «съедает»
// флаг. Порядок узлов = порядок создания: START · Unblock · JOIN · Mute · Premium ·
// Frozen · Unpin All · Open Chat. Здесь воспроизведена та же цепочка: фич, под
// которые у нас нет данных (freeze, join, premium, ChatType.Pinned/Saved), у кнопок
// нет и условий — узлы структурные и всегда `hide`, как в tweb до подходящего пира.
//
// Видимость самой плашки решает не этот компонент, а `_center()` в Chat.tsx
// (tweb getNeededFakeContainer, input.ts:1899-1918) — см. isControlNeeded ниже.
import { memo, type ReactNode } from 'react'
import TgIcon from '../TgIcon'
import IconButton from '../../shared/ui/IconButton'
import classNames from '../../shared/lib/classNames'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import { useT } from '../../i18n'

/** Состояние handshake секретного чата (accept / ожидание / отказ). */
export interface SecretHandshake {
  status: 'requested' | 'awaiting' | 'rejected'
  busy: boolean
  onAccept: () => void
  onReject: () => void
}

export interface ControlFlags {
  /** tweb unblockBtn: `!isBot && peerId.isUser()` (input.ts:2533) */
  canUnblock: boolean
  /** tweb botStartBtn: бот без истории (isStartButtonNeeded) */
  botStart: boolean
  /** tweb channelMuteBtn: `cantPost && !channel.left` (input.ts:2470-2480) */
  channelMute: boolean
  /** tweb giftControlBtn (правый слот): `isBroadcast` (input.ts:2492) */
  gift: boolean
  // ── отступления от tweb: аналогов в input.ts нет, рендерятся только когда активны,
  // чтобы в обычном чате дерево совпадало с эталоном узел в узел ──
  /** группа запрещает участникам писать (дефолт-права) */
  groupRestricted: boolean
  /** тред закрытого форум-топика — только чтение */
  threadClosed: boolean
  /** секретный чат до завершения E2E-handshake */
  secret: SecretHandshake | null
}

/**
 * Порт `getNeededFakeContainer` (input.ts:1899-1918) в части плашки: показывать
 * ли `.chat-input-control` вместо строки ввода. Кнопка Unblock сюда НЕ входит —
 * в tweb плашку открывает `chat.isUserBlocked`, а не сам факт приватного чата
 * (поэтому в эталоне Unblock без `hide`, а плашка невидима).
 */
export function isControlNeeded(f: ControlFlags): boolean {
  return f.botStart || f.channelMute || f.groupRestricted || f.threadClosed || !!f.secret
}

interface PlateButtonProps {
  /** tweb makeControlButton(key, filled): filled → `btn-color-primary`, иначе `btn-transparent` */
  filled?: boolean
  hide: boolean
  /** tweb стирает `.c-ripple` вместе с содержимым (`replaceChildren` при смене лейбла) */
  noRipple?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}

function PlateButton({ filled, hide, noRipple, disabled, onClick, children }: PlateButtonProps) {
  const { onPointerDown, ripple } = useRipple()
  return (
    <button
      type="button"
      disabled={disabled}
      className={classNames(
        'btn-primary', filled ? 'btn-color-primary' : 'btn-transparent', 'text-bold',
        'chat-input-control-button', 'chat-input-plate-button', 'rp', hide ? 'hide' : '',
      )}
      onPointerDown={noRipple ? undefined : onPointerDown}
      onClick={onClick}
    >
      {noRipple ? null : ripple}
      {children}
    </button>
  )
}

export interface ChatInputControlProps extends ControlFlags {
  /** data-peer-id на `span.peer-title` внутри premium-кнопки (tweb wrapPeerTitle) */
  peerId?: number
  muted: boolean
  onBotStart: () => void
  onToggleMute: () => void
  onGift: () => void
  /** отступление от tweb: «Предложить пост» вторым центром в канале */
  onSuggestPost?: () => void
}

function ChatInputControl(p: ChatInputControlProps) {
  const t = useT()

  // Цепочка tweb `haveSomethingInControl` (input.ts:2448-2567): первая сработавшая
  // ветка забирает флаг, остальные получают `hide`.
  let taken = false
  const take = (good: boolean) => {
    const g = !taken && good
    taken ||= g
    return g
  }
  const frozen = take(false) // appConfig.freeze_since_date — фичи нет
  const join = take(false) // getJoinButtonType() — состояния «не подписан» в колонке нет
  const channelMute = take(p.channelMute)
  const pinned = take(false) // ChatType.Pinned — закреплённые открываются попапом
  const openChat = take(false) // ChatType.Saved с чужим threadId — тредов «Избранного» нет
  const premium = take(false) // isPremiumRequired — фичи нет
  // отступления: собственные состояния встают в цепочку перед Unblock
  const groupRestricted = take(p.groupRestricted)
  const threadClosed = take(p.threadClosed)
  const secret = take(!!p.secret)
  const unblock = take(p.canUnblock)
  // input.ts:2567 — START прячется, если что-то выше уже заняло плашку
  const botStartHidden = taken

  return (
    <div className="chat-input-control chat-input-wrapper">
      <div className="chat-input-plate rows-wrapper-row">
        {/* левый слот — tweb directControlBtn (linked_monoforum_id); фичи нет */}
        <div className="chat-input-plate-side">
          <IconButton className="hide">
            <TgIcon name="comments" className="button-icon" size="inherit" />
          </IconButton>
        </div>

        <div className="chat-input-plate-center">
          <PlateButton hide={botStartHidden} onClick={p.onBotStart}>
            <span className="i18n">{t('BotStart')}</span>
          </PlateButton>
          {/* Unblock: фичи разблокировки у нас нет, кнопка структурная — но её
              `hide` считается по тому же условию, что в tweb. */}
          <PlateButton hide={!unblock}>
            <span className="i18n">{t('Unblock')}</span>
          </PlateButton>
          <PlateButton filled hide={!join}>
            <span className="i18n">{t('ChannelJoin')}</span>
          </PlateButton>
          {/* tweb обновляет лейбл через replaceChildren — вместе с ним из кнопки
              пропадает и `.c-ripple`; повторяем итоговое дерево. */}
          <PlateButton noRipple hide={!channelMute} onClick={p.onToggleMute}>
            <span className="i18n">{t(p.muted ? 'ChatList.Context.Unmute' : 'ChatList.Context.Mute')}</span>
          </PlateButton>
          <PlateButton hide={!premium}>
            <span className="i18n">
              <span className="peer-title" data-peer-id={p.peerId} />
              <br />
              <a>{t('Chat.Frozen.LearnMore')}</a>
            </span>
          </PlateButton>
          <PlateButton hide={!frozen}>
            <span className="chat-input-frozen-text">
              <span className="i18n danger">{t('Chat.Input.FrozenButton1')}</span>
              <span className="i18n secondary chat-input-frozen-text-subtitle">{t('Chat.Input.FrozenButton2')}</span>
            </span>
          </PlateButton>
          <PlateButton noRipple hide={!pinned}>
            <span className="i18n">{t('Chat.Input.UnpinAll')}</span>
          </PlateButton>
          <PlateButton hide={!openChat}>
            <span className="i18n">{t('OpenChat')}</span>
          </PlateButton>

          {/* ── отступление от tweb: состояний ниже в input.ts нет ── */}
          {p.groupRestricted && (
            <PlateButton hide={!groupRestricted}>
              <TgIcon name="permissions" className="button-icon" size="inherit" />
              <span className="i18n">{t('GlobalSendMessageRestricted')}</span>
            </PlateButton>
          )}
          {p.threadClosed && (
            <PlateButton hide={!threadClosed}>
              <TgIcon name="lock" className="button-icon" size="inherit" />
              <span className="i18n">{t('ForumTopic.Closed')}</span>
            </PlateButton>
          )}
          {p.onSuggestPost && (
            <PlateButton hide={!channelMute} onClick={p.onSuggestPost}>
              <span className="i18n">{t('SuggestedPosts.SuggestAPost')}</span>
            </PlateButton>
          )}
          {p.secret && (
            p.secret.status === 'requested' ? (
              <>
                <PlateButton filled hide={!secret} disabled={p.secret.busy} onClick={p.secret.onAccept}>
                  <span className="i18n">{t('SecretChat.Accept')}</span>
                </PlateButton>
                <PlateButton hide={!secret} disabled={p.secret.busy} onClick={p.secret.onReject}>
                  <span className="i18n">{t('SecretChat.Reject')}</span>
                </PlateButton>
              </>
            ) : (
              <span className="i18n secondary">
                {p.secret.status === 'rejected'
                  ? t('SecretChat.Rejected')
                  : t('SecretChat.Awaiting')}
              </span>
            )
          )}
        </div>

        {/* правый слот — tweb giftControlBtn (isBroadcast) */}
        <div className="chat-input-plate-side">
          <IconButton className={p.gift ? '' : 'hide'} onClick={p.onGift}>
            <TgIcon name="gift" className="button-icon" size="inherit" />
          </IconButton>
        </div>
      </div>

      {/* Второй ребёнок контейнера в tweb — `.reply-in-topic-overlay`, но он под
          флагом REPLY_IN_TOPIC и в живом дампе выключен, поэтому узла тут нет. */}
    </div>
  )
}

export default memo(ChatInputControl)

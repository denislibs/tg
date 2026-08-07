// src/components/messages/MessageContent.tsx
// Содержимое одного бабла, выбираемое по m.type (roundVideo/voice/album/sticker/
// media/big-emoji/document/audio/geo/contact/call/gift/giveaway/poll/checklist/text).
// Презентационно: вынесено из MessageRow, чтобы держать мемоизированный ряд тонким.
// Мемо/пропсы MessageRow не затронуты — этот компонент рендерится ровно там же,
// где раньше был инлайн-тернарник (внутри ZoneBody), с теми же данными.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { withAlpha } from '../../core/format/cssColor'
import { mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import TgIcon from '../TgIcon'
import RealMediaBubble from './RealMediaBubble'
import SecretMediaBubble from './SecretMediaBubble'
import PollBubble from './PollBubble'
import ChecklistBubble from './ChecklistBubble'
import GiftBubble from './GiftBubble'
import GiveawayBubble from './GiveawayBubble'
import InlineKeyboard from './InlineKeyboard'
import AlbumGrid from './AlbumGrid'
import VoiceMessage from './VoiceMessage'
import { MessageReactions } from './MessageReactions'
import {
  Ticks,
  BubbleTail,
  bubbleRadius,
  BUBBLE_R_BIG,
  BUBBLE_R_MED,
  DocumentBubble,
  AudioBubble,
  RoundVideoBubble,
  WebPagePreview,
  FactCheckBox,
  CallBubble,
  RoundVideoRealBubble,
  GeoBubble,
  ContactBubble,
  SecretTimer,
} from './MessageBubbles'
import RichText, { emojiOnlyCount } from '../RichText'
import StickerMedia from '../StickerMedia'
import { useAnimatedEmoji } from '../../core/hooks/useAnimatedEmoji'
import { effectForEmoji, playEmojiEffect, type EmojiEffectKind } from '../../core/effects/emojiEffects'
import { peerColor } from '../peerColor'
import { fmtViews } from '../../core/format/fmtViews'
import { useT } from '../../i18n'
import { useSettings, useTimeFormatter } from '../../settings'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import type { FeedFns } from './MessageRow'
import s from './MessageRow.module.scss'

// Радиус media/voice-бабла: скруглён везде, кроме хвостового угла последнего в группе.
function mediaRadius(out: boolean, lastInGroup: boolean): string {
  const B = BUBBLE_R_BIG
  const last = lastInGroup ? 0 : BUBBLE_R_MED
  return out ? `${B}px ${B}px ${last}px ${B}px` : `${B}px ${B}px ${B}px ${last}px`
}

// The view-count span (count + eye icon) shown in a channel post's meta line.
function ViewsMeta({ views, className }: { views: number; className: string }) {
  return (
    <span className={className}>
      <TgIcon name="channelviews" size={15} color="var(--b-time)" />
      {fmtViews(views)}
    </span>
  )
}

// The forward-count span (count + forward icon) shown in a channel post's meta
// line, alongside the view count (tweb message.forwards / shares tooltip).
function ForwardsMeta({ forwards, className }: { forwards: number; className: string }) {
  return (
    <span className={className}>
      <TgIcon name="forward" size={15} color="var(--b-time)" />
      {fmtViews(forwards)}
    </span>
  )
}

// Эмодзи-глиф вида эффекта (наш аналог Telegram message effects) — для кнопки
// повторного проигрывания у бабла.
const EFFECT_EMOJI: Record<EmojiEffectKind, string> = {
  fireworks: '🎆', confetti: '🎉', hearts: '❤️', thumbs: '👍', poop: '💩', cake: '🎂',
}

// Кнопка повтора эффекта сообщения: клик запускает полноэкранный canvas-эффект
// из центра кнопки (tweb: тап по сообщению с эффектом переигрывает его).
function EffectReplayButton({ kind }: { kind: EmojiEffectKind }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className={s.effectReplay}
      onClick={(e) => {
        e.stopPropagation()
        const r = ref.current?.getBoundingClientRect()
        playEmojiEffect(kind, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined)
      }}
      aria-label="Replay message effect"
    >
      {EFFECT_EMOJI[kind]}
    </button>
  )
}

// Big emoji (tweb bubbles.ts bigEmojis): сообщение из одних только эмодзи, без
// текста, — крупный глиф без фона бабла. РОВНО один эмодзи, у которого есть
// лотти в сид-наборе animated_emoji, рендерится анимированным стикером (tweb
// getAnimatedEmojiSticker → wrapSticker): autoplay ОДИН раз (не loop), replay по
// клику. Клик по эффект-эмодзи (❤️/🎉/👍/…) — и по анимированному, и по
// шрифтовому — запускает полноэкранный canvas-эффект из центра бабла.
// Шкала размеров 1:1 tweb bubbles.ts:319-328 (BIG_EMOJI_SIZES, индекс — число
// эмодзи в сообщении; count клампится к 7 — длине этой шкалы, tweb bubbles.ts:7373).
// Применяется ТОЛЬКО к шрифтовому глифу (tweb _chatBubble.scss:730 &:not(.sticker)) —
// у анимированного эмодзи-стикера свой фиксированный размер, см. ANIMATED_EMOJI_SIZE.
export const BIG_EMOJI_SIZES = [0, 96, 90, 84, 72, 60, 48, 36]
// Размер шрифтового глифа по count, с клампом (tweb bubbles.ts:7373
// Math.min(BIG_EMOJI_SIZES_LENGTH, …)) — count после Task 3 не ограничен сверху.
export function bigEmojiGlyphSize(count: number): number {
  return BIG_EMOJI_SIZES[Math.min(7, count)]
}
// Анимированный эмодзи-стикер (tweb mediaSizes.ts:72,90 emojiSticker: 112×112,
// оба брейкпоинта desktop/handhelds) — фиксированный бокс, НЕ зависит от
// шрифтовой шкалы выше (tweb bubbles.ts:6109 boxSize = isEmoji ? sizes.emojiSticker : …).
const ANIMATED_EMOJI_SIZE = 112
function BigEmojiBubble({ m, count, selecting, fmtTime }: {
  m: ConvMsg
  count: number
  selecting: boolean
  fmtTime: (hhmm?: string) => string | undefined
}) {
  const emoji = count === 1 ? (m.text ?? '').trim() : null
  const animated = useAnimatedEmoji(emoji)
  const [replayToken, setReplayToken] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const effect = emoji ? effectForEmoji(emoji) : null
  const size = bigEmojiGlyphSize(count)
  // В selecting клик занят выбором, у error-бабла — меню переотправки.
  const clickable = !selecting && m.status !== 'error' && (effect != null || animated != null)
  const onClick = clickable
    ? () => {
        if (effect) {
          const r = boxRef.current?.getBoundingClientRect()
          playEmojiEffect(effect, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined)
        }
        if (animated) setReplayToken((tk) => tk + 1)
      }
    : undefined
  // Шкала — CSS-переменная на контейнере (tweb bubbles.ts:7381 --emoji-size),
  // глиф читает её через var() (см. .stickerGlyph в MessageRow.module.scss).
  const boxStyle: CSSProperties = { '--emoji-size': `${size}px`, ...(clickable ? { cursor: 'pointer' } : {}) } as CSSProperties
  return (
    <div ref={boxRef} className={s.sticker} onClick={onClick} style={boxStyle}>
      {animated ? (
        <StickerMedia mediaId={animated.mediaId} width={ANIMATED_EMOJI_SIZE} height={ANIMATED_EMOJI_SIZE} autoplay replayToken={replayToken} />
      ) : (
        <div className={s.stickerGlyph} style={{ padding: '2px 0' }}>
          {m.text}
        </div>
      )}
      <div className={s.stickerMeta}>
        <Text size="var(--messages-time-text-size)" color="#fff">{fmtTime(m.time)}</Text>
        <Ticks status={m.status} color="var(--b-tick)" />
      </div>
    </div>
  )
}

// Стикер с бэка (m.type 'sticker' + mediaId): бокс аспект-фитится в 200×200
// (tweb mediaSizes desktop static/animatedSticker), lottie-json играет через
// lottie-web c loop из настройки «Зацикливать анимации», webp/png — <img>
// (различает StickerMedia). Бейдж времени — тот же, что у big-emoji.
const STICKER_BOX = 200
function StickerRealBubble({ m, fmtTime }: { m: ConvMsg; fmtTime: (hhmm?: string) => string | undefined }) {
  const loopStickers = useSettings((st) => st.loopStickers)
  let w = STICKER_BOX
  let h = STICKER_BOX
  if (m.mediaWidth && m.mediaHeight) {
    const k = Math.min(STICKER_BOX / m.mediaWidth, STICKER_BOX / m.mediaHeight)
    w = Math.round(m.mediaWidth * k)
    h = Math.round(m.mediaHeight * k)
  }
  return (
    <div className={s.stickerReal}>
      <StickerMedia mediaId={m.mediaId!} width={w} height={h} autoplay loop={loopStickers} />
      <div className={s.stickerMeta}>
        <Text size="var(--messages-time-text-size)" color="#fff">{fmtTime(m.time)}</Text>
        <Ticks status={m.status} color="var(--b-tick)" />
      </div>
    </div>
  )
}

// Small rounded thumbnail of the replied-to message's photo/video, shown in the
// quote box (Telegram). Synchronous URL via the main-thread media token.
function ReplyThumb({ id }: { id: number }) {
  useMediaTokenVersion()
  if (!hasMediaToken()) return null
  return <img className={s.replyThumb} src={mediaThumbUrl(id)} alt="" loading="lazy" decoding="async" />
}

export interface MessageContentProps {
  m: ConvMsg
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  selecting: boolean
  autoDownload?: ChatAutoDownload
  albumSelectedKey?: string
  footer?: ReactNode
  // У сообщения есть реакции для показа (посчитано в MessageRow с учётом selecting/id).
  showReactions: boolean
  // Ряд уже был смонтирован, когда появились реакции → анимируем вход первого чипа.
  rowLive: boolean
  feedFns: FeedFns
}

export default function MessageContent({
  m, out, firstInGroup, lastInGroup, selecting, autoDownload, albumSelectedKey, footer, showReactions, rowLive, feedFns,
}: MessageContentProps) {
  const t = useT()
  const fmtTime = useTimeFormatter()
  const bigEmoji = m.type === 'text' && m.text ? emojiOnlyCount(m.text) : 0
  // Block-level content (code block / quote) takes the full bubble width, so the
  // time drops onto its own line below it (right-aligned).
  const hasBlock = m.entities?.some((e) => e.type === 'pre' || e.type === 'blockquote') ?? false

  // Единый Block-ряд реакций (tweb ReactionsElement). `trailing` вливает время+тики
  // в конец строки (tweb appendBubbleTime: при наличии реакций timeSpan переезжает
  // в reactions-элемент). alignEnd прижимает вправо у исходящих.
  const reactionsRow = (trailing?: ReactNode) =>
    showReactions ? (
      <MessageReactions
        reactions={m.reactions ?? []}
        star={m.starReaction && m.starReaction.total > 0 ? m.starReaction : undefined}
        rowLive={rowLive}
        trailing={trailing}
        onToggle={(emoji) => feedFns.toggleReaction(m.id!, emoji)}
        onShow={(x, y) => feedFns.showReactedUsers(m.id!, x, y)}
        onStar={() => feedFns.openStarReaction(m.id!)}
      />
    ) : null

  // «Bare»-типы без контейнера для контента (стикер/эмодзи/кружок/голос-без-медиа/
  // документ/аудио/гео/контакт/звонок): реакции — колонкой ПОД контентом, прижаты
  // к inline-концу контента (tweb is-message-empty: reactions в bubble-content-wrapper,
  // margin-inline-start:auto). Время у этих типов остаётся при контенте (плавающая
  // пилюля / voice-мета), в строку чипов не вливается.
  const withReactionsBelow = (content: ReactNode) =>
    showReactions ? (
      <div className={s.emptyMediaCol}>
        {content}
        {reactionsRow()}
      </div>
    ) : content

  // Время+тики текстового бабла. При наличии реакций (tweb appendBubbleTime) этот
  // узел уходит trailing-ом в строку чипов, а из строки текста убирается; блочный
  // (full-width) режим — только когда время осталось на своей строке под кодоблоком.
  const textMeta = (
    <span className={classNames(s.meta, hasBlock && !showReactions ? s.block : '')}>
      {m.effect && <EffectReplayButton kind={m.effect} />}
      {m.views ? <ViewsMeta views={m.views} className={s.metaViews} /> : null}
      {m.forwards ? <ForwardsMeta forwards={m.forwards} className={s.metaViews} /> : null}
      {m.secret && <SecretTimer destructAt={m.destructAt} ttlSeconds={m.ttlSeconds} color="var(--b-time)" />}
      <span className={s.metaTime}>{m.edited ? `${t('edited')} ` : ''}{fmtTime(m.time)}</span>
      <Ticks status={m.status} color="var(--b-tick)" />
    </span>
  )
  // Время+тики для poll/checklist (простое: время + тики).
  const simpleMeta = (
    <span className={s.meta}>
      <span className={s.metaTime}>{fmtTime(m.time)}</span>
      <Ticks status={m.status} color="var(--b-tick)" />
    </span>
  )

  return (
    <>
        {m.mediaId && m.type === 'roundVideo' ? (
          withReactionsBelow(
            <RoundVideoRealBubble
              m={m}
              onPlayed={m.id != null ? () => feedFns.mediaPlayed(m.id as number) : undefined}
              onSoundPlay={m.id != null ? (el) => feedFns.roundPlaying(m.id as number, el) : undefined}
            />,
          )
        ) : m.mediaId && m.type === 'voice' ? (
          <div className={s.voiceMedia} style={{ borderRadius: mediaRadius(out, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <VoiceMessage
              mediaId={m.mediaId}
              msgId={m.id}
              chatId={m.chatId}
              transcription={m.transcription}
              secretMedia={m.secretMedia}
              out={out}
              time={m.time}
              status={m.status}
              mediaUnread={m.mediaUnread}
              tickColor="var(--b-tick)"
              onPlay={() => feedFns.playVoice(m.mediaId as number)}
            />
            {showReactions && <div className={s.reactionsPad}>{reactionsRow()}</div>}
          </div>
        ) : m.type === 'album' && m.albumItems ? (
          // Альбом (медиагруппа): грид из элементов, подпись — под гридом.
          <div className={s.media}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div
              className={classNames(s.mediaInner, s.framed)}
              style={{ borderRadius: mediaRadius(out, lastInGroup) }}
            >
              <AlbumGrid
                items={m.albumItems}
                selecting={selecting}
                selectedKey={albumSelectedKey}
                time={m.text ? undefined : m.time}
                status={m.status}
                out={out}
                onToggle={feedFns.toggleSelect}
                onOpen={feedFns.openLightbox}
                autoDownload={autoDownload}
                radius={m.text || showReactions ? '14px 14px 0 0' : '14px'}
              />
              {m.text ? (
                <div className={s.mediaCaption}>
                  <span className={s.mediaText}>
                    <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  </span>
                  {m.time && (
                    <span className={s.mediaTime}>
                      <span className={s.mediaTimeText} style={{ color: out ? 'var(--message-out-primary-color)' : 'var(--secondary-text-color)' }}>
                        {m.time}
                      </span>
                      {out && <Ticks status={m.status} color="var(--b-tick)" />}
                    </span>
                  )}
                </div>
              ) : null}
              {showReactions && <div className={s.reactionsPad}>{reactionsRow()}</div>}
            </div>
          </div>
        ) : m.type === 'sticker' && m.mediaId != null ? (
          // Стикер (tweb .bubble.is-sticker + wrappers/sticker.ts): без фона
          // бабла и хвостика; бокс аспект-фитится в 200×200 (mediaSizes
          // staticSticker/animatedSticker desktop), lottie играет с loop из
          // настроек; время+тики бейджем поверх нижнего угла, реакции — снаружи
          // reply/имя в группе не рисуются (как voice/round). Реакции — колонкой под
          // стикером, прижаты к его inline-концу (tweb is-message-empty).
          withReactionsBelow(<StickerRealBubble m={m} fmtTime={fmtTime} />)
        ) : m.mediaId != null || m.localUrl || (m.clientId != null && m.mediaName != null) || m.paidMedia?.locked ? (
          // Outer (relative, NOT clipped) carries the tail; the inner clips the media
          // to the rounded corners. The tailed corner is squared off (like other bubbles).
          // localUrl без mediaId = исходящее фото/видео в процессе аплоада;
          // clientId+mediaName без mediaId = исходящий документ/аудио в процессе
          // аплоада (кольцо прогресса + отмена рисует RealMediaBubble).
          <div className={s.media}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div
              className={classNames(s.mediaInner, m.type === 'photo' || m.type === 'video' ? s.framed : '')}
              style={{ borderRadius: mediaRadius(out, lastInGroup) }}
            >
              {m.secretMedia ? (
                // Секретное медиа (E2E): fetch ciphertext → decrypt → blob-objectURL.
                // Прямой src=mediaContentUrl не годится — сервер хранит только шифртекст.
                <SecretMediaBubble
                  secretMedia={m.secretMedia}
                  out={out}
                  time={m.text ? undefined : m.time}
                  status={m.status}
                  tickColor="var(--b-tick)"
                  localUrl={m.localUrl}
                  radius={(m.type === 'photo' || m.type === 'video') ? (m.text || showReactions ? '14px 14px 0 0' : '14px') : undefined}
                  onOpen={feedFns.openLightbox}
                />
              ) : (
                <RealMediaBubble
                  mediaId={m.mediaId}
                  type={m.type}
                  width={m.mediaWidth}
                  height={m.mediaHeight}
                  mime={m.mediaMime}
                  blur={m.mediaBlur}
                  hasThumb={m.mediaHasThumb}
                  duration={m.mediaDuration}
                  size={m.mediaSize}
                  fileName={m.mediaName}
                  out={out}
                  time={m.text ? undefined : m.time}
                  status={m.status}
                  tickColor="var(--b-tick)"
                  onOpen={feedFns.openLightbox}
                  autoDownload={autoDownload}
                  localUrl={m.localUrl}
                  clientId={m.clientId}
                  onCancelUpload={feedFns.cancelUpload}
                  radius={(m.type === 'photo' || m.type === 'video') ? (m.text || showReactions ? '14px 14px 0 0' : '14px') : undefined}
                  paidMedia={m.paidMedia}
                  onUnlockPaid={m.paidMedia?.locked && m.id != null ? () => feedFns.unlockPaid(m.id as number) : undefined}
                />
              )}
              {m.text ? (
                <div className={s.mediaCaption}>
                  <span className={s.mediaText}>
                    <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  </span>
                  {m.time && (
                    <span className={s.mediaTime}>
                      {m.effect && <EffectReplayButton kind={m.effect} />}
                      {/* truthy как в tweb (messageRender.ts): views=0 приходит для не-канальных сообщений */}
                      {m.views ? <ViewsMeta views={m.views} className={s.metaViews} /> : null}
                      {m.forwards ? <ForwardsMeta forwards={m.forwards} className={s.metaViews} /> : null}
                      <span className={s.mediaTimeText} style={{ color: out ? 'var(--message-out-primary-color)' : 'var(--secondary-text-color)' }}>
                        {m.time}
                      </span>
                      {out && <Ticks status={m.status} color="var(--b-tick)" />}
                    </span>
                  )}
                </div>
              ) : null}
              {showReactions && <div className={s.reactionsPad}>{reactionsRow()}</div>}
              {footer && <div className={s.footerMedia}>{footer}</div>}
            </div>
          </div>
        ) : bigEmoji ? (
          withReactionsBelow(<BigEmojiBubble m={m} count={bigEmoji} selecting={selecting} fmtTime={fmtTime} />)
        ) : m.type === 'voice' ? (
          withReactionsBelow(
          <div className={s.voice} style={{ borderRadius: mediaRadius(out, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div className={s.voiceBtn}>
              <TgIcon name="play" />
            </div>
            <div className={s.voiceBody}>
              <div className={s.wave}>
                {(m.waveform ?? []).map((h, wi) => (
                  <div key={wi} className={s.waveBar} style={{ height: `${Math.round(6 + h * 16)}px` }} />
                ))}
              </div>
              <div className={s.voiceMeta}>
                <Text size={12.5} color="var(--b-secondary)">{m.duration}</Text>
                <div className={s.spacer} />
                <Text size="var(--messages-time-text-size)" color="var(--b-time)">{fmtTime(m.time)}</Text>
                <Ticks status={m.status} color="var(--b-tick)" />
              </div>
            </div>
          </div>,
          )
        ) : m.type === 'document' ? (
          withReactionsBelow(<DocumentBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />)
        ) : m.type === 'audio' ? (
          withReactionsBelow(<AudioBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />)
        ) : m.type === 'roundVideo' ? (
          withReactionsBelow(<RoundVideoBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />)
        ) : m.type === 'geo' && m.geo ? (
          withReactionsBelow(<GeoBubble m={m} out={out} lastInGroup={lastInGroup} radius={mediaRadius(out, lastInGroup)} />)
        ) : m.type === 'contact' && m.contact ? (
          withReactionsBelow(
          <ContactBubble
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            onOpen={selecting ? undefined : () => feedFns.openSender(m.contact!.userId, m.contact!.name)}
          />,
          )
        ) : m.type === 'call' ? (
          withReactionsBelow(
          <CallBubble
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            onClick={selecting ? undefined : () => feedFns.recall(!!m.call?.video)}
          />,
          )
        ) : m.type === 'gift' && m.gift ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <GiftBubble gift={m.gift} out={out} />
            {reactionsRow()}
          </div>
        ) : m.type === 'giveaway' && m.giveaway ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <GiveawayBubble giveaway={m.giveaway} />
            {reactionsRow()}
          </div>
        ) : m.type === 'poll' && m.poll ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            {!out && m.sender && firstInGroup && (
              <Text size={14} weight={600} color={m.senderColor ?? peerColor(m.sender)}>
                {m.sender}
              </Text>
            )}
            <PollBubble poll={m.poll} out={out} />
            {showReactions ? (
              reactionsRow(simpleMeta)
            ) : (
              <div className={s.textLine} style={{ justifyContent: 'flex-end' }}>{simpleMeta}</div>
            )}
          </div>
        ) : m.type === 'checklist' && m.checklist ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            {!out && m.sender && firstInGroup && (
              <Text size={14} weight={600} color={m.senderColor ?? peerColor(m.sender)}>
                {m.sender}
              </Text>
            )}
            <ChecklistBubble checklist={m.checklist} out={out} />
            {showReactions ? (
              reactionsRow(simpleMeta)
            ) : (
              <div className={s.textLine} style={{ justifyContent: 'flex-end' }}>{simpleMeta}</div>
            )}
          </div>
        ) : (
          // tweb .bubble-content-wrapper: цветной бабл + reply-markup сиблингами;
          // кнопки лежат ВНЕ бабла (под ним), бабл растягивается на их ширину.
          <div className={s.bubbleWrap}>
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            {!out && m.sender && firstInGroup && (
              <Text
                onClick={m.senderId != null ? () => feedFns.openSender(m.senderId!, m.sender!) : undefined}
                size={14} weight={600} color={m.senderColor ?? peerColor(m.sender)}
                style={{ cursor: m.senderId != null ? 'pointer' : 'default' }}
              >
                {m.sender}
              </Text>
            )}
            {m.forwardFrom && (
              <div className={s.forward}>
                <Text size={13} color="var(--b-time)">{t('Forwarded from')}</Text>
                <Text size={14} weight={600} color={out ? 'var(--message-out-primary-color)' : (m.forwardFrom.color ?? 'var(--primary-color)')}>
                  {m.forwardFrom.name}
                </Text>
              </div>
            )}
            {m.reply && (
              <div
                className={s.reply}
                onClick={m.reply.seq != null ? (e) => { e.stopPropagation(); feedFns.jumpToSeq(m.reply!.seq) } : undefined}
                style={{
                  cursor: m.reply.seq != null ? 'pointer' : 'default',
                  borderLeft: `3px solid ${out ? 'var(--message-out-primary-color)' : m.reply.color ?? 'var(--primary-color)'}`,
                  background: out ? withAlpha('var(--message-out-primary-color)', 0.12) : withAlpha(m.reply.color ?? 'var(--primary-color)', 0.12),
                }}
              >
                {m.reply.mediaId != null && <ReplyThumb id={m.reply.mediaId} />}
                <div className={s.replyBody}>
                  <Text noWrap size={13.5} weight={600} color={out ? 'var(--message-out-primary-color)' : m.reply.color ?? 'var(--primary-color)'}>
                    {m.reply.name}
                    {m.reply.quote && (
                      <TgIcon name="quote_outline" size={13} style={{ verticalAlign: '-1px', marginLeft: 4, opacity: 0.75 }} />
                    )}
                  </Text>
                  <Text noWrap size={13.5} color="var(--b-secondary)" style={{ maxWidth: 240 }}>
                    <RichText text={m.reply.text} entities={m.reply.entities} linkColor="var(--b-link)" />
                  </Text>
                </div>
              </div>
            )}
            <div className={s.textLine}>
              <span className={classNames(s.msgText, hasBlock ? s.block : '')}>
                <RichText text={m.text ?? ''} entities={m.entities} linkColor="var(--b-link)" />
              </span>
              {/* без реакций — время на последней строке текста (tweb float);
                  с реакциями — оно уходит trailing-ом в строку чипов ниже */}
              {!showReactions && textMeta}
            </div>
            {m.webPage && (
              <WebPagePreview wp={m.webPage} out={out} linkColor="var(--b-link)" />
            )}
            {m.factCheck && (
              <FactCheckBox fc={m.factCheck} out={out} linkColor="var(--b-link)" />
            )}
            {reactionsRow(textMeta)}
            {footer && <div className={s.footerText}>{footer}</div>}
          </div>
          {m.replyMarkup?.inline && m.chatId != null && m.senderId != null && (
            <InlineKeyboard rows={m.replyMarkup.inline} chatId={m.chatId} botId={m.senderId} msgId={m.id} />
          )}
          </div>
        )}
    </>
  )
}

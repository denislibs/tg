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
import Time, { TimeClearfix, type TimeMode, type TimeCorner, type RenderTime } from './bubbleParts/Time'
import {
  BubbleTail,
  bubbleRadius,
  DocumentBubble,
  AudioBubble,
  RoundVideoBubble,
  WebPagePreview,
  FactCheckBox,
  CallBubble,
  RoundVideoRealBubble,
  GeoBubble,
  ContactBubble,
} from './MessageBubbles'
import RichText, { emojiOnlyCount } from '../RichText'
import StickerMedia from '../StickerMedia'
import { useAnimatedEmoji } from '../../core/hooks/useAnimatedEmoji'
import { effectForEmoji, playEmojiEffect } from '../../core/effects/emojiEffects'
import { peerColor } from '../peerColor'
import { useT } from '../../i18n'
import { useSettings } from '../../settings'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import type { FeedFns } from './MessageRow'
import s from './MessageRow.module.scss'

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
function BigEmojiBubble({ m, count, selecting, time }: {
  m: ConvMsg
  count: number
  selecting: boolean
  /** узел времени (tweb `.time.is-floating` поверх глифа) */
  time: ReactNode
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
      {time}
    </div>
  )
}

// Стикер с бэка (m.type 'sticker' + mediaId): бокс аспект-фитится в 200×200
// (tweb mediaSizes desktop static/animatedSticker), lottie-json играет через
// lottie-web c loop из настройки «Зацикливать анимации», webp/png — <img>
// (различает StickerMedia). Бейдж времени — тот же, что у big-emoji.
const STICKER_BOX = 200
function StickerRealBubble({ m, time }: { m: ConvMsg; time: ReactNode }) {
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
      {time}
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
  // margin-inline-start:auto). Время при этом переезжает в строку чипов — ровно как
  // в tweb (appendBubbleTime → reactionsElement), поэтому в сам контент оно тогда
  // не передаётся.
  const withReactionsBelow = (content: ReactNode) =>
    showReactions ? (
      <div className={s.emptyMediaCol}>
        {content}
        {reactionsRow(timeNode('plain'))}
      </div>
    ) : content

  // Время сообщения — единый tweb-компонент (см. bubbleParts/Time.tsx); режим
  // задаёт способ размещения внутри конкретного бабла.
  const timeNode = (mode: TimeMode, corner?: TimeCorner, justMedia?: boolean) => (
    <Time
      time={m.time}
      status={m.status}
      out={out}
      edited={m.edited}
      views={m.views}
      forwards={m.forwards}
      effect={m.effect}
      destructAt={m.secret ? m.destructAt : undefined}
      ttlSeconds={m.secret ? m.ttlSeconds : undefined}
      mode={mode}
      corner={corner}
      justMedia={justMedia}
    />
  )
  // Медиа-баблы сами решают форму времени (пилюля поверх фото / угол документа),
  // поэтому получают не готовый узел, а рендер (tweb: один и тот же timeSpan,
  // разные точки вставки).
  const renderTime: RenderTime = (mode, corner, justMedia) => timeNode(mode, corner, justMedia)
  // Для «bare»-типов: при наличии реакций время уезжает в их строку, поэтому в
  // сам контент оно не передаётся (tweb appendBubbleTime — одно место за раз).
  const bareTime = (mode: TimeMode, corner?: TimeCorner, justMedia?: boolean) =>
    showReactions ? undefined : timeNode(mode, corner, justMedia)

  return (
    <>
        {m.mediaId && m.type === 'roundVideo' ? (
          withReactionsBelow(
            <RoundVideoRealBubble
              m={m}
              time={showReactions ? undefined : timeNode('floating', 'default', true)}
              onPlayed={m.id != null ? () => feedFns.mediaPlayed(m.id as number) : undefined}
              onSoundPlay={m.id != null ? (el) => feedFns.roundPlaying(m.id as number, el) : undefined}
            />,
          )
        ) : m.mediaId && m.type === 'voice' ? (
          <div className={s.voiceMedia} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <VoiceMessage
              mediaId={m.mediaId}
              msgId={m.id}
              chatId={m.chatId}
              transcription={m.transcription}
              secretMedia={m.secretMedia}
              out={out}
              time={showReactions ? undefined : timeNode('corner', 'audio')}
              mediaUnread={m.mediaUnread}
              onPlay={() => feedFns.playVoice(m.mediaId as number)}
            />
            {showReactions && <div className={s.reactionsPad}>{reactionsRow(timeNode('plain'))}</div>}
          </div>
        ) : m.type === 'album' && m.albumItems ? (
          // Альбом (медиагруппа): грид из элементов, подпись — под гридом.
          <div className={classNames(s.media, s.mediaAlbum)}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div
              className={classNames(s.mediaInner, s.framed)}
              style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}
            >
              <AlbumGrid
                items={m.albumItems}
                selecting={selecting}
                selectedKey={albumSelectedKey}
                time={m.text || showReactions ? undefined : timeNode('floating')}
                onToggle={feedFns.toggleSelect}
                onOpen={feedFns.openLightbox}
                autoDownload={autoDownload}
                radius={m.text || showReactions ? '14px 14px 0 0' : '14px'}
              />
              {m.text ? (
                <div className={s.mediaCaption}>
                  <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  {!showReactions && (
                    <>
                      {timeNode('inline')}
                      <TimeClearfix />
                    </>
                  )}
                </div>
              ) : null}
              {showReactions && <div className={s.reactionsPad}>{reactionsRow(timeNode('plain'))}</div>}
            </div>
          </div>
        ) : m.type === 'sticker' && m.mediaId != null ? (
          // Стикер (tweb .bubble.is-sticker + wrappers/sticker.ts): без фона
          // бабла и хвостика; бокс аспект-фитится в 200×200 (mediaSizes
          // staticSticker/animatedSticker desktop), lottie играет с loop из
          // настроек; время+тики бейджем поверх нижнего угла, реакции — снаружи
          // reply/имя в группе не рисуются (как voice/round). Реакции — колонкой под
          // стикером, прижаты к его inline-концу (tweb is-message-empty).
          withReactionsBelow(<StickerRealBubble m={m} time={timeNode('floating', 'default', true)} />)
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
              style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}
            >
              {m.secretMedia ? (
                // Секретное медиа (E2E): fetch ciphertext → decrypt → blob-objectURL.
                // Прямой src=mediaContentUrl не годится — сервер хранит только шифртекст.
                <SecretMediaBubble
                  secretMedia={m.secretMedia}
                  out={out}
                  renderTime={m.text || showReactions ? undefined : renderTime}
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
                  renderTime={m.text || showReactions ? undefined : renderTime}
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
                  <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  {!showReactions && (
                    <>
                      {timeNode('inline')}
                      <TimeClearfix />
                    </>
                  )}
                </div>
              ) : null}
              {showReactions && <div className={s.reactionsPad}>{reactionsRow(timeNode('plain'))}</div>}
              {footer && <div className={s.footerMedia}>{footer}</div>}
            </div>
          </div>
        ) : bigEmoji ? (
          withReactionsBelow(
            <BigEmojiBubble m={m} count={bigEmoji} selecting={selecting} time={timeNode('floating', 'default', true)} />,
          )
        ) : m.type === 'document' ? (
          withReactionsBelow(<DocumentBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} time={bareTime('corner')} />)
        ) : m.type === 'audio' ? (
          withReactionsBelow(<AudioBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} time={bareTime('corner', 'audio')} />)
        ) : m.type === 'roundVideo' ? (
          withReactionsBelow(<RoundVideoBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} time={bareTime('floating', 'default', true)} />)
        ) : m.type === 'geo' && m.geo ? (
          withReactionsBelow(<GeoBubble m={m} out={out} lastInGroup={lastInGroup} radius={bubbleRadius(out, firstInGroup, lastInGroup)} time={bareTime('floating', 'default', true)} />)
        ) : m.type === 'contact' && m.contact ? (
          withReactionsBelow(
          <ContactBubble
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            time={bareTime('corner')}
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
            time={bareTime('corner')}
            onClick={selecting ? undefined : () => feedFns.recall(!!m.call?.video)}
          />,
          )
        ) : m.type === 'gift' && m.gift ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <GiftBubble gift={m.gift} out={out} />
            {showReactions ? reactionsRow(timeNode('plain')) : timeNode('corner', 'poll')}
          </div>
        ) : m.type === 'giveaway' && m.giveaway ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <GiveawayBubble giveaway={m.giveaway} />
            {showReactions ? reactionsRow(timeNode('plain')) : timeNode('corner', 'poll')}
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
            {showReactions ? reactionsRow(timeNode('plain')) : timeNode('corner', 'poll')}
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
            {showReactions ? reactionsRow(timeNode('plain')) : timeNode('corner', 'poll')}
          </div>
        ) : (
          // tweb .bubble-content-wrapper: цветной бабл + reply-markup сиблингами;
          // кнопки лежат ВНЕ бабла (под ним), бабл растягивается на их ширину.
          <div className={s.bubbleWrap}>
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            {!out && m.sender && firstInGroup && (
              <Text
                className={s.name}
                onClick={m.senderId != null ? () => feedFns.openSender(m.senderId!, m.sender!) : undefined}
                size="var(--messages-secondary-text-size)" weight={600} color={m.senderColor ?? peerColor(m.sender)}
                style={{ cursor: m.senderId != null ? 'pointer' : 'default' }}
              >
                {m.sender}
              </Text>
            )}
            {m.forwardFrom && (
              <div className={s.forward}>
                <Text size={13} color="var(--message-time-color)">{t('Forwarded from')}</Text>
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
            {/* tweb `.message`: тело сообщения — текст, превью ссылки, фактчек и
                время, которое плавает (float:right) в последней строке текста. */}
            <div className={s.message}>
              <RichText text={m.text ?? ''} entities={m.entities} linkColor="var(--b-link)" />
              {m.webPage && (
                <WebPagePreview wp={m.webPage} out={out} linkColor="var(--b-link)" />
              )}
              {m.factCheck && (
                <FactCheckBox fc={m.factCheck} out={out} linkColor="var(--b-link)" />
              )}
              {/* без реакций — время на последней строке текста (tweb float);
                  с реакциями — оно уходит trailing-ом в строку чипов ниже */}
              {!showReactions && (
                <>
                  {timeNode(m.webPage || m.factCheck ? 'nofloat' : hasBlock ? 'block' : 'inline')}
                  <TimeClearfix />
                </>
              )}
            </div>
            {reactionsRow(timeNode('plain'))}
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

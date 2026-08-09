// src/components/messages/MessageRow.tsx
// ONE message bubble, memoized. Extracted from Chat's feed so that
// appending/sending a message re-renders only the new (and the previous-last,
// whose group tail flips) row — not all ~40 bubbles. memo() bails when its props
// are unchanged; this works because `m` (ConvMsg) is given a STABLE reference by
// the parent's conversion cache, and every other prop is a primitive or a stable
// callback object (feedFns). The media viewer is opened via context (useMediaViewer).
//
// Контент бабла по типу (media/sticker/poll/text/…) вынесен в MessageContent —
// здесь остаётся мемоизированная обёртка ряда (bands/checkbox/зона) и реакции.
// Стили — MessageRow.module.scss; палитра исходящих/входящих через CSS-переменные
// на .row ([data-out]); геометрия с рантайм-флагами (радиусы, textSize) — инлайн.
import { memo, useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import Checkbox from '../../shared/ui/Checkbox'
import classNames from '../../shared/lib/classNames'
import { bubbleClasses } from './bubbleClasses'
import { BubbleTail } from './bubbleParts/primitives'
import TgIcon from '../TgIcon'
import { emojiOnlyCount } from '../RichText'
import { hexToRgbTriplet, peerColorById } from '../peerColor'
import InlineKeyboard from './InlineKeyboard'
import MessageContent from './MessageContent'
import { useSettings } from '../../settings'
import { useSetTransition } from '../../core/hooks/useSetTransition'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './MessageRow.module.scss'

// Stable handler bundle the feed/rows close over (identities never change — see
// Chat's useEvent wrappers), so passing it through doesn't bust memo.
export interface FeedFns {
  openSender: (senderId: number, fallbackName: string) => void
  playVoice: (mediaId: number) => void
  toggleSelect: (id: number) => void
  /** выделить/снять весь альбом разом — клик по баблу-контейнеру группы
   *  (tweb selection.ts:906-920 toggleByElement для .is-grouped) */
  selectAlbum: (ids: number[], select: boolean) => void
  openMsgMenu: (e: MouseEvent, m: ConvMsg) => void
  jumpToSeq: (seq?: number) => void
  /** клик по дате-разделителю — открыть пикер даты на этом дне (мс) */
  openDatePicker: (dayMs: number) => void
  openLightbox: (mediaId: number, el: HTMLElement) => void
  /** перезвонить по клику на бабл звонка (tweb: клик по messageMediaCall) */
  recall: (video: boolean) => void
  /** кружок воспроизведён со звуком → снять media_unread (tweb readMessages) */
  mediaPlayed: (msgId: number) => void
  /** кружок заиграл со звуком → его <video> становится треком глобального плеера */
  roundPlaying: (msgId: number, el: HTMLMediaElement) => void
  /** клик по чипу реакции — поставить/снять свою (tweb sendReaction) */
  toggleReaction: (msgId: number, emoji: string) => void
  /** long-press / правый клик по чипу — показать, кто отреагировал */
  showReactedUsers: (msgId: number, x: number, y: number) => void
  /** клик по чипу ⭐-реакции — открыть попап платной реакции (tweb PopupStarReaction) */
  openStarReaction: (msgId: number) => void
  /** крестик на кольце прогресса — отменить аплоад и убрать оптимистичный бабл */
  cancelUpload: (clientId: string) => void
  /** разблокировать платное медиа за звёзды (Telegram paid media) */
  unlockPaid: (msgId: number) => Promise<void>
  /** переслать сообщение — кнопка сбоку поста канала (tweb bubble-beside-button) */
  forwardMsg: (msgId: number) => void
}

export interface MessageRowProps {
  m: ConvMsg
  seq?: number           // raw window seq — the data-seq jump/scroll machinery targets
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  selecting: boolean
  isSelected: boolean
  isHighlighted: boolean
  /** показывать имя отправителя в бабле (групповой чат, входящее, первое в серии) */
  showName: boolean
  /** пост канала (tweb channel-post) */
  isChannel: boolean
  /** перед баблом проходит граница «непрочитанные» (tweb is-first-unread) */
  isFirstUnread: boolean
  feedFns: FeedFns
  // Автозагрузка медиа для этого чата (tweb chat.autoDownload); 0 = по клику.
  autoDownload?: ChatAutoDownload
  // csv id выбранных элементов альбома (стабильная строка — memo не ломается
  // у остальных рядов; только для m.type === 'album')
  albumSelectedKey?: string
  // Optional slot rendered at the bottom of the bubble (channel post replies-footer).
  footer?: ReactNode
  // Виден ли список реагировавших (tweb reactions.pFlags.can_see_list ||
  // peerId.isUser()): от этого зависит, показывать в чипе аватары или число.
  // Флага can_see_list бэк пока не отдаёт, поэтому берём приватность чата.
  canSeeReactionList: boolean
}

function MessageRow({
  m, seq, out, firstInGroup, lastInGroup,
  selecting, isSelected, isHighlighted, showName, isChannel, isFirstUnread,
  feedFns, autoDownload, albumSelectedKey, footer, canSeeReactionList,
}: MessageRowProps) {
  const textSize = useSettings((st) => st.textSize)
  // --peer-color-rgb на бабле (tweb ставит его инлайном, живой DOM §3): от него
  // питаются имя отправителя, полоса reply/цитаты и моноширинный текст в
  // портированных партиалах. Для входящих в группе — цвет отправителя по id.
  const peerRgb = !out && m.senderId != null ? hexToRgbTriplet(peerColorById(m.senderId)) : undefined
  const rowStyle = {
    '--messages-text-size': `${textSize}px`,
    ...(peerRgb ? { '--peer-color-rgb': peerRgb } : {}),
  } as CSSProperties
  // Сообщение из одних эмодзи (tweb bigEmojis) — та же чистая функция, что и в
  // MessageContent; здесь нужна для модификаторов бабла.
  const bigEmojiCount = m.type === 'text' && m.text ? emojiOnlyCount(m.text) : 0
  // sticker-animated: лотти-стикер отдаётся с mime application/json (StickerMedia
  // различает его по Content-Type); у big-emoji анимация решается асинхронно —
  // класс ставим только по достоверно известному признаку.
  const animatedSticker = m.type === 'sticker' && m.mediaMime === 'application/json'

  // Реакции — единый Block-ряд под контентом бабла у ВСЕХ типов (tweb: reactions
  // всегда крепятся внутрь структуры бабла, не выносятся наружу). Само размещение
  // и «вливание» времени в строку — в MessageContent. rowLive: реакции появились
  // у УЖЕ смонтированного ряда → анимируем вход.
  const rowLiveRef = useRef(false)
  useEffect(() => { rowLiveRef.current = true }, [])
  const showReactions =
    ((m.reactions?.length ?? 0) > 0 || (!!m.starReaction && m.starReaction.total > 0)) &&
    m.id != null && !selecting

  // Что можно выделять — tweb ChatSelection.canSelectBubble (selection.ts:999-1006):
  // сервисные (у нас рендерятся не через MessageRow), неотправленные (is-outgoing)
  // и ошибочные баблы чекбокса не получают.
  const canSelect = selecting && m.id != null && m.status !== 'sending' && m.status !== 'error'

  // Альбом — «групповой» бабл (tweb is-grouped): его чекбокс отмечен, только
  // когда выделены ВСЕ элементы (selection.ts:972-976 isGroupedMidsSelected),
  // а клик по нему выделяет/снимает группу целиком (selection.ts:906-920).
  const albumIds = m.type === 'album'
    ? (m.albumItems ?? []).map((x) => x.id).filter((id): id is number => id != null)
    : []
  const albumPicked = new Set((albumSelectedKey ?? '').split(',').filter(Boolean).map(Number))
  const rowSelected = m.type === 'album'
    ? albumIds.length > 0 && albumIds.every((id) => albumPicked.has(id))
    : isSelected

  // Модификаторы бабла — единой функцией на классах tweb (см. bubbleClasses.ts).
  // Подсветка перехода и полоса выделения теперь рисуются CSS'ом самого бабла
  // (_chatBubble.scss `.is-highlighted:after` / `.is-selected:after`), поэтому
  // отдельных band-слоёв на framer-motion больше нет.
  const cls = bubbleClasses(m, {
    out,
    firstInGroup,
    lastInGroup,
    showName,
    isChannel,
    isHighlighted,
    isFirstUnread,
    bigEmojiCount,
    animatedSticker,
  })

  // Выделение — через SetTransition, как в tweb (selection.ts:497-502:
  // `SetTransition({element, className: 'is-selected', forwards: isSelected,
  // duration: 200})`). Класс не просто снимается: на выходе к нему добавляется
  // `backwards`, под который в партиале написана обратная анимация
  // (_chatBubble.scss:268-282: вход — `fade-in-opacity .2s`, выход —
  // `.backwards:after { fade-in-backwards-opacity .2s }`). Без этого снятие
  // выделения происходило в один кадр, без затухания полосы.
  const selectedCls = useSetTransition(canSelect && rowSelected, 'is-selected', 200)

  return (
    <div
      className={classNames(...cls, selectedCls, s.row)}
      data-mid={m.id}
      // tweb держит на бабле id отправителя (живой DOM §3) — по нему адресуются
      // меню/аватары и наш DOM-diff.
      data-peer-id={m.senderId}
      data-seq={seq}
      onContextMenu={selecting ? undefined : (e: MouseEvent) => feedFns.openMsgMenu(e, m)}
      // Обычный клик по error-баблу открывает то же меню (Переотправить/Удалить).
      onClick={
        canSelect
          ? m.type === 'album'
            ? () => feedFns.selectAlbum(albumIds, !rowSelected)
            : () => feedFns.toggleSelect(m.id!)
          : m.status === 'error'
            ? (e: MouseEvent) => feedFns.openMsgMenu(e, m)
            : undefined
      }
      style={rowStyle}
    >
      {/* Чекбокс выделения — САМ label первым ребёнком .bubble (tweb
          selection.ts:342-344 `element.prepend(checkboxField.label)` +
          :823-831 `label.classList.add('bubble-select-checkbox')`).
          Размер/позиция целиком из партиала (_chatBubble.scss:306-334). */}
      {canSelect && <Checkbox className="bubble-select-checkbox" checked={rowSelected} />}

      {/* Каркас tweb — одинаковый у ВСЕХ типов (живой DOM §3): контент бабла
          всегда лежит в .bubble-content-wrapper > .bubble-content. */}
      <div className="bubble-content-wrapper">
        <div className="bubble-content">
          <MessageContent
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            selecting={selecting}
            autoDownload={autoDownload}
            albumSelectedKey={albumSelectedKey}
            footer={footer}
            showReactions={showReactions}
            canSeeReactionList={canSeeReactionList}
            rowLive={rowLiveRef.current}
            feedFns={feedFns}
          />
          {/* Кнопка «переслать» сбоку поста канала (tweb bubbles.ts:7673-7681,
              живой DOM §3): круглая, за пределами бабла, проявляется по ховеру. */}
          {isChannel && m.id != null && !selecting && (
            <div
              className="bubble-beside-button with-hover forward"
              onClick={(e) => { e.stopPropagation(); feedFns.forwardMsg(m.id as number) }}
            >
              <TgIcon name="forward" size="1.5rem" />
            </div>
          )}
          {/* Хвостик — ПОСЛЕДНИЙ ребёнок .bubble-content (tweb
              bubbleContainer.append(generateTail()), живой DOM §3). */}
          {cls.includes('can-have-tail') && <BubbleTail />}
        </div>
        {/* Инлайн-клавиатура бота — СИБЛИНГ бабла внутри обёртки (tweb
            .reply-markup рядом с .bubble-content): кнопки лежат под баблом, а не
            внутри цветной подложки. */}
        {m.replyMarkup?.inline && m.chatId != null && m.senderId != null && (
          <InlineKeyboard rows={m.replyMarkup.inline} chatId={m.chatId} botId={m.senderId} msgId={m.id} />
        )}
      </div>
    </div>
  )
}

export default memo(MessageRow)

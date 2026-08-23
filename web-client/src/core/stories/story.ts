// Истории в форме оригинала — конструкторы схемы TL, и операции над ними.
//
// Разбор и решения Р1–Р12 — docs/readiness/tl-stories-analysis.md. До этого
// шага клиент держал свою плоскую запись (`mapStory`), в которой:
//
//  • медиа было НОМЕРОМ (`mediaId`), поэтому вьювер спрашивал mime, размеры и
//    длительность ОТДЕЛЬНЫМ запросом на каждую историю;
//  • вид аудитории и вид области были строками (`privacy`, `mediaArea.type`);
//  • прочитанность была признаком на КАЖДОЙ истории, а не горизонтом группы;
//  • реакции лежали тремя ключами верхнего уровня, из которых один
//    (`myReaction`) пер-зрительский, а два общие.
//
// Здесь ничего этого нет: форма провода и форма модели совпали, поэтому маппера
// у историй больше нет вовсе — есть операции над конструктором, как у черновика
// (`core/dialogs/draft.ts`) и у реакций сообщения
// (`core/reactions/messageReactions.ts`).
import type { MessageEntity, Reaction, ReactionCount } from '../models'
import type { GeoPoint, MessageMedia } from '../media/messageMedia'
import { getMediaFromMessage } from '../media/messageMedia'
import { getPeerId, type Peer } from '../peers/peerId'
import { isChosen } from '../reactions/messageReactions'

// ── Конструкторы ────────────────────────────────────────────────────────────

/** mediaAreaCoordinates#cfc9e002 — положение области в процентах бокса медиа. */
export interface MediaAreaCoordinates {
  _: 'mediaAreaCoordinates'
  x: number
  y: number
  w: number
  h: number
  rotation: number
}

/** mediaAreaGeoPoint#cad5452d — точка на карте поверх истории. */
export interface MediaAreaGeoPoint {
  _: 'mediaAreaGeoPoint'
  coordinates: MediaAreaCoordinates
  geo: GeoPoint
}

/** mediaAreaVenue#be82db9c — место с названием. */
export interface MediaAreaVenue {
  _: 'mediaAreaVenue'
  coordinates: MediaAreaCoordinates
  geo: GeoPoint
  title: string
  address: string
}

/** mediaAreaSuggestedReaction#14455871 — наклейка «отреагируй этим». */
export interface MediaAreaSuggestedReaction {
  _: 'mediaAreaSuggestedReaction'
  pFlags?: Partial<{ dark: true; flipped: true }>
  coordinates: MediaAreaCoordinates
  reaction: Reaction
}

/** mediaAreaUrl#37381085 — кликабельная ссылка поверх истории. */
export interface MediaAreaUrl {
  _: 'mediaAreaUrl'
  coordinates: MediaAreaCoordinates
  url: string
}

/** Интерактивная область поверх истории — ОБЪЕДИНЕНИЕ, а не одна структура с
 *  полем `type` и восемью необязательными половинами. */
export type MediaArea = MediaAreaGeoPoint | MediaAreaVenue | MediaAreaSuggestedReaction | MediaAreaUrl

/** storyFwdHeader#b826e150 — атрибуция репоста: автор ССЫЛКОЙ. */
export interface StoryFwdHeader {
  _: 'storyFwdHeader'
  from?: Peer
  story_id?: number
}

/** storyViews#8d595cd6 — ОБЩИЙ (не пер-зрительский) агрегат истории. */
export interface StoryViews {
  _: 'storyViews'
  views_count: number
  reactions?: ReactionCount[]
  reactions_count?: number
}

/** Правило аудитории (`PrivacyRule`); производим четыре конструктора. */
export type StoryPrivacyRule =
  | { _: 'privacyValueAllowAll' }
  | { _: 'privacyValueAllowContacts' }
  | { _: 'privacyValueAllowCloseFriends' }
  | { _: 'privacyValueAllowUsers'; users: number[] }

/** storyItem#16a4b93c — история. */
export interface StoryItemReal {
  _: 'storyItem'
  pFlags?: Partial<{
    pinned: true
    public: true
    close_friends: true
    contacts: true
    selected_contacts: true
    edited: true
  }>
  /** Номер ВНУТРИ автора: им история и адресуется, и по нему считается
   *  горизонт прочтения. Глобального ключа наружу не выходит. */
  id: number
  date: number
  fwd_from?: StoryFwdHeader
  expire_date: number
  caption?: string
  entities?: MessageEntity[]
  /** Ступень вложения — та же, что у сообщения. Номера файла рядом больше нет. */
  media: MessageMedia
  media_areas?: MediaArea[]
  /** Аудитория; едет ТОЛЬКО автору истории. */
  privacy?: StoryPrivacyRule[]
  views?: StoryViews
  /** Реакция ЗРИТЕЛЯ — единственная пер-зрительская часть агрегата. */
  sent_reaction?: Reaction
}

/** storyItemDeleted#51e6ee4f — «историю удалили». */
export interface StoryItemDeleted {
  _: 'storyItemDeleted'
  id: number
}

export type StoryItem = StoryItemReal | StoryItemDeleted

/** Приватность истории в терминах интерфейса. Значение ВЫВОДИТСЯ из флагов
 *  конструктора: строки `privacy` на проводе больше нет. */
export type StoryPrivacy = 'everyone' | 'contacts' | 'close' | 'selected'

// ── Операции ────────────────────────────────────────────────────────────────

/** История, а не «её удалили»: ветвление по конструктору вместо `if (story)`. */
export function realStory(s: StoryItem | undefined): StoryItemReal | undefined {
  return s?._ === 'storyItem' ? s : undefined
}

/** Подпись; «подписи нет» — отсутствие параметра, а не пустая строка. */
export function storyCaption(s: StoryItem | undefined): string {
  return realStory(s)?.caption ?? ''
}

/** Секунды эпохи — те же единицы, что у сообщения. */
export function storyDate(s: StoryItem | undefined): number {
  return realStory(s)?.date ?? 0
}

export function storyExpireDate(s: StoryItem | undefined): number {
  return realStory(s)?.expire_date ?? 0
}

/**
 * Прочитана ли история — СРАВНЕНИЕ с горизонтом, а не признак на самой истории.
 *
 * У оригинала прочитанность историй выражена одним номером на автора
 * (`peerStories.max_read_id`), ровно как непрочитанность сообщения выводится из
 * `read_inbox_max_id`. Признак на каждой истории был временной формой и ушёл
 * вместе с пер-авторской нумерацией (миграция 0126).
 */
export function isStoryRead(s: StoryItem | undefined, maxReadId: number): boolean {
  const story = realStory(s)
  return story != null && story.id <= maxReadId
}

export function isStoryPinned(s: StoryItem | undefined): boolean {
  return realStory(s)?.pFlags?.pinned === true
}

export function isStoryEdited(s: StoryItem | undefined): boolean {
  return realStory(s)?.pFlags?.edited === true
}

/**
 * Вид аудитории — по флагам конструктора.
 *
 * `contacts` последним не случайно: это ДЕФОЛТ публикации, и он же ответ, когда
 * ни один флаг не выставлен (истории прошлой схемы, кадр без флагов).
 */
export function storyPrivacy(s: StoryItem | undefined): StoryPrivacy {
  const f = realStory(s)?.pFlags
  if (f?.public) return 'everyone'
  if (f?.close_friends) return 'close'
  if (f?.selected_contacts) return 'selected'
  return 'contacts'
}

/** Явный allow-лист selected-истории. Приезжает ТОЛЬКО автору — у чужой истории
 *  вектора `privacy` нет вовсе, и ответ пуст. */
export function storyAllowIds(s: StoryItem | undefined): number[] {
  const rule = realStory(s)?.privacy?.find((r) => r._ === 'privacyValueAllowUsers')
  return rule?._ === 'privacyValueAllowUsers' ? rule.users : []
}

/** Моя реакция — эмодзи или `null`. Живёт ОТДЕЛЬНЫМ параметром истории, а не
 *  внутри агрегата: тело истории одно на всех получателей. */
export function storyMyReaction(s: StoryItem | undefined): string | null {
  const r = realStory(s)?.sent_reaction
  return r?._ === 'reactionEmoji' ? r.emoticon : null
}

/** Разбивка реакций — чипы `reactionCount` общего агрегата. */
export function storyReactions(s: StoryItem | undefined): ReactionCount[] {
  return realStory(s)?.views?.reactions ?? []
}

/** Сколько реакций всего. */
export function storyReactionsCount(s: StoryItem | undefined): number {
  return realStory(s)?.views?.reactions_count ?? 0
}

/** Интерактивные области поверх истории. */
export function storyMediaAreas(s: StoryItem | undefined): MediaArea[] {
  return realStory(s)?.media_areas ?? []
}

/** Ключ автора исходной истории у репоста; `undefined` у оригинала. */
export function storyFwdAuthorId(s: StoryItem | undefined): PeerId | undefined {
  const from = realStory(s)?.fwd_from?.from
  return from ? getPeerId(from) : undefined
}

export function storyFwdStoryId(s: StoryItem | undefined): number | undefined {
  return realStory(s)?.fwd_from?.story_id
}

/**
 * Номер файла истории — ИЗ СТУПЕНИ (`photo.id` / `document.id`), а не из
 * отдельного ключа рядом. Тот же доступ, что у вложения сообщения: `storyItem`
 * подходит `getMediaFromMessage` структурно, потому что несёт `media` тем же
 * параметром.
 */
export function storyMediaId(s: StoryItem | undefined): number {
  return getMediaFromMessage(realStory(s))?.id ?? 0
}

/** Свой ли чип реакции (`chosen_order`, а не булево «моя»). */
export { isChosen }

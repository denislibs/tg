// Порт tweb `src/lib/appManagers/appEmojiManager.ts` (812502980, 453 строки) — недавние эмодзи,
// тон кожи, поиск эмодзи по ключевым словам и свои эмодзи для эмодзи-дропдауна
// (`components/emoticonsDropdown/tabs/emoji.ts`) и автокомплита эмодзи.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Живёт на главном потоке, а не воркерным менеджером: всё его состояние — ключи `State`
//     (`recentEmoji`, `recentCustomEmoji`, `emojiVariants`), а их у нас пишет и читает
//     `stores/appState` (write-through в воркер, зеркало в соседние вкладки). Событие
//     `emoji_recent`/`emoji_variant` идёт `rootScope.dispatchEvent` — вкладке и соседям.
//  2. Ключевые слова — локальный пакет `config/emojiKeywords.ts`, а не
//     `messages.getEmojiKeywordsDifference` по языкам (`getEmojiKeywords`/`getBothEmojiKeywords`):
//     ручки у бэкенда нет (Б-131).
//  3. Свои эмодзи: наборы — установленные с `pFlags.emojis` (`stickers.mySets`), документы —
//     `stickers.getStickerSet({id})`; индекс поиска своих эмодзи по их эмодзи
//     (`appStickersManager.getEmojisSearchIndex`/`preloadEmojiSets`) строится здесь же.
//     Документа своего эмодзи по id (`messages.getCustomEmojiDocuments`,
//     `getCustomEmojiDocument`) нет — рендерер берёт файл прямо по id (`lib/customEmoji`),
//     id документа у нас и есть id медиа.
//  4. Группы эмодзи (`getEmojiGroups`, `messages.getEmojiGroups`) и `searchCustomEmoji`
//     (`messages.searchCustomEmoji`) — без ручек у бэкенда: группы поиска не показываются (Б-131).
import { startClient } from '@/client/bootstrap'
import type { StickerSet } from '@core/managers/stickersManager'
import type { MyDocument } from '@core/media/messageMedia'
import { setAppState, useAppStateStore } from '@stores/appState'
import getLocalEmojiKeywords from '@config/emojiKeywords'
import SearchIndex from '@lib/searchIndex'
import rootScope from '@lib/rootScope'
import fixEmoji from '@lib/richtext/fixEmoji'
import filterUnique from '@helpers/array/filterUnique'
import flatten from '@helpers/array/flatten'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import { type EmojiSkinTone, getEmojiSkinToneBase, getEmojiSkinToneVariants } from '@helpers/emojiSkinTone'

const RECENT_MAX_LENGTH = 32

type EmojiType = 'native' | 'custom'

export class AppEmojiManager {
  private static POPULAR_EMOJI = ['😂', '😘', '❤️', '😍', '😊', '😁', '👍', '☺️', '😔', '😄', '😭', '💋', '😒', '😳', '😜', '🙈', '😉', '😃', '😢', '😝', '😱', '😡', '😏', '😞', '😅', '😚', '🙊', '😌', '😀', '😋', '😆', '👌', '😐', '😕']

  private index?: SearchIndex<string[]>
  private recent: { native?: string[], custom?: DocId[] } = {}
  private emojiVariants?: { [emoji: string]: EmojiSkinTone }

  private emojiSetsPromise?: Promise<{ set: StickerSet, documents: MyDocument[] }[]>
  private customEmojiIndex?: SearchIndex<DocId>
  private customEmojiDocuments: Map<string, MyDocument> = new Map()

  private get managers() {
    return startClient().managers
  }

  private indexEmojis() {
    if(!this.index) {
      this.index = new SearchIndex({ minChars: 2, fullWords: true })
      const keywords = getLocalEmojiKeywords()
      for(const keyword in keywords) {
        this.index.indexObject(keywords[keyword], keyword)
      }
    }
  }

  private searchEmojis({ q, limit = 40, minChars = 2, addCustom }: {
    q: string
    limit?: number
    minChars?: number
    addCustom?: boolean
  }) {
    this.indexEmojis()

    q = q.toLowerCase().replace(/_/g, ' ')

    let emojis: string[]
    if(q.trim()) {
      const set = this.index!.search(q, minChars)
      emojis = filterUnique(flatten(Array.from(set)))
      emojis.length = Math.min(40, emojis.length)
    } else {
      emojis = this.recent.native!.concat(AppEmojiManager.POPULAR_EMOJI).slice(0, RECENT_MAX_LENGTH)
      emojis = filterUnique(emojis)
    }

    const appEmojis: AppEmoji[] = []
    const foundCustomEmoji: Set<DocId> = new Set()
    const customEmojiIndex = addCustom && this.customEmojiIndex
    emojis.forEach((emoji) => {
      if(customEmojiIndex) {
        const customEmojisResult = customEmojiIndex.search(emoji, minChars)
        const customEmojis = Array.from(customEmojisResult)
        .filter((docId) => !foundCustomEmoji.has(docId))
        .map((docId) => {
          foundCustomEmoji.add(docId)
          return { docId, emoji }
        })
        appEmojis.push(...customEmojis)
      }

      appEmojis.push({ emoji })
    })

    appEmojis.length = Math.min(limit, appEmojis.length)
    return appEmojis
  }

  public async prepareAndSearchEmojis(options: Parameters<AppEmojiManager['searchEmojis']>[0]) {
    await Promise.all([
      this.getRecentEmojis('native'),
      this.preloadEmojiSets(),
    ])

    return this.searchEmojis(options)
  }

  public getEmojiVariants() {
    return Promise.resolve(this.emojiVariants ??= { ...useAppStateStore.getState().emojiVariants })
  }

  public async saveEmojiVariant(emoji: string, tone: EmojiSkinTone) {
    const toneVariants = getEmojiSkinToneVariants(emoji)
    if(!toneVariants || !Number.isInteger(tone) || tone < 0 || tone > 5) {
      return
    }

    const { baseEmoji, variants } = toneVariants
    const emojiVariants = await this.getEmojiVariants()
    emojiVariants[baseEmoji] = tone
    setAppState('emojiVariants', { ...emojiVariants })
    rootScope.dispatchEvent('emoji_variant', {
      baseEmoji,
      emoji: variants[tone],
      tone,
    })
  }

  public getRecentEmojis(type: 'custom'): Promise<DocId[]>
  public getRecentEmojis(type: 'native'): Promise<string[]>
  public getRecentEmojis(type: EmojiType): Promise<string[] | DocId[]> {
    let recent = this.recent[type]
    if(!recent) {
      const state = useAppStateStore.getState()
      if(type === 'native') {
        const { recentEmoji } = state
        const native: string[] = Array.isArray(recentEmoji) && recentEmoji.length ? recentEmoji : AppEmojiManager.POPULAR_EMOJI
        const normalized = filterUnique(native.map((emoji) => getEmojiSkinToneBase(emoji)))
        if(normalized.length !== native.length || normalized.some((emoji, index) => emoji !== native[index])) {
          setAppState('recentEmoji', normalized)
        }

        recent = this.recent.native = normalized
      } else {
        const { recentCustomEmoji } = state
        recent = this.recent.custom = Array.isArray(recentCustomEmoji) && recentCustomEmoji.length ? [...recentCustomEmoji] : []
      }
    }

    return Promise.resolve(recent)
  }

  public modifyRecentEmoji(emoji: AppEmoji, add: boolean) {
    const type: EmojiType = emoji.docId ? 'custom' : 'native'
    emoji.emoji = fixEmoji(emoji.emoji)
    if(type === 'native') {
      emoji.emoji = getEmojiSkinToneBase(emoji.emoji)
    }

    void (type === 'custom' ? this.getRecentEmojis('custom') : this.getRecentEmojis('native')).then((recent: (string | DocId)[]) => {
      const i = emoji.docId || emoji.emoji
      indexOfAndSplice(recent, i)
      if(add) recent.unshift(i)
      recent.splice(RECENT_MAX_LENGTH, recent.length - RECENT_MAX_LENGTH)

      if(type === 'custom') setAppState('recentCustomEmoji', [...recent] as DocId[])
      else setAppState('recentEmoji', [...recent] as string[])
      rootScope.dispatchEvent('emoji_recent', { emoji, deleted: !add })
    })
  }

  public pushRecentEmoji(emoji: AppEmoji) {
    return this.modifyRecentEmoji(emoji, true)
  }

  public deleteRecentEmoji(emoji: AppEmoji) {
    return this.modifyRecentEmoji(emoji, false)
  }

  /** tweb `getCustomEmojis` → `appStickersManager.getEmojiStickers()`: установленные наборы эмодзи */
  public async getCustomEmojis(): Promise<{ sets: StickerSet[] }> {
    const sets = await this.managers.stickers.mySets()
    return { sets: sets.filter((set) => set.pFlags?.emojis) }
  }

  /** tweb `appStickersManager.preloadEmojiSets` + `getEmojisSearchIndex` (расхождение 3) */
  public preloadEmojiSets() {
    return this.emojiSetsPromise ??= this.getCustomEmojis().then(({ sets }) => {
      return Promise.all(sets.map((set) => {
        return this.managers.stickers.getStickerSet({ id: set.id }).then(({ stickers }) => ({ set, documents: stickers }), () => ({ set, documents: [] as MyDocument[] }))
      }))
    }).then((sets) => {
      const index = this.customEmojiIndex = new SearchIndex<DocId>({ minChars: 2, fullWords: true })
      sets.forEach(({ documents }) => {
        documents.forEach((doc) => {
          this.customEmojiDocuments.set('' + doc.id, doc)
          if(doc.stickerEmojiRaw) index.indexObjectArray(doc.id, [fixEmoji(doc.stickerEmojiRaw)])
        })
      })

      return sets
    }, () => {
      this.emojiSetsPromise = undefined
      return []
    })
  }

  /**
   * tweb `getCustomEmojiDocument` (`:398-416`) — документ своего эмодзи: из установленных наборов,
   * иначе — у реестра документов воркера (`docs.getDoc`); ручки по id у бэкенда нет (расхождение 3).
   */
  public async getCustomEmojiDocument(docId: DocId): Promise<MyDocument | undefined> {
    const cached = this.customEmojiDocuments.get('' + docId)
    if(cached) return cached
    await this.preloadEmojiSets()
    return this.customEmojiDocuments.get('' + docId) ?? await this.managers.docs.getDoc(Number(docId)).catch(() => undefined)
  }
}

const appEmojiManager = new AppEmojiManager()
export default appEmojiManager

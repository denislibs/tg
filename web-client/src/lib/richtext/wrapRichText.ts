// Ванильный рендер текста сообщения — порт tweb `lib/richTextProcessor/wrapRichText.ts`.
//
// СХЕМА (то, ради чего порт): ОДИН проход по отсортированному списку сущностей с
// курсором `nasty {i, usedLength, text}` (tweb :122-213), вложенность — РЕКУРСИЯ
// самого себя (`voodoo: true`, tweb :932-941), дыры между сущностями доливаются
// текстовыми узлами, в конце `fragment.normalize()` (tweb :998). React-версия
// (`components/RichText.tsx`) вместо этого режет текст по всем границам сущностей
// и вешает `<span>` на каждый сегмент — из-за чего сущность, пересекающая границу
// другой, дробится на несколько одинаковых элементов (две `<a class="anchor-url">`
// вместо одной с вложенным `<strong>`).
//
// ЧТО НЕ ПОРТИРОВАНО (и почему):
//   • `wrappingDraft` целиком (черновик поля ввода: markup-шрифты, каретка, BOM-филлеры,
//     `insertCustomFillers`) — поле ввода живёт своей веткой (`core/richtext/markdown.ts`);
//   • `messageEntityFormattedDate` (solid-js), `messageEntityDiff*`, `messageEntityTimestamp`,
//     `messageEntityBotCommand`, `messageEntityAnchor`, `sub`/`sup`, `messageEntityHighlight`,
//     `messageEntityPhone`, `messageEntityCaret` — таких сущностей у нас нет;
//   • bluff-спойлер (tweb :685-694) — он строится `createElementFromMarkup`, т.е. `innerHTML`;
//   • общий рендерер кастом-эмодзи (`CustomEmojiRendererElement`) — портов
//     `lib/customEmoji/{element,renderer}` у нас нет, здесь только узел-плейсхолдер;
//   • `pFlags.collapsed` у цитаты и `w`/`h` у кастом-эмодзи — этих полей нет в нашей модели;
//   • electron-ветка (`javascript:electronHelpers…`), `window.wrapRichText`, `encodeEntities`.
//
// БЕЗОПАСНОСТЬ (жёсткое правило `web-client/CLAUDE.md`): DOM строится только
// `createElement`/`textContent`; ссылки — исключительно через allow-list схем
// (`@core/safeUrl`, см. `url.ts`), отклонённая ссылка рисуется `<span>`;
// подсветка кода — токенами, а не `innerHTML` (см. `highlightCode.ts`);
// вместо inline `onclick` — `data-anchor-action` + делегирование на стороне ленты.
import IS_EMOJI_SUPPORTED from '@environment/emojiSupport'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import { revealSpoiler } from '@lib/spoiler/spoilerReveal'
import { safeUrl } from '@core/safeUrl'
import parseEntities, { SITE_HASHTAGS } from './parseEntities'
import type { WrapEntity, WrapEntityType } from './entities'
import { EMOJI_CDN_BASE, isSafeEmojiUnicode } from './emoji'
import { getCodeLanguage, highlightCodeInto } from './highlightCode'
import Icon from '@components/icon'
import {
  ANCHOR_ACTION_ATTRIBUTE,
  safeWrapUrl,
  setBlankToAnchor,
  wrapTelegramUrlToAnchor,
} from './url'

export type WrapRichTextOptions = Partial<{
  entities: WrapEntity[]
  contextSite: string
  noLinks: boolean
  noTextFormat: boolean
  passEntities: Partial<Record<WrapEntityType, boolean>>
  /** актуальность для асинхронной подсветки кода (`@helpers/middleware`) */
  middleware: () => boolean
  /** сюда складываются промисы отложенной работы (подсветка кода) — как в tweb */
  loadPromises: Promise<unknown>[]

  // ! recursive, do not provide
  nasty: {
    i: number
    usedLength: number
    text: string
    lastEntity?: WrapEntity
  }
  voodoo: boolean
  ignoreNextIndex: number
}>

/**
 * Страховочный кап на число сущностей. В однопроходной схеме квадратичной
 * сегментации (та, из-за которой кап появился в `components/RichText.tsx:227`)
 * больше нет, но кап оставлен намеренно: каждая сущность — это ещё один DOM-узел
 * и ещё один кадр рекурсии, а число сущностей приходит снаружи. Правило
 * репозитория «лимит числа entities не убирать» (`web-client/CLAUDE.md`).
 */
export const MAX_ENTITIES = 500

// tweb `lang.ts:523` — 'CopyCode': 'copy'. i18n сюда не тащим (модуль ванильный и
// без зависимости от React-стора языка); строка вернётся в словарь вместе с лентой.
const CODE_HEADER_FALLBACK_LABEL = 'copy'

// tweb вешает `container[`on${CLICK_EVENT_NAME}`] = window.onSpoilerClick` (:710).
// У нас глобалей нет — тот же обработчик, что и в React-версии.
const onSpoilerClick = (e: Event) => {
  if (revealSpoiler(e.currentTarget as HTMLElement)) {
    e.stopPropagation()
    e.preventDefault()
  }
}

/** tweb `helpers/array/findIndexFrom.ts` */
function findIndexFrom<T>(arr: T[], predicate: (item: T) => boolean, i: number): number {
  for (const length = arr.length; i < length; ++i) {
    if (predicate(arr[i])) {
      return i
    }
  }
  return -1
}

/**
 * * Expecting correctly sorted nested entities (sortEntities)
 */
export default function wrapRichText(text: string, options: WrapRichTextOptions = {}): DocumentFragment {
  const fragment = document.createDocumentFragment()
  if (!text) {
    return fragment
  }

  const isTopLevel = !options.nasty
  const nasty = options.nasty ??= {
    i: 0,
    usedLength: 0,
    text,
  }

  let entities = options.entities ??= parseEntities(nasty.text)
  if (isTopLevel && entities.length > MAX_ENTITIES) {
    entities = options.entities = entities.slice(0, MAX_ENTITIES)
  }

  const passEntities = options.passEntities ??= {}
  const contextSite = options.contextSite ??= 'Telegram'
  const contextExternal = contextSite !== 'Telegram'

  const textLength = nasty.text.length
  const length = entities.length
  let lastElement: HTMLElement | DocumentFragment | undefined
  for (; nasty.i < length; ++nasty.i) {
    let entity = entities[nasty.i]

    // * check whether text was sliced
    if (entity.offset >= textLength) {
      continue
    } else if ((entity.offset + entity.length) > textLength) {
      entity = { ...entity }
      entity.length = textLength - entity.offset
    }

    if (entity.length) {
      nasty.lastEntity = entity
    }

    let nextEntity: WrapEntity | undefined = entities[nasty.i + 1]

    const startOffset = entity.offset
    const endOffset = startOffset + entity.length
    // 0xFFFF — как в tweb (:195): «конца текста нет», верхняя граница курсора.
    const endPartOffset = Math.min(endOffset, nextEntity?.offset ?? 0xFFFF)
    const fullEntityText = nasty.text.slice(startOffset, endOffset)
    const partText = nasty.text.slice(startOffset, endPartOffset)

    if (nasty.usedLength < startOffset) {
      (lastElement || fragment).append(nasty.text.slice(nasty.usedLength, startOffset))
    }

    if (lastElement) {
      lastElement = fragment
    }

    nasty.usedLength = endPartOffset

    let element: HTMLElement | undefined,
      property: 'alt' | undefined,
      usedText = false,
      processingBlockElement = false
    switch (entity.type) {
      case 'bold': {
        if (!options.noTextFormat) {
          element = document.createElement('strong')
        }

        break
      }

      case 'italic': {
        if (!options.noTextFormat) {
          element = document.createElement('em')
        }

        break
      }

      case 'strikethrough': {
        // 1:1 tweb (:239-251): `del` ставится и при noTextFormat
        element = document.createElement('del')

        break
      }

      case 'underline': {
        if (!options.noTextFormat) {
          element = document.createElement('u')
        }

        break
      }

      case 'pre':
      case 'code': {
        if (entity.type === 'pre' && !options.noTextFormat) {
          const container = document.createElement('pre')
          const content = document.createElement('div')
          content.classList.add('code-content')
          const code = document.createElement('code')
          code.classList.add('code-code')
          element = code
          fragment.append(container)
          content.append(code)

          container.classList.add('quote-like', 'quote-like-border', 'code')

          const language = getCodeLanguage(entity.language)

          const header = document.createElement('div')
          header.classList.add('code-header')
          const headerName = document.createElement('span')
          headerName.classList.add('code-header-name')
          headerName.append(language?.label ?? CODE_HEADER_FALLBACK_LABEL)
          header.append(
            headerName,
            Icon('menu', 'code-header-button', 'code-header-toggle-wrap'),
            Icon('copy', 'code-header-button', 'code-header-copy'),
          )

          container.append(header, content)

          usedText = true
          // Текст кладём всегда; подсветка (если она вообще будет) заменит содержимое,
          // когда доедет ленивый чанк prism. tweb делает так же (:309-311).
          code.textContent = fullEntityText
          if (entity.language) {
            const promise = highlightCodeInto(code, fullEntityText, entity.language, options.middleware)
            if (promise) {
              options.loadPromises?.push(promise)
            }
          }

          let lastInnerEntityIndex = findIndexFrom(entities, (n) => n.offset >= endOffset, nasty.i + 1)
          if (lastInnerEntityIndex === -1) lastInnerEntityIndex = entities.length - 1
          else lastInnerEntityIndex -= 1
          nasty.i = lastInnerEntityIndex
          nasty.usedLength = endOffset
          nasty.lastEntity = entities[lastInnerEntityIndex]
          nextEntity = undefined
          processingBlockElement = true
        } else if (!options.noTextFormat) {
          element = document.createElement('code')
          element.classList.add('monospace-text')
        }

        break
      }

      case 'custom_emoji': {
        while (nextEntity?.type === 'emoji' && nextEntity.offset < endOffset) {
          ++nasty.i
          nasty.lastEntity = nextEntity
          nasty.usedLength += nextEntity.length
          nextEntity = entities[nasty.i + 1]
        }

        // Плейсхолдер: тег/класс/датасет — как у tweb `CustomEmojiElement`
        // (`lib/customEmoji/element.ts:11-42`), но БЕЗ самого рендера — портов
        // `lib/customEmoji/{element,renderer}` у нас нет (наш `lib/customEmoji/*` —
        // это композитор стикеров, другая подсистема). Кто оживит плейсхолдер —
        // задача этапа медиа.
        //
        // Расхождение с tweb: там текст глифа никуда не попадает (`property = 'alt'`
        // при пустом partText — символы уже «съедены» циклом выше), потому что поверх
        // узла рисует общий рендерер. Пока рендерера нет, кладём глиф текстом внутрь
        // узла — иначе эмодзи просто пропадает из сообщения.
        const customEmoji = document.createElement('custom-emoji-element')
        customEmoji.classList.add('custom-emoji')
        if (entity.document_id !== undefined) {
          customEmoji.dataset.docId = '' + entity.document_id
        }
        customEmoji.dataset.stickerEmoji = fullEntityText
        customEmoji.textContent = fullEntityText
        usedText = true
        element = customEmoji

        break
      }

      case 'emoji': {
        // tweb (:466-477) ещё сверяет версию эмодзи по таблицам `EmojiVersions` /
        // `EMOJI_VERSIONS_SUPPORTED` (~100 КБ данных) — их не портируем, остаётся
        // сам флаг платформы.
        const unicode = entity.unicode
        if (!IS_EMOJI_SUPPORTED && unicode && isSafeEmojiUnicode(unicode)) {
          const img = document.createElement('img')
          // Имя файла — только hex-кодпоинты (см. emoji.ts): подстановки пути нет.
          img.src = EMOJI_CDN_BASE + unicode + '.png'
          img.className = 'emoji emoji-image'
          element = img
          property = 'alt'
        } else {
          element = document.createElement('span')
          element.className = 'emoji emoji-native'
        }

        break
      }

      case 'linebreak': {
        // перевод строки внутри/вокруг блочной сущности уже «съеден» ею
        if (options.ignoreNextIndex === nasty.i) {
          usedText = true
        }

        break
      }

      case 'url':
      case 'text_link': {
        if (!(options.noLinks && !passEntities[entity.type])) {
          const rawUrl = entity.url || fullEntityText
          const wrapped = safeWrapUrl(rawUrl)

          if (!wrapped) {
            // Схема не в allow-list (`javascript:`, `data:`, `blob:`, `vbscript:`, `file:`, …).
            // tweb пропустил бы всё, кроме `javascript:`; мы ссылку не рисуем вовсе —
            // остаётся текст в `<span>` с тем же классом (как `components/RichText.tsx:80-83`).
            const span = document.createElement('span')
            span.className = 'anchor-url'
            element = span
            break
          }

          let masked = false
          if (entity.type === 'text_link') {
            if (nextEntity?.type === 'url' &&
              nextEntity.length === entity.length &&
              nextEntity.offset === entity.offset) {
              nasty.lastEntity = nextEntity
              ++nasty.i
            }

            if (wrapped.url !== fullEntityText) {
              masked = true
            }
          }
          // tweb для голого url считает masked через `isMixedScriptUrl` (домены со
          // смешанными алфавитами, нужен вендорный `convertPunycode`) — не портирован.

          const anchor = document.createElement('a')
          anchor.className = 'anchor-url'
          anchor.href = wrapped.url

          if (!wrapped.action) {
            setBlankToAnchor(anchor)
          }

          const action = wrapped.action ?? (masked ? 'showMaskedAlert' : undefined)
          if (action) {
            anchor.setAttribute(ANCHOR_ACTION_ATTRIBUTE, action)
          }

          element = anchor
        }

        break
      }

      case 'email': {
        // условие 1:1 tweb (:618) — да, у email оно отличается от остальных
        if (!options.noLinks && !passEntities[entity.type]) {
          // tweb: `encodeEntities('mailto:' + text)` — HTML-энкодер на DOM-свойстве
          // не защищает и ломает адрес; у нас обычная конкатенация + allow-list.
          const href = safeUrl('mailto:' + fullEntityText)
          if (href) {
            const anchor = document.createElement('a')
            anchor.href = href
            setBlankToAnchor(anchor)
            element = anchor
          }
        }

        break
      }

      case 'hashtag': {
        const contextUrl = !options.noLinks && SITE_HASHTAGS[contextSite]
        if (contextUrl) {
          const hashtag = fullEntityText.slice(1)
          const href = safeUrl(contextUrl.replace('{1}', encodeURIComponent(hashtag)))
          if (href) {
            const anchor = document.createElement('a')
            anchor.className = 'anchor-hashtag'
            anchor.href = href
            if (contextExternal) {
              setBlankToAnchor(anchor)
            } else {
              anchor.setAttribute(ANCHOR_ACTION_ATTRIBUTE, 'searchByHashtag')
            }

            element = anchor
          }
        }

        break
      }

      case 'text_mention': {
        if (!(options.noLinks && !passEntities[entity.type])) {
          const anchor = document.createElement('a')
          // tweb `buildURLHash('' + user_id)` = '#' + encodeURIComponent(id)
          anchor.href = '#' + encodeURIComponent('' + entity.user_id)
          anchor.className = 'follow'
          anchor.dataset.follow = '' + entity.user_id
          element = anchor
        }

        break
      }

      case 'mention': {
        if (!options.noLinks) {
          const username = fullEntityText.slice(1)
          const anchor = wrapTelegramUrlToAnchor('t.me/' + username)
          if (anchor) {
            anchor.className = 'mention'
            element = anchor
          }
        }

        break
      }

      case 'spoiler': {
        const container = document.createElement('span')
        container.className = 'spoiler'
        const spoilerText = document.createElement('span')
        spoilerText.className = 'spoiler-text'
        spoilerText.textContent = partText
        element = spoilerText
        usedText = true
        container.append(spoilerText)
        fragment.append(container)

        container.addEventListener(CLICK_EVENT_NAME, onSpoilerClick)

        break
      }

      case 'blockquote': {
        if (options.noTextFormat) {
          break
        }

        const quote = document.createElement('blockquote')
        quote.classList.add('quote', 'quote-block')
        // сворачиваемая цитата (`pFlags.collapsed` + observeResize) не портирована —
        // флага нет в нашей модели сущности
        quote.classList.add('quote-like', 'quote-like-border', 'quote-like-icon')
        quote.setAttribute('dir', 'auto') // tweb setDirection()
        element = quote

        processingBlockElement = true
        break
      }
    }

    if (processingBlockElement && element) {
      let foundNextLinebreakIndex = -1
      for (let i = nasty.i; i < length; ++i) {
        const n = entities[i]
        if (n.type === 'linebreak' && n.offset >= endOffset) {
          foundNextLinebreakIndex = i
          break
        }
      }

      if (foundNextLinebreakIndex !== -1 && nasty.text.slice(endOffset, entities[foundNextLinebreakIndex].offset).trim()) {
        foundNextLinebreakIndex = -1
      }

      if (endOffset < nasty.text.length) {
        // * ignore inner linebreak if found and double next linebreak
        if (!element.parentElement) {
          const container = document.createElement('div')
          container.append(element)
          fragment.append(container)
        }

        if (nasty.text[endOffset - 1] === '\n') {
          let lastInnerLinebreakIndex = -1
          for (let i = nasty.i; i < length; ++i) {
            const n = entities[i]
            if (n.offset >= endOffset) {
              break
            }

            if (n.type === 'linebreak') {
              lastInnerLinebreakIndex = i
            }
          }

          if (lastInnerLinebreakIndex !== -1) {
            options.ignoreNextIndex = lastInnerLinebreakIndex
          }
        } else if (foundNextLinebreakIndex !== -1) {
          options.ignoreNextIndex = foundNextLinebreakIndex
        }
      }
    }

    if (!usedText && partText) {
      if (element) {
        if (property) {
          // property === 'alt' ставится только у `img` (ветка эмодзи)
          (element as HTMLImageElement)[property] = partText
        } else {
          element.append(partText)
        }
      } else {
        fragment.append(partText)
      }
    }

    if (element && !element.parentNode) {
      (lastElement || fragment).append(element)
    }

    // Вложенность — рекурсией самого себя (tweb :932-941): вложенная сущность
    // обрабатывается отдельным вызовом с `voodoo: true`, который вернёт фрагмент
    // ровно на неё, а курсор `nasty` у вызовов общий.
    while (nextEntity && nextEntity.offset < endOffset) {
      ++nasty.i

      const inner = wrapRichText(nasty.text, {
        ...options,
        voodoo: true,
      })
      const target = element || fragment
      target.append(inner)

      nextEntity = entities[nasty.i + 1]
    }

    if (nasty.usedLength <= endOffset) {
      if (nasty.usedLength < endOffset) {
        (element || fragment).append(nasty.text.slice(nasty.usedLength, endOffset))
        nasty.usedLength = endOffset
      }

      lastElement = fragment
      nasty.lastEntity = undefined
    } else if (entity.length > partText.length && element) {
      lastElement = element
    } else {
      lastElement = fragment
    }

    if (options.voodoo) {
      return fragment
    }
  }

  if (nasty.lastEntity) {
    nasty.usedLength = nasty.lastEntity.offset + nasty.lastEntity.length
  }

  if (nasty.usedLength < textLength) {
    (lastElement || fragment).append(nasty.text.slice(nasty.usedLength))
  }

  fragment.normalize()

  return fragment
}

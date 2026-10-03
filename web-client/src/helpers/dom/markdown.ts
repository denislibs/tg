/**
 * Порт tweb `helpers/dom/markdown.ts` (812502980) — форматирование в поле ввода.
 * Модель tweb: формат ставит сам браузер (`execCommand('fontName', 'markup-bold-italic')`
 * под `styleWithCSS`), то есть span с `font-family: markup-…`; `processCurrentFormatting`
 * переводит это в `.is-markup` + `data-markup` (по ним рисуют стили
 * `styles/tweb/_markup.scss`, `_quote.scss`), а `getRichValueWithCaret` читает из
 * них сущности. Благодаря `execCommand` правка попадает в родную историю
 * браузера — undo/redo нативные, а после них `processCurrentFormatting(input,
 * undefined, 'historyUndo' | 'historyRedo')` (из `onMessageInput` поля) чинит
 * классы восстановленных узлов.
 *
 * Отличия от оригинала:
 *  1. Кэш undo (`MarkdownCache`, `createMarkdownCache`, `clearMarkdownExecutions`,
 *     `maybeClearUndoHistory`, `prepareDocumentExecute`, `undoRedo`, `:14-109`) не
 *     перенесён: в tweb он мёртв — `createMarkdownCache` возвращает `undefined`
 *     первой строкой (`:33`), карта кэша никогда не наполняется, остальные пять
 *     выходят на `if(!cache) return`.
 *  2. `MarkupTooltip` (тултип разметки, Б-33) не портирован:
 *     `MarkupTooltip.DISPLAY_MARKUP_PARTLY` (static `false`, tweb
 *     `markupTooltip.ts:26`) подставлен значением — снимается формат, покрывающий
 *     выделение ЦЕЛИКОМ; `setActiveMarkupButton()` после применения (`:295`) не
 *     зовётся; Ctrl+K в `handleMarkdownShortcut` (`:515-516`, `showLinkEditor`)
 *     не делает ничего, кроме гашения события, — ссылку ставит `applyMarkdown({type:
 *     'link', href})`, его позовёт тултип.
 *  3. `RichInputHandler.prepareApplyingMarkdown()`/`restore()` вокруг команды
 *     (`:252-253`, `:291`) не зовутся — см. шапку `richInputHandler.ts`.
 */
import { FontFamilyName } from '@config/font'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import cancelEvent from '@helpers/dom/cancelEvent'
import simulateEvent from '@helpers/dom/dispatchEvent'
import getCharAfterRange from '@helpers/dom/getCharAfterRange'
import type { MarkdownType } from '@helpers/dom/getRichElementValue'
import getMarkupInSelection from '@helpers/dom/getMarkupInSelection'
import isSelectionEmpty from '@helpers/dom/isSelectionEmpty'
import { setDirection } from '@helpers/dom/setInnerHTML'
import filterUnique from '@helpers/array/filterUnique'

/** tweb `MarkupTooltip.DISPLAY_MARKUP_PARTLY` (`markupTooltip.ts:26`) — см. шапку, п. 2. */
const DISPLAY_MARKUP_PARTLY = false

export function joinMarkupNames(types: MarkdownType[]) {
  return 'markup-' + filterUnique(types).join('-')
}

export function splitMarkupNames(markup: string) {
  return markup.split('-').slice(1).map((str) => str.split(/\d/, 1)[0]) as MarkdownType[]
}

const canCombine: readonly MarkdownType[] = ['bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'quote']
const canCombineWithQuote: readonly MarkdownType[] = ['monospace', 'date']
const cantCombine: readonly MarkdownType[] = ['monospace', 'date']
const NO_INNER_QUOTES = false

export function applyMarkdown({ input, type, href, dateSuffix }: { input: HTMLElement, type: MarkdownType, href?: string, dateSuffix?: string }) {
  const commandsMap: Partial<{ [key in typeof type]: string | (() => boolean) }> = {
    link: href ? () => input.ownerDocument.execCommand('createLink', false, href) : () => resetLinkFormatting(input),
  }

  const processCommand = (type: MarkdownType) => {
    const isCombineable = canCombine.includes(type)
    const isQuoteCombineable = isCombineable || canCombineWithQuote.includes(type)
    const canHaveTypes = isCombineable ? canCombine.slice() : [type]

    // * these types can actually combine
    if(type === 'quote') canHaveTypes.push(...canCombineWithQuote)
    else if(canCombineWithQuote.includes(type)) {
      canHaveTypes.push('quote')
    }

    const currentType = hasMarkup[type]
    const isRemoving = !!(DISPLAY_MARKUP_PARTLY ? currentType?.partly : currentType?.fully) && !dateSuffix
    const k = canHaveTypes.filter((type) => hasMarkup[type]?.fully)
    if(isRemoving) {
      indexOfAndSplice(k, type)
    } else {
      k.push(dateSuffix ? type + dateSuffix as MarkdownType : type)
    }

    // * don't spawn inner quote formatting
    if(NO_INNER_QUOTES && isQuoteCombineable && hasMarkup.quote.fully) {
      indexOfAndSplice(k, 'quote')
    }

    if(type === 'quote') {
      const selection = input.ownerDocument.defaultView!.getSelection()!
      if(selection.rangeCount && getCharAfterRange(selection.getRangeAt(0)) === '\n') {
        const toLeft = false
        selection.modify(
          selection.isCollapsed ? 'move' : 'extend',
          toLeft ? 'backward' : 'forward', 'character',
        )
      }
    }

    let ret: boolean
    if(k.length) {
      ret = input.ownerDocument.execCommand('fontName', false, joinMarkupNames(k))
    } else {
      ret = resetCurrentFontFormatting(input)
    }

    processCurrentFormatting(input, { type, active: !isRemoving })

    return ret
  }

  ;[...canCombine, ...cantCombine].forEach((type) => {
    commandsMap[type] = processCommand.bind(null, type)
  })

  if(!commandsMap[type]) {
    return false
  }

  const command = commandsMap[type]

  const executed: boolean[] = []

  const listenerOptions: AddEventListenerOptions = { capture: true, passive: false }
  input.addEventListener('input', cancelEvent, listenerOptions)

  executed.push(input.ownerDocument.execCommand('styleWithCSS', false, 'true'))

  const commandsKeys = Object.keys(commandsMap) as (typeof type)[]
  const hasMarkup = getMarkupInSelection(commandsKeys)

  if(cantCombine.some((type) => hasMarkup[type]?.partly) && type === 'link') {
    executed.push(resetCurrentFormatting(input))
  } else if(hasMarkup['link']?.partly && cantCombine.includes(type)) {
    executed.push(resetLinkFormatting(input))
  }

  executed.push(typeof(command) === 'function' ? command() : input.ownerDocument.execCommand(command, false))

  executed.push(input.ownerDocument.execCommand('styleWithCSS', false, 'false'))

  input.removeEventListener('input', cancelEvent, listenerOptions)
  simulateEvent(input, 'input')

  return true
}

export function processCurrentFormatting(
  input: HTMLElement,
  toggling?: {
    type: MarkdownType
    active: boolean
  },
  inputType?: 'historyUndo' | 'historyRedo',
) {
  const quoteSelectorByData = '[data-markup*="quote"]'
  const quoteSelectorByStyle = '[style*="quote"]'
  const quoteClasses = ['quote', 'quote-block', 'quote-like', 'quote-like-icon', 'quote-like-border']
  // * add styles
  const add = () => (input.querySelectorAll('[style*="font-family"]') as NodeListOf<HTMLElement>)
  .forEach((element) => {
    if(element.style.caretColor) { // cleared blockquote
      element.style.cssText = ''
      return
    }

    const fontFamily = element.style.fontFamily
    if(fontFamily === FontFamilyName) {
      return
    }

    let markup = fontFamily
    // * fix inner quotes
    if(
      NO_INNER_QUOTES &&
      markup.includes('quote') &&
      element.parentElement!.closest('[data-markup*="quote"]') &&
      toggling?.type !== 'quote'
    ) {
      const splitted = splitMarkupNames(markup)
      indexOfAndSplice(splitted, 'quote')
      if(splitted.length) {
        markup = joinMarkupNames(splitted)
      } else {
        element.style.fontFamily = ''
        delete element.dataset.markup
        return
      }
    }

    // * process date suffix
    if(markup.includes('date')) {
      const dateSuffix = markup.split('date')[1].split('-')[0]
      if(dateSuffix) {
        markup = markup.replace('date' + dateSuffix, 'date')
        element.dataset.date = dateSuffix
      }
    }

    element.classList.add('is-markup')
    element.dataset.markup = markup
    if(fontFamily !== markup) element.style.fontFamily = markup
    setDirection(element)
  })

  // * remove styles
  const remove = () => (input.querySelectorAll('.is-markup') as NodeListOf<HTMLElement>)
  .forEach((element) => {
    const fontFamily = element.style.fontFamily
    if(fontFamily && fontFamily !== FontFamilyName) {
      return
    }

    // * fix (restore / remove conflicting) nested/intersecting formatting
    // * for exampe, toggling italic for selection but part of it has bold
    let { markup } = element.dataset
    if(toggling) {
      let goodTypes: MarkdownType[]
      if(cantCombine.includes(toggling.type)) { // * filter out other formatting when adding monospace, etc
        goodTypes = splitMarkupNames(markup!)
        .filter((type) => type === 'quote' || type === toggling.type)
      } else { // * filter out monospace, etc when adding bold
        goodTypes = splitMarkupNames(markup!)
        .filter((type) => canCombine.includes(type))
      }

      if(!toggling.active) {
        indexOfAndSplice(goodTypes, toggling.type)
      }

      if(goodTypes.length) {
        markup = joinMarkupNames(goodTypes)
        element.style.fontFamily = element.dataset.markup = markup
        return
      }
    } else if(!toggling && markup) { // * auto mode (undo/redo). preserve intersecting formatting
      element.style.fontFamily = markup
      return
    }

    element.classList.remove('is-markup')
    delete element.dataset.markup
  })

  const processQuotes = () => {
    (input.querySelectorAll(quoteSelectorByData) as NodeListOf<HTMLElement>)
    .forEach((element) => {
      const isRealQuote = !element.parentElement!.closest(quoteSelectorByData)
      if(isRealQuote) element.classList.add(...quoteClasses)
      else element.classList.remove(...quoteClasses)
      delete element.dataset.brokenQuote
    })

    ;(input.querySelectorAll(`.${quoteClasses[0]}:not(${quoteSelectorByData})`) as NodeListOf<HTMLElement>)
    .forEach((element) => {
      element.classList.remove(...quoteClasses)
      element.dataset.brokenQuote = 'true'
    })
  }

  // * fix case when browser decides to mess up the quote
  // * rely on the browser's ability to set font-family correctly
  const fixQuotes = () => {
    (input.querySelectorAll(`${quoteSelectorByData}:not(${quoteSelectorByStyle})`) as NodeListOf<HTMLElement>)
    .forEach((element) => {
      // * need to check the length because 'every' will return true if the array is empty
      const children = Array.from(element.children) as HTMLElement[]
      const canReallyBeQuote = children.length && children.every((child) => {
        return child.matches(quoteSelectorByStyle)
      })

      const { markup } = element.dataset
      if(canReallyBeQuote) {
        element.style.fontFamily = markup!
      } else {
        const goodTypes = splitMarkupNames(markup!)
        indexOfAndSplice(goodTypes, 'quote')
        if(goodTypes.length) {
          element.dataset.markup = joinMarkupNames(goodTypes)
        } else {
          delete element.dataset.markup
        }
      }
    })
  }

  if(inputType === 'historyRedo') {
    fixQuotes()
  }

  const order = [add, remove]
  order.forEach((callback) => callback())
  processQuotes()
}

export function resetCurrentFormatting(input: HTMLElement) {
  return input.ownerDocument.execCommand('removeFormat', false)
}

export function resetCurrentFontFormatting(input: HTMLElement) {
  return input.ownerDocument.execCommand('fontName', false, FontFamilyName)
}

export function resetLinkFormatting(input: HTMLElement) {
  return input.ownerDocument.execCommand('unlink', false)
}

export function handleMarkdownShortcut(input: HTMLElement, e: KeyboardEvent) {
  const formatKeys: { [key: string]: MarkdownType } = {
    'KeyB': 'bold',
    'KeyI': 'italic',
    'KeyU': 'underline',
    'KeyS': 'strikethrough',
    'KeyM': 'monospace',
    'KeyP': 'spoiler',
    'KeyK': 'link',
  }

  const code = e.code
  const markdownType = formatKeys[code]

  const selection = input.ownerDocument.defaultView!.getSelection()
  if(!isSelectionEmpty(selection) && markdownType) {
    // * костыльчик: Ctrl+K — редактор ссылки тултипа разметки (см. шапку, п. 2)
    if(code !== 'KeyK') {
      applyMarkdown({ input, type: markdownType })
    }

    cancelEvent(e) // cancel legacy event
  }
}

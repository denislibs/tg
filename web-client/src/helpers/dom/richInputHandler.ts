/**
 * Порт tweb `helpers/dom/richInputHandler.ts` (812502980, 900 строк) — синглтон
 * поля ввода: запоминает выделение каждого редактируемого узла по
 * `selectionchange` и умеет вернуть фокус с ним (`makeFocused`) — так эмодзи из
 * дропдауна и вставка встают туда, где стояла каретка до потери фокуса.
 *
 * Перенесена ЖИВАЯ часть файла. В tweb `USING_BOMS = false` (`:14`), и всё, что
 * под этим флагом, не подписано и не вызывается: BOM-каретка вокруг своих эмодзи
 * (`onSelectionChange`, `superMove`, `onKeyDown`, `onFocusOut`, `:80-268`,
 * `:691-706`), `onBeforeInput` с филлерами и починкой undo/redo (`:306-689`;
 * его зовёт только `insertRichTextAsHTML` под тем же `USING_BOMS`), обработка
 * филлеров (`processEmptiedFillers`/`processFilledFillers`/`removeExtraBOMs`,
 * `:718-829`) и `setSelectionClassName` (`:831-847`). `prepareApplyingMarkdown`
 * (`:870-895`) снимает `contenteditable` с `.input-something` и чистит
 * `.input-filler` — таких узлов наш `wrapDraftText` не рождает (см. шапку
 * `lib/richtext/wrapRichText.ts`), вызов в `applyMarkdown` убран вместе с ним.
 * Вернуть всё это — вместе с BOM-филлерами своих эмодзи (порт
 * `CustomEmojiRendererElement`).
 *
 * Слушатель — на документе активного окна (`bindActiveWindowListener`), как в
 * tweb: при выносе клиента в Document PiP выделение продолжает сохраняться.
 */
import { bindActiveWindowListener, getAppWindow } from '@helpers/appWindow'
import placeCaretAtEnd from '@helpers/dom/placeCaretAtEnd'

export default class RichInputHandler {
  private static INSTANCE: RichInputHandler | undefined

  private savedRanges: WeakMap<HTMLElement, Range>

  constructor() {
    this.savedRanges = new WeakMap()

    // This singleton lives for the app's lifetime, so the follow-subscription is never disposed.
    bindActiveWindowListener((w) => w.document, 'selectionchange', this.saveSelectionOnChange)
  }

  private saveRangeForElement(element: HTMLElement | null) {
    if(element && (element.isContentEditable || element.tagName === 'INPUT')) {
      const selection = element.ownerDocument.defaultView!.getSelection()!
      if(selection.rangeCount) {
        this.savedRanges.set(element, selection.getRangeAt(0))
      }
    }
  }

  private saveSelectionOnChange = () => {
    const element = getAppWindow().document.activeElement as HTMLElement | null
    this.saveRangeForElement(element)
  }

  public restoreSavedRange(input: HTMLElement) {
    const range = this.getSavedRange(input)
    if(!range) {
      return false
    }

    const selection = input.ownerDocument.defaultView!.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    return true
  }

  public getSavedRange(input: HTMLElement) {
    return this.savedRanges.get(input)
  }

  public makeFocused(input: HTMLElement) {
    if(input.ownerDocument.activeElement !== input && !this.restoreSavedRange(input)) {
      placeCaretAtEnd(input, false, false)
    }
  }

  public static getInstance() {
    return this.INSTANCE ??= new RichInputHandler()
  }
}

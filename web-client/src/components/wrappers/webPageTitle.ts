// Порт tweb `src/components/wrappers/webPageTitle.ts` — заголовок карточки
// ссылки узлами: обрезка до 80 символов (порог 100) и разметка без ссылок.
//
// Отступления — следствия нашей модели, не выбор:
//  • `webPage.author` (tweb :6) в нашей `WebPage` нет (`core/media/messageMedia.ts`:
//    бэкенд его не производит) — остаётся один `title`;
//  • `noLinebreaks` (tweb :8) не передаётся: у нашего `wrapRichText` такой
//    опции нет, а в оригинале её ветка закомментирована
//    (`wrapRichText.ts:535-539`) — опция ничего не делает и там;
//  • `limitSymbols` — уже портированный (`core/peers/getPeerTitle.ts`), с его
//    «…» вместо «...» оригинала.
import type { WebPage } from '@core/media/messageMedia'
import { limitSymbols } from '@core/peers/getPeerTitle'
import wrapRichText from '@lib/richtext/wrapRichText'

export default function wrapWebPageTitle(webPage: WebPage) {
  let shortTitle = webPage.title || ''
  shortTitle = limitSymbols(shortTitle, 80, 100)
  return wrapRichText(shortTitle, { noLinks: true })
}

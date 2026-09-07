// Порт tweb `src/components/wrappers/webPageDescription.ts` — описание
// карточки ссылки узлами: обрезка до 150 символов (порог 180) и обычная
// разметка (ссылки внутри описания остаются ссылками).
//
// Отступления — следствия нашей модели, не выбор:
//  • ветка `isSponsored` (tweb :12-17, описание рекламного поста с его
//    `entities`) не портирована: рекламных сообщений в нашей модели нет;
//  • `whitelistedDomains` из `appConfig` (tweb :20) не подставляется: у нашего
//    `wrapRichText` этой опции нет — её читает только предупреждение о
//    замаскированной ссылке, которого у нас нет (`lib/richtext/wrapRichText.ts`);
//  • `limitSymbols` — уже портированный (`core/peers/getPeerTitle.ts`), с его
//    «…» вместо «...» оригинала.
import type { WebPage } from '@core/media/messageMedia'
import { limitSymbols } from '@core/peers/getPeerTitle'
import wrapRichText, { type WrapRichTextOptions } from '@lib/richtext/wrapRichText'

export default function wrapWebPageDescription(webPage: WebPage, richTextOptions?: WrapRichTextOptions) {
  const shortDescriptionText = limitSymbols(webPage.description || '', 150, 180)
  return wrapRichText(shortDescriptionText, richTextOptions)
}

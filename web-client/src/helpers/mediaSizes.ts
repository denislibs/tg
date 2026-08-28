// Путь tweb (`@helpers/mediaSizes`), по которому mediaSizes импортируют
// вендорные островки (медиавьювер `components/mediaViewer/base.ts`, lottie
// `lib/lottie/lottiePlayer.ts`) — ровно как в оригинале.
//
// Своей реализации здесь БОЛЬШЕ НЕТ: до порта тут жил обрезанный класс с
// собственным `isMobile` (`window.innerWidth <= 600`) — второй владелец того же
// факта. Полный порт tweb `helpers/mediaSizes.ts` (активный набор размеров +
// `changeScreen`/`resize`) лежит в `core/dom/mediaSizes.ts`, вместе с
// `setAttachmentSize`; здесь только ре-экспорт того же инстанса.
// `setAttachmentSize` в tweb — отдельный модуль `@helpers/setAttachmentSize`,
// у нас он лежит в том же `core/dom/mediaSizes.ts`; вендорным островкам он
// нужен так же (вьювер считает бокс им, tweb mediaViewer/base.ts:2465).
export { MediaSizes, ScreenSize, setAttachmentSize, default } from '@core/dom/mediaSizes'

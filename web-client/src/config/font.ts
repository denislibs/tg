// Порт tweb `src/config/font.ts` — 1:1. Значения совпадают с нашей типографикой
// (`styles/_fonts.scss` подключает ту же Roboto), поэтому подставлять свои не
// требуется. Единственный потребитель — измерение ширины текста канвасом
// (`MiddleEllipsisElement`), как и в оригинале.
export const FontFamilyName = 'Roboto'
export const FontFamily =
  FontFamilyName +
  ', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'
export const FontSize = '16px'
export const FontWeight = '400'
export const FontWeightBold = '500'
export const FontFull = `${FontWeight} ${FontSize} ${FontFamily}`
export const FontFullBold = `${FontWeightBold} ${FontSize} ${FontFamily}`

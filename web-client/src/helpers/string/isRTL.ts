// Порт tweb `src/helpers/string/isRTL.ts` — 1:1 (правки только под формат
// `.oxlintrc.json`: без `;`, один `const` на строку).
// https://stackoverflow.com/a/14824756/6758968
const ltrChars =
  'A-Za-zÀ-ÖØ-öø-ʸ̀-֐ࠀ-῿' +
  'Ⰰ-﬜﷾-﹯﻽-￿'
const rtlChars = '֑-߿יִ-﷽ﹰ-ﻼ'
const fullRtlDirCheck = new RegExp('^[^' + ltrChars + ']*[' + rtlChars + ']')
const justRtlDirCheck = new RegExp('[' + rtlChars + ']')

export default function isRTL(s: string, anyChar?: boolean): boolean {
  return anyChar ? justRtlDirCheck.test(s) : fullRtlDirCheck.test(s)
}

export function endsWithRTL(s: string): boolean {
  return justRtlDirCheck.test(s?.slice(-1))
}

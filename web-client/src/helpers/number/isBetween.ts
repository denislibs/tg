// Порт tweb `helpers/number/isBetween.ts` — 1:1; правки только под формат
// `.oxlintrc.json` (без `;`).
export default function isBetween(num: number, min: number, max: number) {
  return num >= min && num <= max
}

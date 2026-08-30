// Порт tweb `helpers/string/capitalizeFirstLetter.ts` 1:1. Нужен `IntlDateElement`
// (`lib/langPack.ts`): в ряде локалей (ru: «пн», «авг.») `Intl` отдаёт строчную
// букву, а метка даты стоит первой в своей ячейке.
export default function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

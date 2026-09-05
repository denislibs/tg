// Форматирование телефона профиля — порт tweb `components/wrappers/
// formatUserPhone.ts` (`'+' + formatPhoneNumber(phone).formatted`).
//
// Оригинал группирует цифры по `HelpCountryCode.patterns` — списку масок,
// приезжающему с сервера (`help.countriesList`, `helpers/formatPhoneNumber.ts`).
// У нас такой ручки/предмета нет вовсе (grep по `appConfig`/`fragment_prefixes`/
// `HelpCountry` по кодовой базе — пусто). Второй источник для этого же самого
// не заводим — переиспользуем СУЩЕСТВУЮЩИЙ портированный справочник стран
// (`components/auth/countries.ts::COUNTRIES`, уже сгенерирован из того же tweb
// `src/countries.ts`, что и оригинальный `help.countriesList`), которым
// пользуется маска номера при входе (`SignInCard.solid.tsx`). Он несёт ОДИН
// паттерн на страну (`patterns[0]` источника, см. докблок `phoneMask` в
// `countries.ts`) — тот же обход, каким уже живёт вход, а не новый.
import { COUNTRIES, countryByPhone } from '../../components/auth/countries'

/**
 * `+79261234567` → `+7 926 123 45 67`. Страна не распозналась (номер не
 * начинается ни с одного известного кода) — возвращаем `+<цифры>` как есть,
 * тот же исход, что у tweb `formatPhoneNumber` при пустом `prefixCountry`
 * (`{formatted: str, country: undefined, ...}`, без кода — только цифры).
 */
export function formatUserPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const country = countryByPhone(digits)
  if (!country) return '+' + digits

  const codeDigits = country.code.slice(1)
  const national = digits.slice(codeDigits.length)
  if (!country.pattern) return `+${codeDigits} ${national}`.trimEnd()

  const groups: string[] = []
  let i = 0
  for (const len of country.pattern) {
    if (i >= national.length) break
    groups.push(national.slice(i, i + len))
    i += len
  }
  // Номер длиннее паттерна страны (редкость, но не повод обрезать цифры) —
  // остаток одним хвостовым куском, как есть.
  if (i < national.length) groups.push(national.slice(i))

  return groups.length ? `+${codeDigits} ${groups.join(' ')}` : `+${codeDigits}`
}

// Ре-экспорт ради теста и на случай, если понадобится сама запись страны
// (код/паттерн) вызывающему — второй копии справочника заводить незачем.
export { COUNTRIES }

// Pure card formatting + validation for the mock Premium checkout. No DOM, no
// network — safe to import from both the UI and the worker manager. This is a
// clone: the server ignores card data, so validation only guards the form
// (format/length, non-expired date, CVC length). Luhn is offered as a helper but
// not required to pass checkout.

export interface CardInput {
  number: string
  /** "MM/YY" */
  expiry: string
  cvc: string
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

/** Group the card number into 4-digit blocks, capped at 19 digits. */
export function formatCardNumber(s: string): string {
  return digitsOnly(s).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
}

/** Format keystrokes into "MM/YY" (max 4 digits). */
export function formatExpiry(s: string): string {
  const d = digitsOnly(s).slice(0, 4)
  return d.length <= 2 ? d : d.slice(0, 2) + '/' + d.slice(2)
}

/** Card number is 13-19 digits (covers the common brands). */
export function isValidCardNumber(s: string): boolean {
  const d = digitsOnly(s)
  return d.length >= 13 && d.length <= 19
}

/** Standard Luhn checksum - exported for completeness; not required by isValidCard. */
export function luhnCheck(s: string): boolean {
  const d = digitsOnly(s)
  if (d.length < 13) return false
  let sum = 0
  let dbl = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48
    if (dbl) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    dbl = !dbl
  }
  return sum % 10 === 0
}

/** Expiry must be MM/YY with a real month and not be in the past. */
export function isValidExpiry(s: string, now: Date = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(s.trim())
  if (!m) return false
  const month = Number(m[1])
  if (month < 1 || month > 12) return false
  const year = 2000 + Number(m[2])
  // First day of the month AFTER expiry: still valid through the whole exp month.
  const expiresAfter = new Date(year, month, 1)
  return expiresAfter > now
}

export function isValidCvc(s: string): boolean {
  const d = digitsOnly(s)
  return d.length >= 3 && d.length <= 4
}

/** Whole-form gate: any well-formed, non-expired card passes (clone). */
export function isValidCard(c: CardInput, now: Date = new Date()): boolean {
  return isValidCardNumber(c.number) && isValidExpiry(c.expiry, now) && isValidCvc(c.cvc)
}

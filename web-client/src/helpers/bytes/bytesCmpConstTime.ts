// Порт tweb `helpers/bytes/bytesCmpConstTime.ts` — 1:1. Сравнение без раннего
// выхода: время не зависит от длины совпавшего префикса секрета (хеш сверки
// код-пароля, `lib/passcode/actions.ts`).
export default function bytesCmpConstTime(bytes1: number[] | Uint8Array, bytes2: number[] | Uint8Array) {
  const len = bytes1.length
  if(len !== bytes2.length) {
    return false
  }

  let diff = 0
  for(let i = 0; i < len; ++i) {
    diff |= bytes1[i] ^ bytes2[i]
  }

  return diff === 0
}

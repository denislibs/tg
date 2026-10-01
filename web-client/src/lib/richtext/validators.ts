// Порт tweb `src/lib/richTextProcessor/validators.ts:1-29` (812502980) — дословно.
// `isWebAppNameValid` (:31-33) не перенесён: его зовут только мини-приложения
// ботов, которых у нас нет. Первый потребитель — `components/usernameInputField.ts`.

// https://github.com/tdlib/td/blob/c95598e5e1493881d31211c1329bdbe4630f6136/td/telegram/misc.cpp#L246
export function isUsernameValid(username: string) {
  if(username.length < 3 || username.length > 32) {
    return false
  }

  if(!/[a-zA-Z]/.test(username.charAt(0))) {
    return false
  }

  for(let i = 0; i < username.length; i++) {
    const c = username.charAt(i)
    if(!/[a-zA-Z0-9_]/.test(c)) {
      return false
    }
  }

  if(username.charAt(username.length - 1) === '_') {
    return false
  }

  for(let i = 1; i < username.length; i++) {
    if(username.charAt(i - 1) === '_' && username.charAt(i) === '_') {
      return false
    }
  }

  return true
}

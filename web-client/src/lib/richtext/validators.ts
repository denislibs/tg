// Порт tweb `src/lib/richTextProcessor/validators.ts` (812502980) —
// `isUsernameValid` 1:1 (правило tdlib, ссылка ниже). Первый потребитель —
// поле имени пользователя `components/usernameInputField.ts` (вкладка
// «Редактировать профиль», задача 27 плана 2D).
//
// `isWebAppNameValid` (:31-33) не портирован: его зовёт только редактор
// мини-приложений бота — у нас их нет.
//
// Правило клиента мягче нашего серверного (`domain.ValidateUsername`:
// `^[a-z0-9_]{5,32}$` после приведения к нижнему регистру): имя в 3–4 символа
// клиент пропускает, и его отбивает сервер отказом `USERNAME_INVALID` — поле
// показывает `invalidText`, как у оригинала на тот же отказ
// (`usernameInputField.ts:83-93`).

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

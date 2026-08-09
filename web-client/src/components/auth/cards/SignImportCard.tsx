// SignImportCard — импорт сессии по одноразовому веб-токену из ссылки
// `#?tgWebAuthToken=…` (порт карточки tweb `pages/cards/SignImportCard.tsx`).
//
// Карточка живёт доли секунды: на монтировании кладётся прелоадер и сразу
// уходит обмен токена на сессию. Дерево 1:1 с живым tweb (dom-референс §2.7):
//
//   div.card                    ← БЕЗ page-модификатора и БЕЗ .input-wrapper
//     div                       ← preloaderHostEl, высота 0
//       div.preloader
//         svg.preloader-circular
//           circle.preloader-path
import { useEffect, useRef } from 'react'
import { useManagers } from '../../../core/hooks/useManagers'
import s from '../AuthFlow.module.scss'

export interface SignImportCardProps {
  /** веб-токен из хеша адреса */
  webAuthToken: string
  /** у аккаунта включён облачный пароль — дальше карточка пароля */
  onPasswordNeeded: (token: string, hint: string) => void
  /** токен недействителен / сервер не смог — назад на обычный вход */
  onFailed: () => void
  /** вход завершён */
  onComplete: () => void
}

export default function SignImportCard({
  webAuthToken,
  onPasswordNeeded,
  onFailed,
  onComplete,
}: SignImportCardProps) {
  const managers = useManagers()
  // Обмен — ровно один на монтирование карточки (tweb `onMount` → importWebToken).
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void managers.auth.signImport(webAuthToken, 'web', 'browser').then((res) => {
      // tweb чистит хеш до навигации: перезагрузка не должна снова тащить
      // сгоревший токен в этот же экран.
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
      if ('user' in res && res.user) {
        onComplete()
      } else if (res.passwordNeeded) {
        onPasswordNeeded(res.passwordToken, res.hint)
      } else {
        onFailed()
      }
    })
  }, [managers, webAuthToken, onPasswordNeeded, onFailed, onComplete])

  return (
    <div className={s.card}>
      {/* высота хоста — 0: `.preloader` позиционирован абсолютно и вылезает вверх */}
      <div>
        <div className="preloader">
          <svg xmlns="http://www.w3.org/2000/svg" className="preloader-circular" viewBox="25 25 50 50">
            <circle className="preloader-path" cx="50" cy="50" r="20" fill="none" strokeMiterlimit="10" />
          </svg>
        </div>
      </div>
    </div>
  )
}

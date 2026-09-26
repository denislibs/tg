import type { LangPackKey } from '@lib/langPack'

/**
 * Порт tweb/src/helpers/getAuthorizationErrorLangKey.ts (812502980).
 *
 * Сессия в первые сутки не может распоряжаться остальными. Завершение отвечает
 * FRESH_RESET_AUTHORISATION_FORBIDDEN; у оригинала подтверждение входа
 * документировано как FRESH_CHANGE_AUTHORIZATION_FORBIDDEN, но замечено и с
 * именем сброса — поэтому любой FRESH_* для пользователя значит одно: зайти с
 * более старого подключения.
 *
 * Имя отказа — поле `type` (довозит `superMessagePort.ts` через границу
 * воркера; на HTTP-границе это `error.text` конструктора отказа,
 * `net/restClient.ts`).
 */
export default function getAuthorizationErrorLangKey(error: ApiError): LangPackKey {
  return error?.type?.startsWith('FRESH_') ?
    'RecentSessions.Error.FreshReset' :
    'Error.AnError'
}

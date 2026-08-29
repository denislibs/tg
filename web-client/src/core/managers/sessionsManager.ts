import type { AccountAuthorizations, Authorization } from '@layer'
import type { RestClient } from '../net/restClient'

/**
 * Сессии устройств. Провод — конструкторы схемы: `GET /sessions` отдаёт
 * `account.authorizations` с вектором `authorization` (backend
 * `internal/domain/mtaccount.go`), и ровно он же уезжает потребителю.
 *
 * Плоской копии (`Session` + `mapSession`) здесь БОЛЬШЕ НЕТ: два представления
 * одной сущности — это то, что программа TL вычищала задачами #55 и #98.
 * Единственный потребитель — вкладка «Устройства»
 * (`components/sidebarLeft/tabs/activeSessions.solid.tsx`) — работает с
 * `Authorization.authorization` напрямую, как и её оригинал в tweb.
 *
 * Тип берётся ГЕНЕРИРУЕМЫЙ (`layer.d.ts`), а не рукописный: схема одна на
 * обе стороны, дубликат объявления неизбежно разъедется с ней.
 *
 * РАСХОЖДЕНИЕ ПРОВОДА (долг, задача 8): бэкенд не заполняет `app_name`,
 * `app_version`, `system_version`, `api_id` и `region` — их у нас просто нет
 * (`mtaccount.go`, `OmittedWithoutSubject`). Вкладка их читает и собирает
 * строки через `filter(Boolean)`, поэтому пустые поля не ломают вёрстку;
 * подставлять выдумки на клиенте нельзя — это спрячет расхождение вместо
 * того, чтобы его закрыть на бэке.
 */
interface SessionsDeps {
  rest: RestClient
}

export function newSessionsManager({ rest }: SessionsDeps) {
  return {
    async list(): Promise<Authorization.authorization[]> {
      const r = await rest.get<AccountAuthorizations.accountAuthorizations>('/sessions')
      return r.authorizations ?? []
    },

    /**
     * Гасит одну сессию: её токен умирает сразу, сокеты закрывает сервер.
     *
     * Отдаёт ИСХОД, а не `void`: бэкенд отвечает конструктором `Bool`
     * (`session_handler.go::Revoke` → `domain.NewBool(true)`), и вкладка
     * снимает строку только по успеху — 1:1 с оригиналом
     * (`activeSessions.tsx:117-121`, `.then((value) => {if(value) …})`).
     * Раньше ответ выбрасывался, и «получилось» было неотличимо от
     * «не получилось». Разворачивание `Bool` в булево — то же, что делает
     * `profileManager.checkUsername` (и уровень MTProto в оригинале).
     */
    async terminate(id: number): Promise<boolean> {
      const res = await rest.del<{ _: string }>(`/sessions/${id}`)
      return res._ === 'boolTrue'
    },

    /** «Terminate All Other Sessions» — всё, кроме текущей. Исход — см. `terminate`. */
    async terminateOthers(): Promise<boolean> {
      // Числа отозванных в ответе нет: его не читал никто, а список сессий
      // экран перезапрашивает.
      const res = await rest.del<{ _: string }>('/sessions/others')
      return res._ === 'boolTrue'
    },
  }
}

export type SessionsManager = ReturnType<typeof newSessionsManager>

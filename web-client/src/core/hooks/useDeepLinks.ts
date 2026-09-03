// Deep-links мессенджера (authed): /join/:token (вступление/заявка),
// /qr/:token (подтверждение входа с десктопа), /addlist/:slug (папка-приглашение)
// и ?domain=/?start= (публичная страница @username / deep-link бота). Один хук
// вместо четырёх эффектов в App. Состояние оверлеев (qr/addlist) отдаётся наружу
// — Shell их рендерит. Тосты идут через showToast.
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { loadFolders } from '../../stores/foldersStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { useT } from '../../i18n'
import appNavigationController from '../navigation/appNavigationController'

// Зачистка адреса после обработки диплинка — ЕДИНСТВЕННЫЙ писатель истории
// браузера обязан быть appNavigationController (задача 4, ОСТАТОК #108); свой
// `window.history.replaceState` мимо него не опознаётся проверкой
// `id === this.id` в `_onPopState` (писал `{}` вместо `this.id`). Полный
// сброс адреса (а не только хэша) — потому что все четыре случая ниже несут
// токен/параметр в ПУТИ или в query (`/join/:token`, `/qr/:token`,
// `/addlist/:slug`, `?domain=&start=`), а не в хэше, как у tweb (там
// `index.ts:579` чистит только хэш через `overrideHash`, потому что и токен
// живёт в хэше — `#?tgWebAuthToken=…`). У нас предмет тот же (не тащить
// сгоревший диплинк дальше между релоадами), метод контроллера — другой:
// `overrideHash` хэш не трогающую часть адреса не чистит.
//
// `overrideAddress`, а НЕ голый публичный `replaceState(url)` — тот не
// синхронизирует `currentHash`/`overriddenHash` и не идёт через очередь
// мутаций (`modifyHistoryFromEvent`), см. докблок метода в контроллере:
// диплинк-оверлей (qr/addlist) рендерится ПОВЕРХ уже открытого чата, и
// зачистка его адреса не должна ни рассинхронить хэш чата с внутренним
// состоянием контроллера, ни обогнать соседнюю мутацию истории.
const clearDeepLinkAddress = () => appNavigationController.overrideAddress(new URL('/', location.origin))

// /join обрабатываем не более одного раза за сессию приложения.
let joinDeepLinkHandled = false

export interface DeepLinks {
  /** ?domain=<username> — префилл поиска сайдбара */
  deepDomain: string | undefined
  qrConfirmToken: string | null
  addlistSlug: string | null
  confirmQr: () => Promise<void>
  cancelQr: () => void
  closeAddlist: () => void
  onAddlistJoined: (folderTitle: string) => void
}

export function useDeepLinks(showToast: (text: string) => void): DeepLinks {
  const managers = useManagers()
  const t = useT()
  const [qrConfirmToken, setQrConfirmToken] = useState<string | null>(null)
  const [addlistSlug, setAddlistSlug] = useState<string | null>(null)

  // /join/:token — вступить/послать заявку, показать баннер, очистить путь.
  useEffect(() => {
    if (joinDeepLinkHandled) return
    const m = location.pathname.match(/^\/join\/([\w-]+)$/)
    if (!m) return
    joinDeepLinkHandled = true
    void managers.groups
      .joinByToken(m[1])
      .then(async (res) => {
        if (res.status === 'joined') {
          await managers.dialogs.refresh()
          showToast('Вы вступили')
        } else {
          showToast('Заявка отправлена, ждите одобрения')
        }
      })
      .catch(() => showToast('Не удалось перейти по ссылке'))
      .finally(clearDeepLinkAddress)
  }, [managers, showToast])

  // /qr/:token — показать оверлей подтверждения.
  useEffect(() => {
    const m = location.pathname.match(/^\/qr\/([\w-]+)$/)
    if (m) setQrConfirmToken(m[1])
  }, [])

  // /addlist/:slug — попап предпросмотра/вступления в папку.
  useEffect(() => {
    const m = location.pathname.match(/^\/addlist\/([\w-]+)$/)
    if (m) setAddlistSlug(m[1])
  }, [])

  const confirmQr = async () => {
    if (!qrConfirmToken) return
    try {
      await managers.auth.qrConfirm(qrConfirmToken)
      showToast('Вход подтверждён')
    } catch {
      showToast('Не удалось подтвердить')
    }
    setQrConfirmToken(null)
    clearDeepLinkAddress()
  }

  const cancelQr = () => {
    setQrConfirmToken(null)
    clearDeepLinkAddress()
  }

  const closeAddlist = () => {
    setAddlistSlug(null)
    clearDeepLinkAddress()
  }

  const onAddlistJoined = (folderTitle: string) => {
    // Вступили в папку по ссылке — на сервере появилась новая папка, в памяти её
    // нет: cache-first обходим overwrite'ом (tweb getDialogFilters(true)).
    // `.catch` (Minor #3 финального ревью): refresh() пробрасывает HttpError, а
    // вызов идёт `void`-ом — на 401/5xx это был бы unhandled rejection.
    void managers.dialogs.refresh().then(() => loadFolders(managers, { overwrite: true })).catch(() => {})
    showToast(`${t('Folder.Added')}: ${folderTitle}`)
  }

  // ?domain=<username> с публичной страницы /@username: префилл поиска.
  // ?domain=<bot>&start=<payload> — deep-link бота: открыть чат и послать /start.
  const [deep] = useState(() => {
    const sp = new URLSearchParams(location.search)
    const domain = sp.get('domain') ?? undefined
    const start = sp.get('start')
    if (domain) clearDeepLinkAddress()
    return { domain, start }
  })
  useEffect(() => {
    if (!deep.domain || deep.start === null) return
    let cancelled = false
    void (async () => {
      try {
        const res = await managers.channels.search(deep.domain!)
        const u = res.users.find((x) => x.username?.toLowerCase() === deep.domain!.toLowerCase())
        if (!u || cancelled) return
        const peerId = await managers.bots.start(u.id, deep.start ?? '')
        if (cancelled) return
        useNavigationStore.getState().selectChat(String(peerId))
        void managers.dialogs.refresh().catch(() => {}) // см. .catch выше (Minor #3)
      } catch { /* ignore bad deep link */ }
    })()
    return () => { cancelled = true }
  }, [deep, managers])

  return { deepDomain: deep.domain, qrConfirmToken, addlistSlug, confirmQr, cancelQr, closeAddlist, onAddlistJoined }
}

// StickerSetModal — модалка набора стикеров («ADD N STICKERS»), порт tweb
// `components/popups/stickers.tsx` (шапка/тело/футер — строки 330-363, сборка
// сетки — 196-260, клик по стикеру — 145-162 `onStickersClick`). Открывается
// по клику на заголовок набора в «Поиске стикеров» (StickersSearchTab), там
// же пробрасывается колбэк отправки — см. проп `onPickSticker` ниже.
//
// Открытие по клику на стикер В ЧАТЕ (tweb wrapSticker → showStickersPopup) —
// в `StickerRealBubble` (`components/messages/MessageContent.tsx`): бэк
// резолвит mediaId в набор ручкой `GET /stickers/by-media/{mediaID}`
// (`stickersManager.setByMediaId`), т.к. `ConvMsg` несёт только mediaId, не
// slug. `onPickSticker` там — `feedFns.sendSticker` (проводка через
// `Chat.tsx`, тот же `sendSticker` из `useChatSend`, что и у композера):
// клик по стикеру ВНУТРИ попапа отправляет его в текущий чат, ровно как в
// tweb `onStickersClick` (там нет read-only режима в зависимости от точки
// входа — тот же вызов `sendMessageWithDocument`, что и из поиска).
// `undefined`, когда отправка недоступна (тот же гейт, что у кнопки стикеров
// композера — канал/секретный чат/нет прав на медиа): сетка тогда read-only.
//
// Каркас — общий `shared/ui/Popup/Popup` (тот же, что у DatePickerPopup/
// EmojiStatusPicker/…): глобальные классы `.popup`/`.popup-header`/
// `.popup-close`/`.popup-title`/`.popup-body`/`.popup-footer` из портированного
// партиала `styles/tweb/popups/_popup.scss`, ESC/Back и портал — тоже его.
// Своя сетка/шапка попапа стикеров — `styles/tweb/popups/_stickers.scss`
// (порт tweb `popups/_stickers.scss` 1:1).
//
// У tweb `showStickersPopup` принимает МАССИВ слагов (режим кастомных
// эмодзи — несколько наборов сразу, `sets.length > 1`); наш контракт
// (`StickerSetModal.slug: string`) — только один набор за раз, поэтому
// ветка с несколькими наборами (общий заголовок «Emoji», подзаголовок-Row
// на каждый вложенный набор, EmojiPackCount) не портирована — она не
// достижима ни из одного места, которое открывает эту модалку.
//
// Отступление от tweb: тексты кнопок/заголовка на время загрузки — литеральный
// русский («Загрузка», «Добавить N стикеров», «Удалить N стикеров»), а не через
// `useT()`. У tweb это ключи i18n-пакета (`Loading`, `AddStickersCount`,
// `RemoveStickersCount` + плюрал `Stickers: '%1$d stickers'` — число есть у ОБЕИХ
// кнопок), которых в нашем `i18n/dict.*` нет — заводить их ради одной этой
// модалки не стали (как `StoriesRow`'s aria-label — тоже литеральный русский
// без ключа), но число и падеж — как в tweb, через ту же `stickerWord(count)`.
import { useCallback, useEffect, useRef, useState } from 'react'
import rootScope from '@lib/rootScope'
import { openPopup } from '../../stores/popupStore'
import Popup from '../../shared/ui/Popup'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import StickerMedia from '../StickerMedia'
import Preloader from '../auth/Preloader'
import animationIntersector from '../animationIntersector'
import { useLazyVisibility } from '../useLazyVisibility'
import { toggleStickerSet } from '../../core/stickers/toggleStickerSet'
import { useManagers } from '../../core/hooks/useManagers'
import { useMiddlewareHelper } from '../../core/hooks/useMiddlewareHelper'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import classNames from '../../shared/lib/classNames'
import type { Sticker, StickerSet } from '../../core/managers/stickersManager'

// tweb stickers.tsx:35 — своя группа animationIntersector: пока попап открыт,
// играет ТОЛЬКО она (setOnlyOnePlayableGroup), остальные стикеры на странице
// (лента, панель) — на паузе.
const ANIMATION_GROUP = 'STICKERS-POPUP' as const

// tweb mediaSizes.ts:99 — popupSticker 80×80 на десктопе (68×68 на handhelds,
// :81). Раскладка ячейки целиком на CSS (--popup-sticker-size, см.
// styles/_tokens.scss); сюда идёт то же число для рендера самого медиа
// (canvas/img вписывается в эти px) — брейкпоинт CSS-переменной здесь не
// отслеживаем (mediaSizes.active в React-коде не порт, JS-ресайз стикера при
// смене брейкпоинта — известное упрощение).
const ITEM_SIZE = 80

// Запас предзагрузки сетки: один ряд ячеек за краем тела попапа — то же
// правило, что у кладки GIF (там это высота ряда).
const PRELOAD_MARGIN = `${ITEM_SIZE}px 0px`

/**
 * Ячейка сетки. Медиа монтируется, ТОЛЬКО когда ячейка видима: `StickerMedia`
 * фетчит файл на маунте, и без этого гейта открытие набора на 120 стикеров
 * запускало 120 параллельных загрузок и декодов сразу (у emoji-наборов — до
 * 200+). tweb на этом же попапе создаёт `new LazyLoadQueue()`
 * (popups/stickers.tsx:196) и отдаёт её каждому `wrapSticker` (:240).
 * Сама ячейка рендерится всегда — иначе поехала бы геометрия сетки и скролл.
 */
function StickerCell({ st, visible, register, onPick }: {
  st: Sticker
  visible: boolean
  register: (key: string, el: HTMLElement | null) => void
  onPick?: () => void
}) {
  // ref-колбэк стабилен: инлайновая стрелка меняла бы идентичность на каждый
  // рендер, React отцеплял бы и прицеплял узел заново, а наблюдатель на каждое
  // прицепление отчитывался бы снова.
  const ref = useCallback((el: HTMLDivElement | null) => register(String(st.id), el), [register, st.id])
  return (
    <div
      ref={ref}
      className="sticker-set-sticker media-sticker-wrapper"
      onClick={onPick}
    >
      {visible && (
        <StickerMedia
          mediaId={st.mediaId}
          width={ITEM_SIZE}
          height={ITEM_SIZE}
          autoplay
          loop
          group={ANIMATION_GROUP}
          thumb={st.thumb}
        />
      )}
    </div>
  )
}

/** Русские формы числительного (1 стикер / 2 стикера / 5 стикеров). */
function stickerWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'стикер'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'стикера'
  return 'стикеров'
}

export default function StickerSetModal({ slug, open = true, onClose, onExitComplete, onPickSticker }: {
  slug: string
  /**
   * Контракт popupStore «open-controlled» (см. stores/popupStore): владелец из
   * стека попапов ведёт закрытие сам (`open={p.open}` + `onExitComplete`), а
   * владелец, который держит модалку своим состоянием (StickersSearchTab),
   * просто размонтирует её — для него по умолчанию `true`.
   */
  open?: boolean
  onClose: () => void
  /** exit-анимация попапа доиграла — можно снимать со стека (popupStore) */
  onExitComplete?: () => void
  /**
   * Клик по стикеру внутри сетки — отправка в текущий чат + закрытие (tweb
   * `onStickersClick` → `sendMessageWithDocument` → `handle.hide()`,
   * popups/stickers.tsx:145-162). Опционально: у модалки самой по себе нет
   * доступа к «текущему чату» (это Composer-состояние, см.
   * `core/hooks/useChatSend.ts::sendSticker`) без правки контракта — контракт
   * не трогаем, поэтому колбэк пробрасывает владелец, у которого он уже есть
   * (`StickersSearchTab`). Без колбэка ячейки НЕ кликабельны (см. класс
   * `is-read-only` на сетке ниже) — аффорданс не изображает то, чего нет.
   */
  onPickSticker?: (st: Sticker) => void
}) {
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()

  const [set, setSet] = useState<StickerSet | null>(null)
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [installed, setInstalled] = useState(false)
  // Add/Remove — на время запроса гасится (tweb `disabled={!isLoaded()}` +
  // отдельно наш busy на время toggle, как в useStickersSearch.toggle).
  const [busy, setBusy] = useState(false)
  const loaded = set !== null
  // Ленивая загрузка ячеек по видимости — корень наблюдения — тело попапа
  // (оно и есть скроллер карточки).
  const bodyRef = useRef<HTMLDivElement>(null)
  const { visible, register } = useLazyVisibility(bodyRef, PRELOAD_MARGIN)

  // onClose/managers держим в ref: эффект загрузки не должен перезапускаться
  // из-за смены их ссылки между рендерами (onClose — обычный колбэк владельца;
  // managers из контекста стабилен в реальном приложении, но не в тестовом
  // моке хука, который отдаёт новый объект на каждый вызов, — без ref эффект
  // перезапускался бы на каждый setState и зациклился бы).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const managersRef = useRef(managers)
  managersRef.current = managers

  useEffect(() => {
    const middleware = middlewareHelper.get()
    const managers = managersRef.current
    setSet(null)
    setStickers([])
    setInstalled(false)

    void managers.stickers.setBySlug(slug).then(
      (r) => {
        if (!middleware()) return
        setSet(r.set)
        setStickers(r.stickers)
        void managers.stickers.mySets().then(
          (mine) => {
            if (!middleware()) return
            setInstalled(mine.some((s) => s.id === r.set.id))
          },
          () => {},
        )
      },
      () => {
        if (!middleware()) return
        rootScope.dispatchEvent('ui:toast', 'Набор стикеров не найден')
        onCloseRef.current()
      },
    )

    // Пока попап открыт, играет только эта группа (tweb onMount/onCleanup);
    // сброс — снятие ограничения на выходе, а не «ничего не играет».
    animationIntersector.setOnlyOnePlayableGroup(ANIMATION_GROUP)
    return () => {
      animationIntersector.setOnlyOnePlayableGroup()
    }
  }, [slug, middlewareHelper])

  // Своё состояние «установлен» ведёт не toggle, а подписка на объявление
  // (tweb popups/stickers.tsx:114-115 onStickerSetUpdate): набор могли поставить
  // или снять и не отсюда — из строки экрана поиска или вообще в другой вкладке.
  useEffect(() => {
    const onUpdate = (updated: StickerSet) => {
      if (set && updated.id === set.id) setInstalled(true)
    }
    const onDelete = (updated: StickerSet) => {
      if (set && updated.id === set.id) setInstalled(false)
    }
    rootScope.addEventListener('stickers_installed', onUpdate)
    rootScope.addEventListener('stickers_deleted', onDelete)
    return () => {
      rootScope.removeEventListener('stickers_installed', onUpdate)
      rootScope.removeEventListener('stickers_deleted', onDelete)
    }
  }, [set])

  const toggle = async () => {
    if (!set || busy) return
    setBusy(true)
    try {
      await toggleStickerSet(managers.stickers, set, installed)
    } finally {
      setBusy(false)
    }
  }

  const { onPointerDown: footerPointerDown, ripple: footerRipple } = useRipple()

  // «⋮» — копия ссылки набора (tweb buttons: [{icon: 'copy', text: 'CopyLink'}];
  // DEBUG-only «скачать» не портирован — dev-приём, вне контракта модалки).
  // anchor/open разведены, как в SendAsButton: anchor переживает exit-анимацию
  // Menu (сбрасывается в onExitComplete), open её запускает.
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const copyLink = () => {
    if (!set) return
    void navigator.clipboard.writeText(`https://t.me/addstickers/${set.slug}`)
    rootScope.dispatchEvent('ui:toast', 'Ссылка на набор скопирована')
    setMenuOpen(false)
  }

  return (
    <Popup
      open={open}
      className="popup-stickers"
      title={loaded ? set.title : 'Загрузка'}
      onClose={onClose}
      onExitComplete={onExitComplete}
      bodyClassName={loaded ? undefined : 'is-loading'}
      bodyRef={bodyRef}
      headerRight={
        loaded && (
          <>
            <IconButton
              color="var(--secondary-text-color)"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMenuAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right })
                setMenuOpen(true)
              }}
            >
              <TgIcon name="more" size={22} />
            </IconButton>
            {menuAnchor && (
              <Menu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                onExitComplete={() => setMenuAnchor(null)}
                corner="bottom-left"
                // .popup — 4090 (Popup.module.scss); без явного zIndex Menu
                // кладёт панель на 2001 (Menu.module.scss) — под попапом,
                // недостижимо. Тот же приём, что SendMediaPopup.tsx:118 (4100)
                // и StoryViewer.tsx:511 (3100) для меню поверх своего попапа.
                zIndex={4100}
                style={{ top: menuAnchor.top, right: menuAnchor.right, width: 220 }}
              >
                <MenuItem icon={<TgIcon name="copy" size={20} />} label="Скопировать ссылку" onClick={copyLink} />
              </Menu>
            )}
          </>
        )
      }
      footer={
        <div className={classNames('popup-footer', 'popup-footer-abitlarger', loaded ? 'popup-footer-floating' : '')}>
          <button
            type="button"
            className={classNames(
              'popup-footer-button', 'btn-primary', 'rp',
              !loaded ? 'btn-transparent primary text-bold'
                : installed ? 'btn-primary-transparent danger'
                : 'btn-color-primary',
            )}
            disabled={!loaded || busy}
            onPointerDown={footerPointerDown}
            onClick={() => void toggle()}
          >
            {footerRipple}
            {!loaded
              ? 'Загрузка'
              : `${installed ? 'Удалить' : 'Добавить'} ${set.count} ${stickerWord(set.count)}`}
          </button>
        </div>
      }
    >
      {!loaded ? (
        // tweb popups/stickers.tsx:339-342 — под `.is-loading` в теле попапа
        // лежит putPreloader, а не заглушка набора: у попапа уже есть свои
        // заголовок и кнопка, и «скелетная» шапка набора дорисовывала бы
        // фантомную вторую пару.
        <Preloader />
      ) : (
        <div className="sticker-set">
          <div className={classNames('sticker-set-stickers', onPickSticker ? '' : 'is-read-only')}>
            {stickers.map((st) => (
              <StickerCell
                key={st.id}
                st={st}
                visible={visible.has(String(st.id))}
                register={register}
                onPick={onPickSticker && (() => { onPickSticker(st); onClose() })}
              />
            ))}
          </div>
        </div>
      )}
    </Popup>
  )
}

/**
 * kind попапа набора: второй открытый набор заменяет первый, а не встаёт поверх
 * (tweb PopupElement kind — см. popupStore).
 */
export const STICKER_SET_POPUP_KIND = 'sticker-set'

/**
 * Публичный путь открытия — симметрично `openStickersSearchTab`.
 *
 * Попап обязан жить в ГЛОБАЛЬНОМ стеке (stores/popupStore), а не React-потомком
 * того узла, откуда его открыли. `Popup` монтируется через `createPortal`, но
 * синтетические события React всплывают по React-дереву, а не по DOM: попап,
 * отрендеренный внутри кликабельного бабла ленты, отдавал клик по своему
 * затемнению обратно в `onClick` бабла (попап закрывался и тут же
 * переоткрывался), а правый клик где угодно внутри попапа доходил до
 * `onContextMenu` ряда и открывал меню сообщения поверх. Плюс состояние
 * «какой набор открыт» жило в строке ленты — прунинг ленты или смена чата
 * убивали открытый попап.
 */
export function openStickerSetModal(slug: string, onPickSticker?: (st: Sticker) => void) {
  return openPopup(
    (p) => (
      <StickerSetModal
        slug={slug}
        open={p.open}
        onClose={p.requestClose}
        onExitComplete={p.onExitComplete}
        onPickSticker={onPickSticker}
      />
    ),
    STICKER_SET_POPUP_KIND,
  )
}

// StickerSetModal — модалка набора стикеров («ADD N STICKERS»), порт tweb
// `components/popups/stickers.tsx` (шапка/тело/футер — строки 330-363, сборка
// сетки — 196-260, клик по стикеру — 145-162 `onStickersClick`). Открывается
// по клику на заголовок набора в «Поиске стикеров» (StickersSearchTab), там
// же пробрасывается колбэк отправки — см. проп `onPickSticker` ниже.
//
// Открытие МОДАЛКИ по клику на стикер В ЧАТЕ (tweb wrapSticker →
// showStickersPopup) НЕ подключено: сообщение несёт только `mediaId` стикера
// (`ConvMsg` в `data.ts`), а бэкенд не отдаёт ни `set_id`, ни slug набора для
// произвольного `media_id` — только для стикеров ВНУТРИ уже загруженного
// набора (`Sticker.SetID` в `domain/sticker.go`, отдаётся лишь эндпоинтами
// `/sticker-sets/{slug}` и т.п.). Разрешить это без нового бэкенд-эндпоинта
// (или встраивания slug'а набора прямо в сообщение) нельзя — контракт не
// трогаем (см. отчёт задачи), открытие из чата не реализовано.
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
import { useEffect, useRef, useState } from 'react'
import rootScope from '@lib/rootScope'
import Popup from '../../shared/ui/Popup'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import StickerMedia from '../StickerMedia'
import StickerSetSkeleton from '../rightSidebar/StickerSetSkeleton'
import animationIntersector from '../animationIntersector'
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

/** Русские формы числительного (1 стикер / 2 стикера / 5 стикеров). */
function stickerWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'стикер'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'стикера'
  return 'стикеров'
}

export default function StickerSetModal({ slug, onClose, onPickSticker }: {
  slug: string
  onClose: () => void
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

  const toggle = async () => {
    if (!set || busy) return
    setBusy(true)
    try {
      if (installed) {
        await managers.stickers.uninstall(set.id)
        setInstalled(false)
      } else {
        await managers.stickers.install(set.id)
        setInstalled(true)
      }
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
      open
      className="popup-stickers"
      title={loaded ? set.title : 'Загрузка'}
      onClose={onClose}
      bodyClassName={loaded ? undefined : 'is-loading'}
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
        <StickerSetSkeleton count={1} />
      ) : (
        <div className="sticker-set">
          <div className={classNames('sticker-set-stickers', onPickSticker ? '' : 'is-read-only')}>
            {stickers.map((st) => (
              <div
                key={st.id}
                className="sticker-set-sticker media-sticker-wrapper"
                onClick={onPickSticker && (() => { onPickSticker(st); onClose() })}
              >
                <StickerMedia
                  mediaId={st.mediaId}
                  width={ITEM_SIZE}
                  height={ITEM_SIZE}
                  autoplay
                  loop
                  group={ANIMATION_GROUP}
                  thumb={st.thumb}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Popup>
  )
}

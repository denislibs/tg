// Заглушка набора на экране «Поиск стикеров», пока не приехала выдача: строка
// заголовка и пять плиток — ровно та раскладка, что у настоящего набора
// (tweb рисует превью из пяти стикеров), поэтому подмена не дёргает вёрстку.
import s from './StickerSetSkeleton.module.scss'

export default function StickerSetSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={s.set} data-testid="sticker-set-skeleton">
          <div className={s.header}>
            <div className={s.title} />
            <div className={s.button} />
          </div>
          <div className={s.tiles}>
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className={s.tile} data-testid="sticker-set-skeleton-tile" />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

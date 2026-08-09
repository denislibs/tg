// Морф play↔pause — один и тот же в бабле голосового, глобальном плеере и
// строках шаред-медиа профиля.
//
// Механика tweb: смена иконки в кнопке — не кросс-фейд движком анимаций, а
// CSS-кейфрейм `grow-icon .4s forwards ease-in-out` на приходящей иконке
// (`tweb src/scss/partials/_animatedIcon.scss:159-170`, `tweb src/scss/base.scss:1082-1097`);
// у нас кейфрейм уже есть глобально (`styles/tweb/_bridge.scss:96`).
// Ремаунт по `key` перезапускает анимацию на вставке узла — как у tweb, где
// класс состояния кнопки переводит нужную иконку с `hide-icon` на `grow-icon`.
//
// Отступление от tweb: там ОБЕ иконки лежат в DOM абсолютом и уходящая играет
// `hide-icon`; здесь глиф встраивается в поток чужих строк (ширину/высоту задаёт
// вызывающий), абсолютом его класть нельзя — поэтому уходящая снимается сразу.
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import s from './PlayPauseGlyph.module.scss'

export default function PlayPauseGlyph({
  playing,
  size,
  className,
}: {
  playing: boolean
  size?: number
  className?: string
}) {
  return (
    <span key={playing ? 'pause' : 'play'} className={classNames(s.glyph, className ?? '')}>
      {playing ? <TgIcon name="pause" size={size} /> : <TgIcon name="play" size={size} />}
    </span>
  )
}

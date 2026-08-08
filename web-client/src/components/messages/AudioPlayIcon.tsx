// src/components/messages/AudioPlayIcon.tsx
// Порт tweb `.audio-play-icon` (components/audio.ts:559-564 + _audio.scss:38-370):
// иконка play/pause — не глиф, а два белых квадрата, которым clip-path вырезает
// половинки фигуры; переключение состояния анимирует сам clip-path и доворачивает
// блок (-119deg → -90deg). Ставится ВНУТРЬ круглой кнопки (она задаёт размер и
// border-radius, который блок наследует).
import classNames from '../../shared/lib/classNames'
import s from './AudioPlayIcon.module.scss'

export default function AudioPlayIcon({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <div className={classNames(playing ? s.playing : s.idle, className ?? '')}>
      <div className={s.playIcon}>
        <div className={classNames(s.part, s.one)} />
        <div className={classNames(s.part, s.two)} />
      </div>
    </div>
  )
}

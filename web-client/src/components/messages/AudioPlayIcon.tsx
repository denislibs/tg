// src/components/messages/AudioPlayIcon.tsx
// Порт tweb `.audio-play-icon` (components/audio.ts:559-564 + _audio.scss:38-370):
// иконка play/pause — не глиф, а два белых квадрата, которым clip-path вырезает
// половинки фигуры; переключение состояния анимирует сам clip-path и доворачивает
// блок (-119deg → -90deg).
//
// Классы — глобальные из портированного `styles/tweb/_audio.scss`. Состояние
// (`playing`) в tweb висит на КНОПКЕ `.audio-toggle`, а не на самой иконке —
// поэтому здесь только разметка, класс ставит вызывающий.
export default function AudioPlayIcon() {
  return (
    <div className="audio-play-icon">
      <div className="part one" />
      <div className="part two" />
    </div>
  )
}

// Порт tweb `helpers/lerp.ts`. Довезён как зависимость `helpers/animateValue.ts`
// (анимация раскрытия медиа-спойлера). `lerpArray` оригинала не портирован:
// в tweb его потребитель — редактор медиа (`solid`-компоненты), которого у нас
// нет; сам `animateValue` массивы лерпит своей веткой, как в оригинале.
export function lerp(min: number, max: number, progress: number) {
  return min + (max - min) * progress
}

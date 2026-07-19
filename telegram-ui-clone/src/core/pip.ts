// Картинка в картинке (tweb PiP через video.requestPictureInPicture). Плеер
// видео просмотрщика вызывает enterPip(video) напрямую (кнопка в лайтбоксе).
// Пункт меню triggerPip() уводит в PiP текущее проигрываемое видео на странице.

export const pipSupported = (): boolean =>
  typeof document !== 'undefined' && !!document.pictureInPictureEnabled

// Ввести конкретный <video> в режим «картинка в картинке» (или выйти, если он
// уже там). Возвращает true, если PiP запущен.
export async function enterPip(video: HTMLVideoElement): Promise<boolean> {
  if (!pipSupported() || video.disablePictureInPicture) return false
  try {
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture()
      return false
    }
    await video.requestPictureInPicture()
    return true
  } catch {
    return false
  }
}

// Триггер из меню: берём видимое проигрываемое видео (лайтбокс/кружок), иначе
// любое готовое видео на странице. null-результат = нечего показывать.
export async function triggerPip(): Promise<boolean> {
  if (!pipSupported()) return false
  const videos = [...document.querySelectorAll('video')] as HTMLVideoElement[]
  const candidate =
    videos.find((v) => !v.paused && !v.disablePictureInPicture && v.readyState >= 2) ??
    videos.find((v) => !v.disablePictureInPicture && v.readyState >= 2)
  if (!candidate) return false
  return enterPip(candidate)
}

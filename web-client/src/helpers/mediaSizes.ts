// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
// Минимальная версия tweb helpers/mediaSizes: островку lottie нужен только флаг
// isMobile (getLottiePixelRatio понижает pixelRatio на мобильных). Полный
// реактивный mediaSizes на solid-js не тянем.
export class MediaSizes {
  public get isMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 600;
  }
}

const mediaSizes = new MediaSizes();
export default mediaSizes;
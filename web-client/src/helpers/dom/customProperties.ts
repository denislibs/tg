// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
// Минимальная версия tweb helpers/dom/customProperties: островку lottie нужен
// только getPropertyAsColor (textColor-тинт custom-emoji). Реактивную привязку к
// смене темы (rootScope) и mediaSizes не тянем — на этапе 1 стикеры не тинтуются.
export class CustomProperties {
  public getProperty(name: string): string {
    if(typeof document === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  public getPropertyAsColor(name: string): string {
    return this.getProperty(name);
  }
}

const customProperties = new CustomProperties();
export default customProperties;
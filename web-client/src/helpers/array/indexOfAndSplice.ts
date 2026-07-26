// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
export default function indexOfAndSplice<T>(array: Array<T>, item: T) {
  const idx = array.indexOf(item);
  const spliced = idx === -1 ? undefined : array.splice(idx, 1);
  return spliced?.[0];
}
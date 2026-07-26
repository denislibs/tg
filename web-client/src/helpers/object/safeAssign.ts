// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
export default function safeAssign<T>(object: T, fromObject: any) {
  if(fromObject) {
    for(const i in fromObject) {
      if(fromObject[i] !== undefined) {
        // @ts-ignore
        object[i] = fromObject[i];
      }
    }
  }

  return object;
}
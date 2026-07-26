// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
export default function pause(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
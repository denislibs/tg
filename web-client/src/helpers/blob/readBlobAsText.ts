// @ts-nocheck — вендорено из tweb 1:1 (островок tlottie); типы проверяются в апстриме
import readBlobAs from '@helpers/blob/readBlobAs';

export default function readBlobAsText(blob: Blob) {
  return readBlobAs(blob, 'readAsText');
}
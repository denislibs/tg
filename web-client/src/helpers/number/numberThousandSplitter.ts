/**
 * Порт tweb `helpers/number/numberThousandSplitter.ts` — разбивка числа по
 * тысячам. Разделитель по умолчанию обычный пробел: неразрывным оригинал его не
 * делает.
 *
 * Лежит здесь, а не рядом с одним из вызывающих, ровно по адресу оригинала: с
 * приходом второго потребителя (`wrappers/getChatMembersString.ts`, счётчик
 * подписчиков в шапке) локальная копия внутри `chat/messageTime.ts` перестала
 * быть локальной.
 */
export default function numberThousandSplitter(x: number, joiner = ' '): string {
  return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, joiner)
}

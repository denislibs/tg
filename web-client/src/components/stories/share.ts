// Отправка истории в чаты с согласием на плату. Порт тела tweb
// `components/stories/share.ts:20-31` (812502980): на каждого получателя — свой
// `PaidMessagesInterceptor.prepareStarsForPayment({messageCount: 1, peerId})`, отказавшему
// не шлём ничего. Выбор получателей остаётся у React-пикера `StoryViewer`
// (`ForwardPicker`), а отправка — по одному чату за вызов `stories.share`, чтобы цена и
// согласие были у каждого платного чата свои (`allow_paid_stars` — потолок одного сообщения).
import type { Managers } from '@/client/bootstrap'
import PaidMessagesInterceptor, { PAYMENT_REJECTED } from '@components/chat/paidMessagesInterceptor'

/** Сколько чатов получили историю. */
export async function shareStoryToChats(
  managers: Pick<Managers, 'stories'>,
  authorId: number,
  storyId: number,
  chatIds: number[],
): Promise<number> {
  let sent = 0
  for(const peerId of chatIds) {
    const confirmedPaymentResult = await PaidMessagesInterceptor.prepareStarsForPayment({ messageCount: 1, peerId })
    if(confirmedPaymentResult === PAYMENT_REJECTED) continue
    sent += await managers.stories.share(authorId, storyId, [peerId], confirmedPaymentResult)
  }
  return sent
}

package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Публикация поста в канал с обсуждением кладёт зеркало в группу: автор бабла —
// канал (send_as), атрибуция пересылки указывает на пост, тред живёт на зеркале.
func TestPostToChannel_CreatesMirror(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	_ = fg

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	mirrorID, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mirrorID == 0 {
		t.Fatal("зеркало не создано")
	}
	m, err := i.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatal(err)
	}
	if m.ChatID != disc {
		t.Fatalf("зеркало в чате %d, ожидалась группа обсуждения %d", m.ChatID, disc)
	}
	if m.SendAsChatID == nil || *m.SendAsChatID != ch {
		t.Fatalf("send_as_chat_id = %v, ожидался канал %d", m.SendAsChatID, ch)
	}
	if m.FwdFromChatID == nil || *m.FwdFromChatID != ch || m.FwdFromMsgID == nil || *m.FwdFromMsgID != post.ID {
		t.Fatalf("атрибуция пересылки неверна: %v/%v", m.FwdFromChatID, m.FwdFromMsgID)
	}
	if m.ThreadRootID != nil {
		t.Fatalf("зеркало само корень треда, thread_root_id должен быть nil, got %v", m.ThreadRootID)
	}
	if !m.IsDiscussionMirror {
		t.Fatal("флаг is_discussion_mirror не выставлен")
	}
	if m.Text != post.Text {
		t.Fatalf("текст зеркала %q, ожидался %q", m.Text, post.Text)
	}
}

// Канал без обсуждения: зеркала нет, публикация не падает.
func TestPostToChannel_NoDiscussion_NoMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatalf("публикация в канал без обсуждения упала: %v", err)
	}
	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id != 0 {
		t.Fatalf("зеркало создано без группы обсуждения: %d", id)
	}
}

// Повторный вызов хелпера на том же посте не плодит зеркал (ретрай/гонка).
func TestMirrorChannelPost_Idempotent(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")

	first, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if _, err := i.mirrorChannelPost(ctx, post); err != nil {
		t.Fatalf("повторное зеркалирование вернуло ошибку: %v", err)
	}
	second, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if second != first {
		t.Fatalf("повторный вызов создал новое зеркало: было %d, стало %d", first, second)
	}
}

// Транзиентный сбой GetDiscussion (обрыв соединения и т.п.) — не «обсуждения
// нет»: ошибка обязана дойти до вызывающего PostToChannel, а не проглотиться
// молча (иначе пост опубликуется без зеркала и без треда комментариев навсегда).
//
// ВАЖНО про то, что этот тест НЕ проверяет: fakeTx.WithinTx в этом пакете
// выполняет fn напрямую, без настоящего отката — insert поста в channelID
// в общем in-memory store уже произошёл к моменту, когда mirrorChannelPost
// возвращает ошибку, и fakeTx его не отменяет. Реальная транзакция БД
// (pgx) откатит вставку поста при возврате ошибки из WithinTx — это
// поведение не покрыто здесь фейком и проверяется на уровне
// adapter/repo/postgres. Тест ниже проверяет только то, что фейк может
// гарантировать: ошибка GetDiscussion не проглатывается и доходит до
// вызывающего PostToChannel как есть, а сам PostToChannel не возвращает
// вызывающему «успешно опубликованный» пост.
func TestPostToChannel_DiscussionLookupError_Propagates(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("db connection lost")
	fg.getDiscussionErr = wantErr

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if !errors.Is(err, wantErr) {
		t.Fatalf("PostToChannel вернул %v, ожидалась ошибка GetDiscussion %v", err, wantErr)
	}
	if post.ID != 0 {
		t.Fatalf("PostToChannel вернул непустой пост при ошибке: %+v", post)
	}
}

// Пост с медиа идёт не через PostToChannel, а через Send — зеркало обязано
// появиться и на этом пути.
func TestSendToChannel_CreatesMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}

	mediaID := int64(42)
	post, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", Text: "cap", MediaID: &mediaID})
	if err != nil {
		t.Fatal(err)
	}

	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Fatal("зеркало не создано для поста с медиа")
	}
	m, _ := i.msgs.GetByID(ctx, id)
	if m.MediaID == nil || *m.MediaID != mediaID {
		t.Fatalf("медиа не перенесено в зеркало: %v", m.MediaID)
	}
}

// Регрессия: ThreadRootID приезжает из HTTP/WS-фрейма и не валидируется на
// принадлежность чату (в отличие от ReplyToID) — тем же полем пользуются и
// форум-топики. mirrorChannelPost поэтому решает «это пост или нет» по типу
// чата-получателя, а не по ThreadRootID: обычный пост в канал с обсуждением,
// отправленный со сфабрикованным (ничему не соответствующим) thread_root_id,
// штатным API — без каких-либо ухищрений — обязан всё равно получить
// зеркало. Это одновременно и пин на мутацию: верни гейт
// `if msg.ThreadRootID == nil` в message.go — тест обязан покраснеть.
func TestSendToChannel_ArbitraryThreadRootID_StillCreatesMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}

	bogusRoot := int64(999999) // произвольный id, ничему в этом чате не соответствует
	post, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "text", Text: "hello", ThreadRootID: &bogusRoot})
	if err != nil {
		t.Fatal(err)
	}

	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Fatal("зеркало не создано для поста со сфабрикованным thread_root_id")
	}
}

// Сообщение в группе обсуждения зеркала не порождает — но НЕ потому, что у
// него выставлен ThreadRootID (mirrorChannelPost это поле больше не
// смотрит), а потому что у самой группы обсуждения нет своей привязанной
// группы обсуждения: GetDiscussion(disc) == 0, и хелпер для неё — no-op. В
// проде это дополнительно отсекается на входе по типу чата (disc — group, не
// channel); groupMembershipChats.ChatType в этом тестовом файле type-check
// не моделирует (хардкодит "channel" для любого id — см. её определение в
// channel_test.go), поэтому здесь реально проверяется именно барьер
// GetDiscussion, а не тип чата.
func TestSendComment_NoMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, _ := i.EnableDiscussion(ctx, ch, 7)
	post, _ := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	root, _ := i.msgs.MirrorByPost(ctx, ch, post.ID)

	c, err := i.Send(ctx, SendInput{ChatID: disc, SenderID: 7, Type: "text", Text: "первый", ThreadRootID: &root})
	if err != nil {
		t.Fatal(err)
	}
	if c.IsDiscussionMirror {
		t.Fatal("комментарий помечен как зеркало")
	}
}

// Пост, попавший в канал пересылкой (ForwardMessages), тоже обязан получить
// зеркало в группе обсуждения — не только прямой PostToChannel/Send.
func TestForwardMessages_ToChannelWithDiscussion_CreatesMirror(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	src, _ := i.CreateChannel(ctx, 7, "Source", "", "", true)
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	orig, err := i.PostToChannel(ctx, src, 7, "original", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	fwd, err := i.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: ch, MsgIDs: []int64{orig.ID}, SenderID: 7})
	if err != nil {
		t.Fatal(err)
	}
	if len(fwd) != 1 {
		t.Fatalf("ожидалось 1 пересланное сообщение, получено %d", len(fwd))
	}

	id, err := i.msgs.MirrorByPost(ctx, ch, fwd[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Fatal("зеркало не создано для пересланного в канал поста")
	}
}

// Одобренный предложенный пост (SuggestPost → ApproveSuggestedPost) публикуется
// в канал publishApprovedPost'ом — этот путь тоже обязан завести зеркало.
func TestApproveSuggestedPost_ToChannelWithDiscussion_CreatesMirror(t *testing.T) {
	in, fg, _, fpub, _ := newSuggestTestInteractor(t)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := in.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	_ = fg.AddMember(ctx, ch, 8, domain.RoleSubscriber, 0)
	info, err := in.SuggestPost(ctx, ch, 8, "please publish", nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	approved, err := in.ApproveSuggestedPost(ctx, info.ID, 7, nil)
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != "approved" {
		t.Fatalf("status=%q, want approved", approved.Status)
	}

	// ApproveSuggestedPost возвращает SuggestedPostInfo, а не адрес
	// опубликованного сообщения — достаём его из последнего опубликованного
	// канального кадра. Адрес там ОДИН: `id` со значением номера в канале
	// (channelPostPayload кладёт его туда же, что и PostToChannel), поэтому
	// внутренний ключ строки резолвим через слой адресации.
	postSeq, ok := fpub.lastPayload(t)["id"].(float64)
	if !ok {
		t.Fatal("адрес поста отсутствует в опубликованном кадре")
	}
	postID, err := in.msgs.IDBySeq(ctx, ch, int64(postSeq))
	if err != nil {
		t.Fatalf("номер %v не резолвится в канале: %v", postSeq, err)
	}

	id, err := in.msgs.MirrorByPost(ctx, ch, postID)
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Fatal("зеркало не создано для одобренного предложенного поста")
	}
}

// Альбом: зеркалится каждый элемент, но тред — один, на зеркале первого.
func TestAlbum_MirrorsAllElements_SingleThread(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}

	m1 := int64(101)
	m2 := int64(102)
	a1, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m1, GroupedID: 111})
	if err != nil {
		t.Fatal(err)
	}
	a2, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m2, GroupedID: 111})
	if err != nil {
		t.Fatal(err)
	}

	r1, err := i.msgs.MirrorByPost(ctx, ch, a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := i.msgs.MirrorByPost(ctx, ch, a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r1 == 0 {
		t.Fatal("зеркало первого элемента альбома не создано")
	}
	if r1 != r2 {
		t.Fatalf("у альбома два корня треда: %d и %d — ожидался один (зеркало первого элемента)", r1, r2)
	}

	// но в группе лежат ОБА элемента — альбом не должен приехать обрезанным.
	// MirrorByPost/MirrorsByPosts коллапсируют тред в корень (r1==r2 выше),
	// но у КАЖДОГО элемента альбома обязана быть СВОЯ физическая строка-
	// зеркало — иначе группа реально получит только один кадр из альбома.
	// Проверяем это через MirrorOfExactPost (без коллапса в корень) — именно
	// её использует mirrorChannelPost для идемпотентности вставки; используй
	// он здесь коллапсирующий MirrorByPost, второй элемент решил бы, что уже
	// зеркалён (через зеркало первого), и не завёл бы своей строки.
	own1, err := i.msgs.MirrorOfExactPost(ctx, ch, a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	own2, err := i.msgs.MirrorOfExactPost(ctx, ch, a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if own1 == 0 || own2 == 0 {
		t.Fatalf("у элемента альбома нет собственного зеркала: own1=%d own2=%d — альбом в группе обрезан", own1, own2)
	}
	if own1 == own2 {
		t.Fatalf("оба элемента альбома делят одну строку-зеркало (own=%d) — второй кадр альбома не попал в группу", own1)
	}
	if own1 != r1 {
		t.Fatalf("собственное зеркало первого элемента (%d) не совпадает с корнем треда (%d)", own1, r1)
	}

	root, _ := i.msgs.GetByID(ctx, r1)
	if root.GroupedID == nil || *root.GroupedID != 111 {
		t.Fatalf("зеркало потеряло grouped_id: %v", root.GroupedID)
	}
	second, _ := i.msgs.GetByID(ctx, own2)
	if second.GroupedID == nil || *second.GroupedID != 111 {
		t.Fatalf("зеркало второго элемента альбома потеряло grouped_id: %v", second.GroupedID)
	}
}

// Ленивое зеркалирование домиграционного альбома: пост опубликован ДО
// EnableDiscussion (зеркала ещё нет), и первый комментарий приходит НЕ к
// первому кадру альбома, а ко второму. Регрессия (найдена ревью): если бы
// PostComment лениво зеркалировал только переданный клиенту элемент (a2), то
// MirrorByPost(a2) после этого продолжил бы резолвиться в корень альбома —
// зеркало a1 (правило «один тред на альбом», Task 7) — которого нет и
// неоткуда взяться, и клиент получал бы ErrNotFound на валидном посте.
// Правильно: ленивая дозаводка обязана зеркалировать ВЕСЬ альбом, чтобы и
// корень (a1), и запрошенный элемент (a2) получили свои строки-зеркала, а
// комментарий приземлился на тот же корень, что и комментарий к первому кадру.
func TestPostComment_AlbumLazyMirror_NonFirstFrame_SameThread(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	// Альбом публикуется ДО включения обсуждения — mirrorChannelPost на
	// вставке был no-op (GetDiscussion возвращал 0), зеркал нет вовсе.
	m1 := int64(101)
	m2 := int64(102)
	a1, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m1, GroupedID: 111})
	if err != nil {
		t.Fatal(err)
	}
	a2, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m2, GroupedID: 111})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	if root, _ := i.msgs.MirrorByPost(ctx, ch, a1.ID); root != 0 {
		t.Fatalf("зеркало альбома уже есть до первого комментария: %d", root)
	}

	// Комментируем НЕ первый, а второй кадр — первым обращением к альбому.
	c2, err := i.PostComment(ctx, ch, a2.ID, 8, "к второму кадру", "c2")
	if err != nil {
		t.Fatalf("PostComment(a2) вернул ошибку вместо ленивой дозаводки зеркала альбома: %v", err)
	}
	c1, err := i.PostComment(ctx, ch, a1.ID, 8, "к первому кадру", "c1")
	if err != nil {
		t.Fatalf("PostComment(a1) вернул ошибку: %v", err)
	}
	if c1.ThreadRootID == nil || c2.ThreadRootID == nil {
		t.Fatalf("у комментария нет thread_root_id: c1=%v c2=%v", c1.ThreadRootID, c2.ThreadRootID)
	}
	if *c1.ThreadRootID != *c2.ThreadRootID {
		t.Fatalf("комментарии к разным кадрам одного альбома легли в разные треды: %d и %d", *c1.ThreadRootID, *c2.ThreadRootID)
	}
}

// Та же ленивая дозаводка (комментарий приходит ко ВТОРОМУ кадру
// домиграционного альбома первым), но проверяется отсутствие «осиротевших»
// зеркал: резолв по КАЖДОМУ элементу альбома обязан давать один и тот же
// корень, и у каждого элемента обязана быть собственная физическая
// строка-зеркало (иначе альбом в группе обсуждения приезжает обрезанным).
func TestPostComment_AlbumLazyMirror_NoOrphanedMirrors(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	m1 := int64(101)
	m2 := int64(102)
	a1, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m1, GroupedID: 111})
	if err != nil {
		t.Fatal(err)
	}
	a2, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "photo", MediaID: &m2, GroupedID: 111})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}

	// Единственное обращение к альбому — комментарий ко ВТОРОМУ элементу.
	if _, err := i.PostComment(ctx, ch, a2.ID, 8, "hi", ""); err != nil {
		t.Fatalf("PostComment(a2): %v", err)
	}

	r1, err := i.msgs.MirrorByPost(ctx, ch, a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := i.msgs.MirrorByPost(ctx, ch, a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r1 == 0 || r1 != r2 {
		t.Fatalf("резолв разошёлся после ленивого зеркалирования: MirrorByPost(a1)=%d MirrorByPost(a2)=%d", r1, r2)
	}

	own1, err := i.msgs.MirrorOfExactPost(ctx, ch, a1.ID)
	if err != nil {
		t.Fatal(err)
	}
	own2, err := i.msgs.MirrorOfExactPost(ctx, ch, a2.ID)
	if err != nil {
		t.Fatal(err)
	}
	if own1 == 0 {
		t.Fatal("первый элемент альбома не дозеркалирован — корень треда указывает в никуда")
	}
	if own2 == 0 {
		t.Fatal("второй элемент альбома не дозеркалирован — альбом в группе обсуждения обрезан")
	}
}

// Блокер 3 (финальное ревью 2026-08-14): зеркало поста канала должно
// доставляться участникам группы обсуждения ТЕМ ЖЕ путём, что и обычное
// сообщение группы (спека, раздел «Создание»: «доставка зеркала переиспользует
// обычный путь группового сообщения — тот же веер по MemberIDs, что у Send»).
// Раньше mirrorChannelPost делал только NextSeq+Insert — зеркало оседало в
// БД, но не попадало ни в pts-лог получателя (значит, не появилось бы и в
// /sync), ни в realtime WS-кадр.
//
// Проверяем ТЕМ ЖЕ механизмом, каким в пакете уже проверяется доставка
// обычных сообщений (см. TestPostComment_WSFrame_ThreadRootMatchesPost) —
// groupMembershipChatsFanout + fakeUpdates + fakePublisher: единственная в
// пакете комбинация фейков, где Send()/фан-аут реально работают per-member
// (обычный стаб groupMembershipChats.MemberIDs всегда nil).
func TestPostToChannel_MirrorDeliveredToDiscussionGroupMembers(t *testing.T) {
	s := newStore()
	fg := newFakeGroupRepo()
	fch := newFakeChannelRepo()
	fs := newFakeSearchRepo()
	i := New(fakeTx{}, groupMembershipChatsFanout{groupMembershipChats{fg, s}}, fakeMsgs{s},
		fakeUpdates{s}, nil, fakeMedia{s}, fg, nil, fch, fs, nil)
	i.SetChannelPublisher(&fakeChannelPublisher{})
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "channel"
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fg.onSetDiscussion = s.seedDiscussion
	pub := &fakePublisher{}
	i.SetPublisher(pub)

	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	disc, err := i.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	// Подписчик группы обсуждения — НЕ автор поста (7 — creator и автор).
	if err := fg.AddMember(ctx, disc, 8, domain.RoleMember, 0); err != nil {
		t.Fatal(err)
	}

	post, err := i.PostToChannel(ctx, ch, 7, "hello", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	mirrorID, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mirrorID == 0 {
		t.Fatal("зеркало не создано")
	}

	// pts-лог участника группы обязан вырасти — иначе зеркала не будет в /sync
	// (см. UpdateRepo.AppendUpdateBulk/GetUserState/UpdatesSince).
	s.mu.Lock()
	updates := append([]domain.Update(nil), s.updates[8]...)
	s.mu.Unlock()
	// Кадр адресует зеркало НОМЕРОМ в группе обсуждения — внутренний ключ
	// строки наружу не выходит.
	mirror, err := i.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatalf("зеркало %d не читается: %v", mirrorID, err)
	}
	foundUpdate := false
	for _, u := range updates {
		if u.Type != "new_message" {
			continue
		}
		var d struct {
			ID int64 `json:"id"`
		}
		if err := json.Unmarshal(u.Payload, &d); err == nil && d.ID == mirror.Seq {
			foundUpdate = true
		}
	}
	if !foundUpdate {
		t.Fatalf("участник группы обсуждения (8) не получил зеркало %d в pts-лог: %+v", mirrorID, updates)
	}

	// realtime WS-кадр — штатным механизмом (fakePublisher), как и обычное
	// сообщение группы.
	var env struct {
		T string `json:"t"`
		D struct {
			ID int64 `json:"id"`
		} `json:"d"`
	}
	found := false
	for _, f := range pub.frames {
		if f.userID != 8 {
			continue
		}
		if err := json.Unmarshal(f.frame, &env); err != nil {
			t.Fatalf("frame decode: %v", err)
		}
		if env.T == "new_message" && env.D.ID == mirror.Seq {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("участник группы обсуждения (8) не получил зеркало %d штатным путём доставки (WS-кадр)", mirrorID)
	}
}

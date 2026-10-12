package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф-5 п. 3 (A3-32): черновик на пару «пир + тред» (tweb appDraftsManager.ts:
// 88-90). Тред едет в reply_to так, как его туда кладёт tweb (:296-303): без
// ответа reply_to_msg_id = тред, с ответом top_msg_id = тред.

func draftForum(t *testing.T) (*Interactor, *fakeDrafts, *fakePublisher, int64, domain.Message, domain.Message) {
	t.Helper()
	in, _, pub, id, rootA := readDiscussionForum(t)
	ctx := context.Background()
	_, rootB, err := in.CreateTopic(ctx, id, 7, "Тема B", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	pub.reset()
	return in, drafts, pub, id, rootA, rootB
}

func i64(v int64) *int64 { return &v }

func TestDraft_ForumTopicKeys(t *testing.T) {
	in, drafts, pub, id, rootA, rootB := draftForum(t)
	ctx := context.Background()
	x, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в теме A", ThreadRootID: &rootA.ID})
	if err != nil {
		t.Fatal(err)
	}

	// reply_to_msg_id = корень темы A без top_msg_id — черновик темы A без ответа.
	d, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "A", ReplyToMsgID: i64(rootA.Seq)})
	if err != nil || d.ThreadRootID != rootA.ID || d.ReplyToID != nil || d.TopMsgID != rootA.Seq {
		t.Fatalf("черновик темы A: %+v, %v", d, err)
	}
	f := lastFrameOfType(t, pub, 7, "draft_update")
	if f["top_msg_id"] != float64(rootA.Seq) {
		t.Fatalf("кадр черновика темы A: %v", f)
	}
	if dr, _ := f["draft"].(map[string]any); dr["reply_to"] != nil {
		t.Fatalf("у черновика без ответа приехал reply_to: %v", dr)
	}
	assertEncodesAsTL(t, f)

	// {reply_to_msg_id: X, top_msg_id: B} — тема B с ответом X; reply_to несёт
	// top_msg_id треда (tweb input.ts:2290-2294).
	d, err = in.SaveDraft(ctx, 7, id, DraftInput{Message: "B", ReplyToMsgID: i64(x.Seq), TopMsgID: i64(rootB.Seq)})
	if err != nil || d.ThreadRootID != rootB.ID || d.ReplyToID == nil || *d.ReplyToID != x.Seq {
		t.Fatalf("черновик темы B с ответом: %+v, %v", d, err)
	}
	f = lastFrameOfType(t, pub, 7, "draft_update")
	reply, _ := f["draft"].(map[string]any)["reply_to"].(map[string]any)
	if f["top_msg_id"] != float64(rootB.Seq) || reply["reply_to_msg_id"] != float64(x.Seq) || reply["top_msg_id"] != float64(rootB.Seq) {
		t.Fatalf("кадр черновика темы B: %v", f)
	}
	assertEncodesAsTL(t, f)

	// General — номер 1: ключ 0, наружу top_msg_id = 1.
	if d, err = in.SaveDraft(ctx, 7, id, DraftInput{Message: "G", ReplyToMsgID: i64(domain.GeneralTopicID)}); err != nil || d.ThreadRootID != 0 || d.TopMsgID != domain.GeneralTopicID || d.ReplyToID != nil {
		t.Fatalf("черновик General: %+v, %v", d, err)
	}
	if list, _ := in.MyDrafts(ctx, 7); len(list) != 3 {
		t.Fatalf("три черновика одного чата: %+v", list)
	}

	// Отправка в тему A снимает только черновик A; кадр — с ключом треда.
	pub.reset()
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "ответ", ThreadRootID: &rootA.ID}); err != nil {
		t.Fatal(err)
	}
	if _, ok := drafts.m[[3]int64{id, 7, rootA.ID}]; ok {
		t.Fatal("отправка в тему A не сняла её черновик")
	}
	if _, ok := drafts.m[[3]int64{id, 7, rootB.ID}]; !ok {
		t.Fatal("отправка в тему A сняла черновик темы B")
	}
	if _, ok := drafts.m[[3]int64{id, 7, 0}]; !ok {
		t.Fatal("отправка в тему A сняла черновик General")
	}
	f = lastFrameOfType(t, pub, 7, "draft_update")
	if f["top_msg_id"] != float64(rootA.Seq) || f["draft"].(map[string]any)["_"] != domain.DraftMessageEmptyTag {
		t.Fatalf("кадр снятия черновика темы A: %v", f)
	}
	if framesOfType(pub, 7, "draft_update") != 1 {
		t.Fatal("лишние кадры черновика")
	}

	// Отправка в General снимает черновик General.
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "общее"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := drafts.m[[3]int64{id, 7, 0}]; ok {
		t.Fatal("отправка в General не сняла её черновик")
	}
	if f = lastFrameOfType(t, pub, 7, "draft_update"); f["top_msg_id"] != float64(domain.GeneralTopicID) {
		t.Fatalf("кадр снятия General: %v", f)
	}

	// Пустой текст с адресом треда — снятие черновика B (tweb шлёт
	// draftMessageEmpty + reply_to треда, appDraftsManager.ts:228-243, 296-303).
	if d, err := in.SaveDraft(ctx, 7, id, DraftInput{ReplyToMsgID: i64(rootB.Seq)}); err != nil || d != nil {
		t.Fatalf("снятие черновика B: %+v, %v", d, err)
	}
	if len(drafts.m) != 0 {
		t.Fatalf("остались черновики: %+v", drafts.m)
	}
}

// В форуме тред не темы — TOPIC_ID_INVALID (как отправка); не участник — нет.
func TestDraft_ForumErrors(t *testing.T) {
	in, _, _, id, rootA, _ := draftForum(t)
	ctx := context.Background()
	plain, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в General"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "ещё в General"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "x", ReplyToMsgID: i64(other.Seq), TopMsgID: i64(plain.Seq)}); !errors.Is(err, domain.ErrTopicIDInvalid) {
		t.Fatalf("тред не темы = %v, ждали ErrTopicIDInvalid", err)
	}
	// Ответ на сообщение General без top_msg_id — черновик General с ответом.
	d, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "x", ReplyToMsgID: i64(plain.Seq)})
	if err != nil || d.ThreadRootID != 0 || d.TopMsgID != domain.GeneralTopicID || d.ReplyToID == nil {
		t.Fatalf("ответ в General: %+v, %v", d, err)
	}
	if _, err := in.SaveDraft(ctx, 999, id, DraftInput{Message: "x", ReplyToMsgID: i64(rootA.Seq)}); err == nil {
		t.Fatal("не участник сохранил черновик темы")
	}
	if _, err := in.SaveDraft(ctx, 999, id, DraftInput{Message: "x"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("не участник, черновик General = %v", err)
	}
}

// forumTopic.draft — черновик темы в строке списка (tweb dialogs.ts:1693-1697).
func TestDraft_TopicRowAndDialog(t *testing.T) {
	in, _, _, id, rootA, _ := draftForum(t)
	ctx := context.Background()
	if _, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "A", ReplyToMsgID: i64(rootA.Seq)}); err != nil {
		t.Fatal(err)
	}
	if _, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "G", ReplyToMsgID: i64(domain.GeneralTopicID)}); err != nil {
		t.Fatal(err)
	}
	page, err := in.TopicsPage(ctx, id, 7)
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]string{}
	for _, r := range page.Topics {
		if r.Draft != nil {
			got[r.Topic.Number()] = r.Draft.Text
		}
	}
	if got[rootA.Seq] != "A" || got[domain.GeneralTopicID] != "G" || len(got) != 2 {
		t.Fatalf("черновики тем: %v", got)
	}
	// Чужому — своих черновиков нет.
	page, _ = in.TopicsPage(ctx, id, 8)
	for _, r := range page.Topics {
		if r.Draft != nil {
			t.Fatalf("черновик Алисы у Боба: %+v", r)
		}
	}
}

// Тред комментариев: черновик по reply_to = зеркало (В-7), и у гостя — не
// участника группы обсуждения (как readDiscussion). Отправка комментария
// снимает только его.
func TestDraft_CommentThread(t *testing.T) {
	in, _, _, _ := newChannelTestInteractor(t)
	in.updates = fakeUpdates{newStore()} // кадр черновика — через журнал
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	gid, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "пост", nil, "p1")
	if err != nil {
		t.Fatal(err)
	}
	mirrorID, err := in.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	mirror, err := in.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatal(err)
	}

	d, err := in.SaveDraft(ctx, 8, gid, DraftInput{Message: "коммент", ReplyToMsgID: i64(mirror.Seq)})
	if err != nil || d.ThreadRootID != mirrorID || d.TopMsgID != mirror.Seq || d.ReplyToID != nil {
		t.Fatalf("черновик треда комментариев у гостя: %+v, %v", d, err)
	}
	if f := lastFrameOfType(t, pub, 8, "draft_update"); f["top_msg_id"] != float64(mirror.Seq) {
		t.Fatalf("кадр черновика треда: %v", f)
	}
	// Черновика самой группы гостю не завести.
	if _, err := in.SaveDraft(ctx, 8, gid, DraftInput{Message: "в группу"}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("гость, черновик группы = %v", err)
	}

	if _, err := in.PostComment(ctx, ch, post.ID, 8, "отправил", "c1"); err != nil {
		t.Fatal(err)
	}
	if len(drafts.m) != 0 {
		t.Fatalf("комментарий не снял черновик треда: %+v", drafts.m)
	}
	if f := lastFrameOfType(t, pub, 8, "draft_update"); f["top_msg_id"] != float64(mirror.Seq) ||
		f["draft"].(map[string]any)["_"] != domain.DraftMessageEmptyTag {
		t.Fatalf("кадр снятия черновика треда: %v", f)
	}
}

// Удалить все черновики — кадр на каждый тред, с его top_msg_id.
func TestDraft_ClearAllPerThread(t *testing.T) {
	in, _, pub, id, rootA, _ := draftForum(t)
	ctx := context.Background()
	if _, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "A", ReplyToMsgID: i64(rootA.Seq)}); err != nil {
		t.Fatal(err)
	}
	if _, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "G"}); err != nil {
		t.Fatal(err)
	}
	pub.reset()
	if err := in.ClearAllDrafts(ctx, 7); err != nil {
		t.Fatal(err)
	}
	tops := map[float64]bool{}
	for _, f := range draftFramesFor(pub, 7) {
		tops[f["top_msg_id"].(float64)] = true
	}
	if len(tops) != 2 || !tops[float64(rootA.Seq)] || !tops[float64(domain.GeneralTopicID)] {
		t.Fatalf("кадры снятия: %v", tops)
	}
}

// Диалогу — только черновик ЧАТА: черновик треда (и General форума, у него
// TopMsgID = 1) живёт под ключом треда (tweb dialogs.ts:1693-1697).
func TestDraft_DialogCarriesOnlyChatDraft(t *testing.T) {
	in, _ := newInteractor()
	in.SetPublisher(&fakePublisher{})
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	ctx := context.Background()
	chatID, _ := in.CreatePrivateChat(ctx, 1, 2)
	if _, err := drafts.Upsert(ctx, 1, domain.Draft{ChatID: chatID, ThreadRootID: 99, TopMsgID: 5, Text: "в треде"}); err != nil {
		t.Fatal(err)
	}
	page, err := in.DialogsPage(ctx, 1, domain.DialogPage{Limit: 20})
	if err != nil || len(page.Dialogs) != 1 {
		t.Fatalf("DialogsPage: %+v, %v", page.Dialogs, err)
	}
	if row := page.Dialogs[0].(domain.DialogReal); row.Draft != nil {
		t.Fatalf("черновик треда приехал диалогу: %+v", row.Draft)
	}
}

// Тред обычной группы (не форум, корень не зеркало): ключ треда даёт только
// правило 1 (ответ + top_msg_id), форма {R, top: R} — адрес треда, правило
// 2/3. Что сохранено, то снимает отправка в тот же тред (sentDraftThread).
func TestDraft_PlainGroupThreadConsistent(t *testing.T) {
	in, _, _, id := gateGroup(t)
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	ctx := context.Background()
	root, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "корень"})
	if err != nil {
		t.Fatal(err)
	}
	x, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "в треде", ThreadRootID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}

	// Ответ X в треде R — ключ R.
	d, err := in.SaveDraft(ctx, 7, id, DraftInput{Message: "ответ", ReplyToMsgID: i64(x.Seq), TopMsgID: i64(root.Seq)})
	if err != nil || d.ThreadRootID != root.ID || d.TopMsgID != root.Seq || d.ReplyToID == nil {
		t.Fatalf("правило 1 в обычной группе: %+v, %v", d, err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "ответил", ThreadRootID: &root.ID, ReplyToID: i64(x.Seq)}); err != nil {
		t.Fatal(err)
	}
	if len(drafts.m) != 0 {
		t.Fatalf("ответ в треде не снял черновик треда: %+v", drafts.m)
	}

	// {R, top: R} — адрес треда, не ответ на корень: в обычной группе это
	// черновик чата с ответом R, и его снимает отправка в тред без ответа.
	d, err = in.SaveDraft(ctx, 7, id, DraftInput{Message: "в тред", ReplyToMsgID: i64(root.Seq), TopMsgID: i64(root.Seq)})
	if err != nil || d.ThreadRootID != 0 || d.TopMsgID != 0 {
		t.Fatalf("{R, top: R}: %+v, %v", d, err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "в тред", ThreadRootID: &root.ID}); err != nil {
		t.Fatal(err)
	}
	if len(drafts.m) != 0 {
		t.Fatalf("отправка в тред не сняла черновик {R, top: R}: %+v", drafts.m)
	}
}

// Ответ на зеркало в ленте группы обсуждения (без треда) снимает черновик
// треда комментариев: правило 2 кладёт его на ключ зеркала (В-7).
func TestDraft_ReplyToMirrorClearsCommentDraft(t *testing.T) {
	in, _, _, _ := newChannelTestInteractor(t)
	in.updates = fakeUpdates{newStore()}
	drafts := newFakeDrafts()
	in.SetDrafts(drafts)
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	gid, err := in.EnableDiscussion(ctx, ch, 7)
	if err != nil {
		t.Fatal(err)
	}
	post, err := in.PostToChannel(ctx, ch, 7, "пост", nil, "p1")
	if err != nil {
		t.Fatal(err)
	}
	mirrorID, _ := in.msgs.MirrorByPost(ctx, ch, post.ID)
	mirror, err := in.msgs.GetByID(ctx, mirrorID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.SaveDraft(ctx, 7, gid, DraftInput{Message: "к посту", ReplyToMsgID: i64(mirror.Seq)}); err != nil {
		t.Fatal(err)
	}
	// Веер фикстуры канала участникам группы пуст (снятие черновика после
	// отправки зовётся из доставки), поэтому — тот же вызов напрямую.
	in.clearDraftAfterSend(ctx, 7, gid, nil, i64(mirror.Seq))
	if len(drafts.m) != 0 {
		t.Fatalf("ответ на зеркало не снял черновик треда: %+v", drafts.m)
	}
}

// Ф-5 БЭК-2b: черновик хранит решение о превью ссылки (tweb
// appDraftsManager.ts:281-291) и отдаёт его в кадре 1:1 — tweb сравнивает
// черновики целиком (draftsAreEqual). media — только inputMediaWebPage.
func TestDraft_KeepsWebPageChoice(t *testing.T) {
	in, _ := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	in.SetDrafts(newFakeDrafts())
	ctx := context.Background()
	chatID, _ := in.CreatePrivateChat(ctx, 1, 2)

	wp := domain.WebPageInput{NoWebpage: true, InvertMedia: true, Media: &domain.InputMediaWebPage{
		Underscore: domain.InputMediaWebPageTag, URL: "https://example.com/a",
		PFlags: map[string]bool{"force_large_media": true, "optional": true}}}
	if _, err := in.SaveDraft(ctx, 1, chatID, DraftInput{Message: "смотри https://example.com/a", WebPage: wp}); err != nil {
		t.Fatal(err)
	}
	f := lastFrameOfType(t, pub, 1, "draft_update")
	d, _ := f["draft"].(map[string]any)
	pf, _ := d["pFlags"].(map[string]any)
	media, _ := d["media"].(map[string]any)
	mpf, _ := media["pFlags"].(map[string]any)
	if pf["no_webpage"] != true || pf["invert_media"] != true || media["_"] != domain.InputMediaWebPageTag ||
		media["url"] != "https://example.com/a" || mpf["force_large_media"] != true || mpf["optional"] != true {
		t.Fatalf("черновик в кадре = %v", d)
	}
	assertEncodesAsTL(t, f)
	list, _ := in.MyDrafts(ctx, 1)
	if len(list) != 1 || !list[0].WebPage.NoWebpage || list[0].WebPage.Media == nil {
		t.Fatalf("getAllDrafts без решения о превью: %+v", list)
	}

	// Решение снято — флагов и media нет; чужое media не сохраняется.
	if _, err := in.SaveDraft(ctx, 1, chatID, DraftInput{Message: "без превью", WebPage: domain.WebPageInput{
		Media: &domain.InputMediaWebPage{Underscore: "inputMediaPhoto", URL: "https://example.com"}}}); err != nil {
		t.Fatal(err)
	}
	d, _ = lastFrameOfType(t, pub, 1, "draft_update")["draft"].(map[string]any)
	if d["pFlags"] != nil || d["media"] != nil {
		t.Fatalf("снятое решение о превью осталось: %v", d)
	}

	// Пустой текст без ответа снимает черновик и с media (tweb isEmptyDraft).
	if got, err := in.SaveDraft(ctx, 1, chatID, DraftInput{WebPage: wp}); err != nil || got != nil {
		t.Fatalf("пустой черновик с media: %+v, %v", got, err)
	}
}

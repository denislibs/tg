package story

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

const (
	alice = int64(1)
	bob   = int64(2)
	carol = int64(3)
)

// twoAuthorsRepo — у Алисы и Боба по истории с одинаковым номером 1, но разными
// внутренними ключами (VA2-01: правилась не та своя история).
func twoAuthorsRepo() *fakeRepo {
	repo := &fakeRepo{
		visible:  true,
		idByPair: map[[2]int64]int64{{alice, 1}: 10, {bob, 1}: 20},
		authors:  map[int64]int64{10: alice, 20: bob},
	}
	seedStory(repo, 10, func(r *domain.StoryRecord) { r.Seq = 1 })
	seedStory(repo, 20, func(r *domain.StoryRecord) { r.Seq = 1 })
	return repo
}

// VA2-01: закрепление и правка адресуют историю парой «автор + номер». Номер 1
// у Алисы — это её история, а не строка с внутренним ключом 1 (чужая).
func TestSetPinned_BySeqOfOwnAuthor(t *testing.T) {
	repo := twoAuthorsRepo()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.SetPinned(context.Background(), alice, 1, alice, true); err != nil {
		t.Fatal(err)
	}
	if repo.pinnedID != 10 {
		t.Fatalf("закреплена история с ключом %d; want 10 (номер 1 у Алисы)", repo.pinnedID)
	}
}

func TestSetPinned_UnknownSeqIsNotFound(t *testing.T) {
	repo := twoAuthorsRepo()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.SetPinned(context.Background(), alice, 7, alice, true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v; want ErrNotFound", err)
	}
	if repo.pinnedCalled {
		t.Fatal("закреп записан для несуществующего номера")
	}
}

// Закреп своей истории — апдейт автору (его другие устройства), не аудитории.
func TestSetPinned_JournalsOwnerBodyToAuthorOnly(t *testing.T) {
	repo := twoAuthorsRepo()
	repo.byID[10] = domain.StoryRecord{ID: 10, Seq: 1, MediaID: 7, Privacy: "contacts", Pinned: true, ViewsCount: 2}
	svc := New(repo, &fakePartners{ids: []int64{bob, carol}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	if err := svc.SetPinned(context.Background(), alice, 1, alice, true); err != nil {
		t.Fatal(err)
	}
	rows := rowsOf(log, alice, "story_update")
	if len(rows) != 1 {
		t.Fatalf("у автора %d строк story_update; want 1", len(rows))
	}
	if len(log.rows[bob])+len(log.rows[carol]) != 0 {
		t.Fatal("закреп в профиле разослан аудитории")
	}
	views, _ := storyOf(t, rows[0])["views"].(map[string]any)
	if views == nil || views["views_count"] != float64(2) {
		t.Fatalf("тело автору без счёта просмотров: %v", storyOf(t, rows[0]))
	}
}

func TestSetPinned_PathAuthorMustBeActor(t *testing.T) {
	repo := twoAuthorsRepo()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.SetPinned(context.Background(), bob, 1, alice, true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("err = %v; want ErrForbidden", err)
	}
	if repo.pinnedCalled {
		t.Fatal("чужая история закреплена")
	}
}

// Правка: видящие получают updateStory с новой подписью строкой журнала, автор
// — тоже (его другие устройства), не видящий — ничего.
func TestEditStory_JournalsToAudienceAndAuthor(t *testing.T) {
	repo := twoAuthorsRepo()
	repo.byID[10] = domain.StoryRecord{ID: 10, Seq: 1, MediaID: 7, Caption: "new", Privacy: "selected", Edited: true}
	repo.allowIDsByStory = map[int64][]int64{10: {bob}}
	repo.visibleAmong = map[int64]bool{alice: true, bob: true}
	svc := New(repo, &fakePartners{ids: []int64{carol}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	caption := "new"
	item, err := svc.EditStory(context.Background(), alice, 1, alice, &caption, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if item.ID != 1 || item.Caption != "new" {
		t.Fatalf("ответ правки = %+v; want номер 1 и новая подпись", item)
	}
	if len(rowsOf(log, bob, "story_update")) != 1 {
		t.Fatalf("видящий Боб не получил updateStory: %v", log.rows[bob])
	}
	if len(rowsOf(log, alice, "story_update")) != 1 {
		t.Fatalf("автор не получил updateStory: %v", log.rows[alice])
	}
	if len(log.rows[carol]) != 0 {
		t.Fatal("не видящая история получила апдейт")
	}
	// Автору — тело с аудиторией; видящему — без неё.
	if _, ok := storyOf(t, rowsOf(log, alice, "story_update")[0])["privacy"]; !ok {
		t.Error("в теле автору нет privacy")
	}
	if _, ok := storyOf(t, rowsOf(log, bob, "story_update")[0])["privacy"]; ok {
		t.Error("аудитория утекла видящему")
	}
}

func TestEditStory_PathAuthorMustBeActor(t *testing.T) {
	repo := twoAuthorsRepo()
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	cap := "x"
	if _, err := svc.EditStory(context.Background(), bob, 1, alice, &cap, nil, nil, nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("err = %v; want ErrForbidden", err)
	}
	if repo.editCalled {
		t.Fatal("чужая история отредактирована")
	}
}

// Общее тело не несёт пер-зрительских частей — в том числе отметки «моя» в
// чипах реакций: автор мог сам поставить реакцию, и видящему она не «его».
func TestPublish_SharedBodyHasNoChosenReaction(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	seedStory(repo, 42, func(r *domain.StoryRecord) {
		r.ReactionsCount = 1
		r.MyReaction = "👍"
		r.Reactions = []domain.ReactionCount{{Emoji: "👍", Count: 1, Mine: true}}
		r.ViewsCount = 5
	})
	svc := New(repo, &fakePartners{ids: []int64{bob}}, &fakeMedia{owner: alice}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	if _, err := svc.Post(context.Background(), alice, 7, "hi", "contacts", nil, nil, 0); err != nil {
		t.Fatal(err)
	}
	shared := storyOf(t, rowsOf(log, bob, "story_update")[0])
	views, _ := shared["views"].(map[string]any)
	if views == nil {
		t.Fatalf("агрегат реакций пропал: %v", shared)
	}
	if views["views_count"] != nil && views["views_count"] != float64(0) {
		t.Errorf("счёт просмотров ушёл не автору: %v", views["views_count"])
	}
	chips, _ := views["reactions"].([]any)
	if len(chips) != 1 {
		t.Fatalf("чипы реакций: %v", views["reactions"])
	}
	if _, chosen := chips[0].(map[string]any)["chosen_order"]; chosen {
		t.Error("реакция автора помечена выбранной у видящего")
	}
	if _, mine := shared["sent_reaction"]; mine {
		t.Error("sent_reaction автора ушла видящему")
	}
	// У автора — его счёт и его реакция.
	own := storyOf(t, rowsOf(log, alice, "story_update")[0])
	ownViews, _ := own["views"].(map[string]any)
	if ownViews == nil || ownViews["views_count"] != float64(5) {
		t.Errorf("автору не доехал счёт просмотров: %v", own)
	}
}

// Удаление: маркер получают только те, кто историю видел (приватность «близкие»),
// и автор. Аудитория собирается ДО удаления — после него строки уже нет.
func TestDelete_MarkerOnlyToAudience(t *testing.T) {
	repo := &fakeRepo{
		idByPair:     map[[2]int64]int64{{alice, 5}: 50},
		authors:      map[int64]int64{50: alice},
		origin:       domain.StoryOrigin{AuthorID: alice, Privacy: "close"},
		closeFriends: []int64{bob},
		visibleAmong: map[int64]bool{alice: true, bob: true},
	}
	svc := New(repo, &fakePartners{ids: []int64{bob, carol}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	if err := svc.Delete(context.Background(), alice, 5, alice); err != nil {
		t.Fatal(err)
	}
	if repo.deletedID != 50 {
		t.Fatalf("удалена история %d; want 50", repo.deletedID)
	}
	for _, uid := range []int64{alice, bob} {
		rows := rowsOf(log, uid, "story_update")
		if len(rows) != 1 {
			t.Fatalf("у %d %d маркеров; want 1", uid, len(rows))
		}
		st := storyOf(t, rows[0])
		if st["_"] != domain.StoryItemDeletedTag || st["id"] != float64(5) {
			t.Fatalf("тело маркера = %v; want storyItemDeleted id=5", st)
		}
	}
	if len(log.rows[carol]) != 0 {
		t.Fatal("маркер ушёл тому, кто историю не видел")
	}
}

// Автор есть и среди партнёров, и среди получателей: строка у него одна.
func TestDelete_AuthorAmongPartnersGetsOneRow(t *testing.T) {
	repo := &fakeRepo{
		idByPair: map[[2]int64]int64{{alice, 5}: 50},
		authors:  map[int64]int64{50: alice},
		origin:   domain.StoryOrigin{AuthorID: alice, Privacy: "contacts"},
	}
	svc := New(repo, &fakePartners{ids: []int64{alice, bob}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	if err := svc.Delete(context.Background(), alice, 5, alice); err != nil {
		t.Fatal(err)
	}
	if n := len(rowsOf(log, alice, "story_update")); n != 1 {
		t.Fatalf("у автора %d строк; want 1", n)
	}
}

func TestDelete_PathAuthorMustBeActor(t *testing.T) {
	repo := &fakeRepo{idByPair: map[[2]int64]int64{{bob, 1}: 20}, authors: map[int64]int64{20: bob}}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	if err := svc.Delete(context.Background(), bob, 1, alice); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("err = %v; want ErrForbidden", err)
	}
	if repo.deleted {
		t.Fatal("чужая история удалена")
	}
}

// Реакция зрителя доходит до его второго устройства телом `updateStory` под
// него (tweb: `storyItem.sent_reaction` + пометка `chosen_order` в чипах), под
// НОМЕРОМ истории у автора, и лежит в журнале — значит и в getDifference. Автору
// же — общее тело без личного.
func TestSetReaction_ViewerGetsOwnBodyInJournal(t *testing.T) {
	repo := &fakeRepo{visible: true, idByPair: map[[2]int64]int64{{alice, 5}: 900}, authors: map[int64]int64{900: alice}}
	seedStory(repo, 900, func(r *domain.StoryRecord) {
		r.Seq = 5
		r.ReactionsCount = 1
		r.Reactions = []domain.ReactionCount{{Emoji: "👍", Count: 1}}
	})
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	if err := svc.SetReaction(context.Background(), alice, 5, bob, "👍"); err != nil {
		t.Fatal(err)
	}
	rows := rowsOf(log, bob, "story_update")
	if len(rows) != 1 {
		t.Fatalf("строк story_update у зрителя: %d", len(rows))
	}
	st := storyOf(t, rows[0])
	if st["id"] != float64(5) {
		t.Fatalf("id = %v; want номер 5, а не ключ 900", st["id"])
	}
	sent, _ := st["sent_reaction"].(map[string]any)
	if sent == nil || sent["emoticon"] != "👍" {
		t.Fatalf("в теле зрителю нет sent_reaction: %v", st)
	}
	chips, _ := st["views"].(map[string]any)["reactions"].([]any)
	if len(chips) != 1 {
		t.Fatalf("чипы: %v", st["views"])
	}
	if _, chosen := chips[0].(map[string]any)["chosen_order"]; !chosen {
		t.Errorf("чип своей реакции не помечен chosen_order: %v", chips[0])
	}
	// Снял реакцию: тело без личного — клиент ЗАМЕНЯЕТ историю целиком.
	repo.byID[900] = domain.StoryRecord{ID: 900, Seq: 5, MediaID: 7, Privacy: "contacts"}
	if err := svc.RemoveReaction(context.Background(), alice, 5, bob); err != nil {
		t.Fatal(err)
	}
	rows = rowsOf(log, bob, "story_update")
	if len(rows) != 2 {
		t.Fatalf("после снятия строк: %d; want 2", len(rows))
	}
	if _, left := storyOf(t, rows[1])["sent_reaction"]; left {
		t.Error("после снятия в теле осталась sent_reaction")
	}
}

// Правка автора заменяет историю у зрителей целиком, поэтому реагировавший
// получает тело С СВОЕЙ реакцией, остальные — общее.
func TestEditStory_ReactorKeepsOwnReactionInBody(t *testing.T) {
	repo := twoAuthorsRepo()
	repo.byID[10] = domain.StoryRecord{ID: 10, Seq: 1, MediaID: 7, Caption: "new", Privacy: "contacts", ReactionsCount: 1,
		Reactions: []domain.ReactionCount{{Emoji: "❤", Count: 1, Mine: true}}}
	repo.reactors = map[int64]map[int64]string{10: {bob: "❤"}}
	svc := New(repo, &fakePartners{ids: []int64{bob, carol}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	caption := "new"
	if _, err := svc.EditStory(context.Background(), alice, 1, alice, &caption, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	bobBody := storyOf(t, rowsOf(log, bob, "story_update")[0])
	if s, _ := bobBody["sent_reaction"].(map[string]any); s == nil || s["emoticon"] != "❤" {
		t.Fatalf("реагировавший Боб потерял свою реакцию: %v", bobBody)
	}
	carolBody := storyOf(t, rowsOf(log, carol, "story_update")[0])
	if _, has := carolBody["sent_reaction"]; has {
		t.Fatalf("Кэрол получила чужую реакцию: %v", carolBody)
	}
	chips, _ := carolBody["views"].(map[string]any)["reactions"].([]any)
	if _, chosen := chips[0].(map[string]any)["chosen_order"]; chosen {
		t.Error("у Кэрол чужая реакция помечена chosen_order")
	}
}

// Прочитанность: строка журнала только когда горизонт сдвинулся.
func TestView_JournalsReadHorizonOnlyWhenMoved(t *testing.T) {
	repo := &fakeRepo{visible: true}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	if err := svc.View(context.Background(), alice, 3, bob); err != nil {
		t.Fatal(err)
	}
	rows := rowsOf(log, bob, "story_read")
	if len(rows) != 1 || rows[0].body(t)["max_id"] != float64(3) {
		t.Fatalf("строки story_read: %v", log.rows[bob])
	}
	if err := svc.View(context.Background(), alice, 3, bob); err != nil { // повтор
		t.Fatal(err)
	}
	if err := svc.View(context.Background(), alice, 2, bob); err != nil { // старее горизонта
		t.Fatal(err)
	}
	if n := len(rowsOf(log, bob, "story_read")); n != 1 {
		t.Fatalf("повторный просмотр дописал строку: %d", n)
	}
}

// Офлайн-получатель: журнал пишется и без живого издателя (нет Redis), поэтому
// getDifference найдёт историю после входа.
func TestPost_JournalsWithoutPublisher(t *testing.T) {
	repo := &fakeRepo{createID: 42}
	seedStory(repo, 42)
	svc := New(repo, &fakePartners{ids: []int64{bob}}, &fakeMedia{owner: alice}, &fakeTx{})
	log := newFakeJournal()
	svc.SetEmitter(ownsyncNew(log))
	if _, err := svc.Post(context.Background(), alice, 7, "hi", "contacts", nil, nil, 0); err != nil {
		t.Fatal(err)
	}
	if len(rowsOf(log, bob, "story_update")) != 1 {
		t.Fatalf("офлайн-Боб без строки журнала: %v", log.rows)
	}
}

// Архив отдаёт общий счёт, а не длину страницы.
func TestArchive_ReturnsTotalCount(t *testing.T) {
	repo := &fakeRepo{archiveItems: []domain.StoryRecord{{ID: 1}, {ID: 2}}, archiveTotal: 7}
	svc := New(repo, &fakePartners{}, &fakeMedia{}, &fakeTx{})
	items, total, err := svc.Archive(context.Background(), alice, 2, 0)
	if err != nil || len(items) != 2 || total != 7 {
		t.Fatalf("items=%d total=%d err=%v; want 2 / 7", len(items), total, err)
	}
}

// Сужение приватности: кто видел историю до правки и не видит после, получает
// маркер удаления (иначе она висит у него в кэше до перезагрузки ленты), а тот,
// кто остался в круге, — новую версию.
func TestEditStory_NarrowingRetractsFromLostViewers(t *testing.T) {
	repo := twoAuthorsRepo()
	repo.origin = domain.StoryOrigin{AuthorID: alice, Privacy: "contacts"}
	repo.byID[10] = domain.StoryRecord{ID: 10, Seq: 1, MediaID: 7, Privacy: "close"}
	repo.closeFriends = []int64{bob}
	// до правки круг видит и Боб, и Кэрол; после — только Боб (близкий)
	svc := New(repo, &fakePartners{ids: []int64{bob, carol}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	repo.visibleSeq = [][]int64{{alice, bob, carol}, {alice, bob}}
	priv := "close"
	if _, err := svc.EditStory(context.Background(), alice, 1, alice, nil, &priv, nil, nil); err != nil {
		t.Fatal(err)
	}
	rows := rowsOf(log, carol, "story_update")
	if len(rows) != 1 || storyOf(t, rows[0])["_"] != domain.StoryItemDeletedTag {
		t.Fatalf("потерявший доступ Кэрол не получил маркер удаления: %v", log.rows[carol])
	}
	bobRows := rowsOf(log, bob, "story_update")
	if len(bobRows) != 1 || storyOf(t, bobRows[0])["_"] == domain.StoryItemDeletedTag {
		t.Fatalf("оставшийся Боб должен получить новую версию: %v", log.rows[bob])
	}
	// Круг после правки берётся из publishStory, а не считается заново: ровно два
	// вызова VisibleAmong (до и в публикации).
	if repo.visibleCalls != 2 || len(repo.visibleSeq) != 0 {
		t.Fatalf("VisibleAmong вызван %d раз; want 2", repo.visibleCalls)
	}
}

// Правка сужает круг до одного автора: «известен и пуст» — маркер уходит всему
// прежнему кругу.
func TestEditStory_NarrowingToNobodyRetractsFromAll(t *testing.T) {
	repo := twoAuthorsRepo()
	repo.origin = domain.StoryOrigin{AuthorID: alice, Privacy: "contacts"}
	repo.byID[10] = domain.StoryRecord{ID: 10, Seq: 1, MediaID: 7, Privacy: "selected"}
	repo.visibleSeq = [][]int64{{alice, bob}, {alice}}
	svc := New(repo, &fakePartners{ids: []int64{bob}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	priv := "selected"
	if _, err := svc.EditStory(context.Background(), alice, 1, alice, nil, &priv, []int64{}, nil); err != nil {
		t.Fatal(err)
	}
	rows := rowsOf(log, bob, "story_update")
	if len(rows) != 1 || storyOf(t, rows[0])["_"] != domain.StoryItemDeletedTag {
		t.Fatalf("Боб при сужении до нуля должен получить маркер: %v", log.rows[bob])
	}
}

// Круг после правки не удалось посчитать: маркер не рассылаем никому (иначе при
// простом сбое выборки вся аудитория потеряла бы историю).
func TestEditStory_AudienceFailureRetractsNobody(t *testing.T) {
	repo := twoAuthorsRepo()
	repo.origin = domain.StoryOrigin{AuthorID: alice, Privacy: "contacts"}
	repo.byID[10] = domain.StoryRecord{ID: 10, Seq: 1, MediaID: 7, Privacy: "contacts"}
	repo.visibleSeq = [][]int64{{alice, bob}}
	repo.visibleFailAt = 2
	svc := New(repo, &fakePartners{ids: []int64{bob}}, &fakeMedia{}, &fakeTx{})
	log := useJournal(svc, newFakePublisher())
	priv := "contacts"
	if _, err := svc.EditStory(context.Background(), alice, 1, alice, nil, &priv, nil, nil); err != nil {
		t.Fatal(err)
	}
	if n := len(log.rows[bob]); n != 0 {
		t.Fatalf("при сбое выборки круга Боб получил %d строк; want 0", n)
	}
}

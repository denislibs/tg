package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

func pageFixture(ids ...int64) []domain.DialogRecord {
	out := make([]domain.DialogRecord, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.DialogRecord{ChatID: id})
	}
	return out
}

func chatIDs(ds []domain.DialogRecord) []int64 {
	out := make([]int64, 0, len(ds))
	for _, d := range ds {
		out = append(out, d.ChatID)
	}
	return out
}

func eq(t *testing.T, got, want []int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestSliceDialogPage(t *testing.T) {
	all := pageFixture(10, 20, 30, 40, 50)

	t.Run("без лимита — весь список отдан целиком", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 || !r.Whole {
			t.Fatalf("count=%d whole=%v", r.Count, r.Whole)
		}
	})

	t.Run("первая страница — кусок, а не весь набор", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
		if r.Count != 5 || r.Whole {
			t.Fatalf("count=%d whole=%v", r.Count, r.Whole)
		}
	})

	t.Run("страница по курсору", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{30, 40})
		if r.Whole {
			t.Fatal("страница с середины — не весь набор")
		}
	})

	// Хвост набора, дочитанный курсором, — по-прежнему КУСОК: count в нём
	// обязателен, иначе клиент решит, что весь список у него уже есть
	// (tweb: isEnd = !count || dialogsLength >= count). Прежний is_end на этом
	// месте говорил «конец» и тем самым терял размер набора.
	t.Run("хвост набора по курсору — всё ещё кусок", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{40, 50})
		if r.Whole || r.Count != 5 {
			t.Fatalf("whole=%v count=%d, want false 5", r.Whole, r.Count)
		}
	})

	t.Run("курсор на последнем — пустая страница с размером набора", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 50})
		if len(r.Dialogs) != 0 || r.Whole || r.Count != 5 {
			t.Fatalf("%v count=%d whole=%v", chatIDs(r.Dialogs), r.Count, r.Whole)
		}
	})

	t.Run("неизвестный курсор — с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: 999})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20})
	})

	t.Run("лимит больше набора — набор отдан целиком", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Limit: 100})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if !r.Whole {
			t.Fatal("весь набор влез в страницу — это messages.dialogs")
		}
	})

	t.Run("count не зависит от лимита и курсора", func(t *testing.T) {
		for _, p := range []domain.DialogPage{{}, {Limit: 1}, {Limit: 1, OffsetChatID: 30}, {Limit: 1, OffsetChatID: 999}} {
			if got := sliceDialogPage(all, p).Count; got != 5 {
				t.Fatalf("%+v: count=%d", p, got)
			}
		}
	})

	t.Run("пустой список", func(t *testing.T) {
		r := sliceDialogPage(nil, domain.DialogPage{Limit: 10})
		if len(r.Dialogs) != 0 || r.Count != 0 || !r.Whole {
			t.Fatalf("%v count=%d whole=%v", chatIDs(r.Dialogs), r.Count, r.Whole)
		}
	})

	t.Run("проход курсором собирает весь список без дублей и пропусков", func(t *testing.T) {
		var got []int64
		var cursor int64
		for {
			r := sliceDialogPage(all, domain.DialogPage{Limit: 2, OffsetChatID: cursor})
			got = append(got, chatIDs(r.Dialogs)...)
			// Конец выводит КЛИЕНТ по размеру набора — ровно как оригинал:
			// isEnd = !count || собрано >= count || страница пуста.
			if r.Count == 0 || len(got) >= r.Count || len(r.Dialogs) == 0 {
				break
			}
			cursor = r.Dialogs[len(r.Dialogs)-1].ChatID
		}
		eq(t, got, []int64{10, 20, 30, 40, 50})
	})
}

// archivedFixture — набор со смешанными архивными: 10,30,50 в архиве.
func archivedFixture() []domain.DialogRecord {
	return []domain.DialogRecord{
		{ChatID: 10, Folder: domain.FolderArchive},
		{ChatID: 20},
		{ChatID: 30, Folder: domain.FolderArchive},
		{ChatID: 40},
		{ChatID: 50, Folder: domain.FolderArchive},
	}
}

// folder — указатель на значение папки: «папка не указана» у запроса выражается
// nil, а не третьим членом перечисления (tweb GLOBAL_FOLDER_ID = undefined).
func folder(f domain.FolderID) *domain.FolderID { return &f }

func TestSliceDialogPageFolder(t *testing.T) {
	all := archivedFixture()

	t.Run("папка не указана — весь набор, архив вместе с остальными", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{})
		eq(t, chatIDs(r.Dialogs), []int64{10, 20, 30, 40, 50})
		if r.Count != 5 {
			t.Fatalf("count=%d, want 5", r.Count)
		}
	})

	t.Run("FolderAll — без архива, Count по выборке", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderAll)})
		eq(t, chatIDs(r.Dialogs), []int64{20, 40})
		if r.Count != 2 || !r.Whole {
			t.Fatalf("count=%d whole=%v, want 2 true", r.Count, r.Whole)
		}
	})

	t.Run("FolderArchive — только архив, Count по выборке", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderArchive)})
		eq(t, chatIDs(r.Dialogs), []int64{10, 30, 50})
		if r.Count != 3 {
			t.Fatalf("count=%d, want 3", r.Count)
		}
	})

	// Курсор ищется ВНУТРИ выборки: chat_id 30 в архиве — второй, а в полном
	// наборе третий. Мутация «фильтровать после нарезки» краснит здесь.
	t.Run("курсор считается внутри выборки", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderArchive), Limit: 1, OffsetChatID: 30})
		eq(t, chatIDs(r.Dialogs), []int64{50})
		if r.Count != 3 || r.Whole {
			t.Fatalf("count=%d whole=%v, want 3 false", r.Count, r.Whole)
		}
	})

	// Чат из ДРУГОЙ выборки курсором не является — страница идёт с начала
	// (то же правило, что у неизвестного id: домен не различает эти случаи).
	t.Run("курсор из другой выборки — страница с начала", func(t *testing.T) {
		r := sliceDialogPage(all, domain.DialogPage{Folder: folder(domain.FolderArchive), Limit: 2, OffsetChatID: 20})
		eq(t, chatIDs(r.Dialogs), []int64{10, 30})
	})
}

// TestListDialogsPage бьёт по самой проводке Interactor.ListDialogsPage, а не
// только по чистой sliceDialogPage: чинит находку ревью — до этого теста подмена
// `all, err := i.ListDialogs(...)` на `all, _ := i.ListDialogs(...)` (глотание
// ошибки) не красила ни один тест пакета.
func TestListDialogsPage(t *testing.T) {
	t.Run("страница согласована с ListDialogs", func(t *testing.T) {
		in, _ := newInteractor()
		ctx := context.Background()
		const owner int64 = 1
		for _, peer := range []int64{2, 3, 4} {
			if _, err := in.CreatePrivateChat(ctx, owner, peer); err != nil {
				t.Fatalf("CreatePrivateChat: %v", err)
			}
		}

		all, err := in.ListDialogs(ctx, owner)
		if err != nil {
			t.Fatalf("ListDialogs: %v", err)
		}
		if len(all) != 3 {
			t.Fatalf("setup: got %d dialogs, want 3", len(all))
		}

		page, err := in.ListDialogsPage(ctx, owner, domain.DialogPage{Limit: 2})
		if err != nil {
			t.Fatalf("ListDialogsPage: %v", err)
		}
		if page.Count != len(all) || page.Whole {
			t.Fatalf("page count=%d whole=%v, want count=%d whole=false", page.Count, page.Whole, len(all))
		}
		eq(t, chatIDs(page.Dialogs), chatIDs(all)[:2])

		rest, err := in.ListDialogsPage(ctx, owner, domain.DialogPage{
			Limit:        2,
			OffsetChatID: page.Dialogs[len(page.Dialogs)-1].ChatID,
		})
		if err != nil {
			t.Fatalf("ListDialogsPage (2-я страница): %v", err)
		}
		if rest.Count != len(all) {
			t.Fatalf("хвост набора обязан нести размер набора: count=%d, want %d", rest.Count, len(all))
		}
		eq(t, chatIDs(rest.Dialogs), chatIDs(all)[2:])
	})

	t.Run("ошибка ListDialogs пробрасывается наружу, а не глотается", func(t *testing.T) {
		s := newStore()
		wantErr := errors.New("boom")
		in := New(fakeTx{}, errChatRepo{fakeChats{s}, wantErr}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, nil, nil, nil, nil, nil)

		_, err := in.ListDialogsPage(context.Background(), 1, domain.DialogPage{})
		if !errors.Is(err, wantErr) {
			t.Fatalf("got err=%v, want %v", err, wantErr)
		}
	})
}

// errChatRepo — обёртка над fakeChats, форсирующая ошибку ListDialogs: единственный
// способ проверить, что ListDialogsPage её пробрасывает, а не глотает.
type errChatRepo struct {
	fakeChats
	err error
}

func (r errChatRepo) ListDialogs(_ context.Context, _ int64) ([]domain.DialogRecord, error) {
	return nil, r.err
}

// Последнее сообщение диалога — ТО ЖЕ сообщение, что и в истории чата (в tweb
// top_message адресует полный объект message), поэтому гидрация у него та же.
// Превью (last_text/last_type) с провода сняты, и сообщение, уехавшее сырым,
// оставляло фото и опрос в списке чатов без превью: `message` пуст, `media`
// нет вовсе. Пин проходит по всей цепочке: вложение, опрос, ответ, реакции.
func TestDialogsPage_TopMessagesHydratedLikeHistory(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	in.SetPolls(newFakePolls())
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a int64 = 1

	// Чат с фото последним сообщением.
	photoChat, _ := in.CreatePrivateChat(ctx, a, 2)
	const mediaID int64 = 91
	s.seedMedia(mediaID, a)
	s.seedMediaDims(mediaID, domain.MediaSource{Mime: "image/jpeg", Width: 1280, Height: 720, Size: 26941})
	mid := mediaID
	photo, err := in.Send(ctx, SendInput{ChatID: photoChat, SenderID: a, Type: "photo", MediaID: &mid})
	if err != nil {
		t.Fatalf("send photo: %v", err)
	}
	if err := (fakeReactions{s}).Add(ctx, photo.ID, 2, "👍", false); err != nil {
		t.Fatalf("react: %v", err)
	}

	// Чат с опросом последним сообщением.
	pollChat, _ := in.CreatePrivateChat(ctx, a, 3)
	poll, err := in.SendPoll(ctx, SendPollInput{ChatID: pollChat, SenderID: a, Question: "Куда?", Options: []string{"сюда", "туда"}})
	if err != nil {
		t.Fatalf("send poll: %v", err)
	}

	// Чат с ответом последним сообщением.
	replyChat, _ := in.CreatePrivateChat(ctx, a, 4)
	orig, err := in.Send(ctx, SendInput{ChatID: replyChat, SenderID: 4, Text: "вопрос"})
	if err != nil {
		t.Fatalf("send orig: %v", err)
	}
	reply, err := in.Send(ctx, SendInput{ChatID: replyChat, SenderID: a, Text: "ответ", ReplyToID: &orig.Seq})
	if err != nil {
		t.Fatalf("send reply: %v", err)
	}

	page, err := in.DialogsPage(ctx, a, domain.DialogPage{Limit: 20})
	if err != nil {
		t.Fatalf("DialogsPage: %v", err)
	}
	byID := map[int64]domain.Message{}
	for _, m := range page.Messages {
		byID[m.ID] = m
	}

	got, ok := byID[photo.ID]
	if !ok {
		t.Fatalf("фото нет в векторе messages")
	}
	ph, ok := got.Media.(*domain.MessageMediaPhoto)
	if !ok {
		t.Fatalf("вложение последнего сообщения не собрано: Media = %#v", got.Media)
	}
	if w, h := domain.MediaDimensions(ph); w != 1280 || h != 720 {
		t.Fatalf("dims = %dx%d, want 1280x720", w, h)
	}
	if len(got.Reactions) != 1 || got.Reactions[0].Emoji != "👍" {
		t.Fatalf("реакции последнего сообщения не наполнены: %+v", got.Reactions)
	}

	if got := byID[poll.ID]; got.Poll == nil || got.Poll.Question != "Куда?" {
		t.Fatalf("опрос последнего сообщения не наполнен: Poll = %+v", got.Poll)
	}

	if got := byID[reply.ID]; got.ReplyTo == nil || got.ReplyTo.Seq != orig.Seq {
		t.Fatalf("ответ последнего сообщения не наполнен: ReplyTo = %+v", got.ReplyTo)
	}
}

// savedTopMsgs — хранилище, у которого «Избранное» разложено по источникам:
// строка адресует последнее сообщение ключом top.
type savedTopMsgs struct {
	fakeMsgs
	top domain.Message
}

func (r savedTopMsgs) SavedDialogs(context.Context, int64, int64) ([]domain.SavedDialogRecord, error) {
	return []domain.SavedDialogRecord{{PeerID: domain.PeerID(r.top.SenderID), LastMsgID: r.top.ID, LastMsgSeq: r.top.Seq}}, nil
}

// topicRows — темы чата, у которых последнее сообщение адресовано ключом top;
// остальные методы порта этим тестам не нужны.
type topicRows struct {
	TopicRepo
	top domain.Message
}

func (r topicRows) ListByChat(context.Context, int64, int64) ([]domain.TopicRow, error) {
	return []domain.TopicRow{{LastMsgID: r.top.ID, LastMsgSeq: r.top.Seq}}, nil
}

// sendPhoto отправляет фото с известными размерами — сообщение, которое сырой
// строкой несёт лишь ключ файла.
func sendPhoto(t *testing.T, in *Interactor, s *store, chatID, senderID int64) domain.Message {
	t.Helper()
	const mediaID int64 = 92
	s.seedMedia(mediaID, senderID)
	s.seedMediaDims(mediaID, domain.MediaSource{Mime: "image/jpeg", Width: 800, Height: 600, Size: 1000})
	mid := mediaID
	m, err := in.Send(context.Background(), SendInput{ChatID: chatID, SenderID: senderID, Type: "photo", MediaID: &mid})
	if err != nil {
		t.Fatalf("send photo: %v", err)
	}
	return m
}

func assertPhotoHydrated(t *testing.T, msgs []domain.Message, id int64) {
	t.Helper()
	for _, m := range msgs {
		if m.ID != id {
			continue
		}
		if _, ok := m.Media.(*domain.MessageMediaPhoto); !ok {
			t.Fatalf("вложение последнего сообщения не собрано: Media = %#v", m.Media)
		}
		return
	}
	t.Fatalf("сообщения %d нет в векторе messages", id)
}

// Та же болезнь, что у списка чатов: последнее сообщение темы форума едет
// вектором `messages` и должно быть тем же сообщением, что в ленте темы.
func TestTopicsPage_TopMessageHydrated(t *testing.T) {
	s := newStore()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	in.SetPublisher(&fakePublisher{})
	ctx := context.Background()
	const a int64 = 1
	chatID, _ := in.CreatePrivateChat(ctx, a, 2)
	top := sendPhoto(t, in, s, chatID, a)
	in.SetTopics(topicRows{top: top})

	page, err := in.TopicsPage(ctx, chatID, a)
	if err != nil {
		t.Fatalf("TopicsPage: %v", err)
	}
	assertPhotoHydrated(t, page.Messages, top.ID)
}

// И у «Избранного» в разрезе источников: строка адресует последнее
// сохранённое сообщение, превью клиент собирает из него самого.
func TestSavedDialogsPage_TopMessageHydrated(t *testing.T) {
	s := newStore()
	ctx := context.Background()
	const a int64 = 1
	saved, _ := fakeChats{s}.CreateSaved(ctx, a)
	pre := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	pre.SetPublisher(&fakePublisher{})
	top := sendPhoto(t, pre, s, saved, a)

	in := New(fakeTx{}, fakeChats{s}, savedTopMsgs{fakeMsgs{s}, top}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, newFakeGroupRepo(), nil, nil, nil, nil)
	page, err := in.SavedDialogsPage(ctx, a)
	if err != nil {
		t.Fatalf("SavedDialogsPage: %v", err)
	}
	assertPhotoHydrated(t, page.Messages, top.ID)
}

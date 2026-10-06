package chat

// Регрессии пачки Ф-1в (аудит бэкенда 2026-10-05): пересылка, правка,
// служебки по запросу пользователя и мелкие гейты отправки идут теми же
// проверками, что Send; копия сообщения — общим copyContent.

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

func f64(v float64) *float64 { return &v }

// blockedBy — PrivacyChecker: владелец owner заблокировал всех (Check — блок
// плюс «кто может писать», как usecase/privacy). lastSeenHidden — правило
// last seen у owner скрыто от всех.
type blockedBy struct {
	owner          int64
	lastSeenHidden bool
}

func (p blockedBy) Check(_ context.Context, ownerID, _ int64, key domain.PrivacyKey) (bool, error) {
	if ownerID != p.owner {
		return true, nil
	}
	if key == domain.PrivacyLastSeen {
		return !p.lastSeenHidden, nil
	}
	return p.lastSeenHidden, nil // блок — всё запрещено; только скрытый last seen — остальное можно
}

func (p blockedBy) VisibleMap(_ context.Context, _ int64, ids []int64, _ domain.PrivacyKey) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ids {
		out[id] = id != p.owner
	}
	return out, nil
}

// gateGroup — группа 7 (создатель) + 8 (участник) с полным конвейером сообщений.
func gateGroup(t *testing.T) (*Interactor, *fakeGroupRepo, *store, int64) {
	t.Helper()
	fg := newFakeGroupRepo()
	s := newStore()
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.mu.Unlock()
	}
	in := New(fakeTx{}, groupChats{fg}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, newFakeInviteRepo(), nil, nil, newFakeJoinRequestRepo())
	in.SetPublisher(&fakePublisher{})
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Алиса"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}
	id, _, err := in.CreateGroup(context.Background(), 7, "Team", "", "", false, []int64{8})
	if err != nil {
		t.Fatal(err)
	}
	return in, fg, s, id
}

// --- Пересылка через гейты Send (A3-04, A5-11) ---

func TestForward_GroupGatesOfSend(t *testing.T) {
	in, fg, _, id := gateGroup(t)
	ctx := context.Background()
	text, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "текст Алисы"})
	geo, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Type: "geo", GeoLat: f64(55.7), GeoLng: f64(37.6)})
	fwd := func(ids ...int64) error {
		_, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: id, ToChatID: id, MsgIDs: ids, SenderID: 8})
		return err
	}

	// Права чата без медиа: текст пересылается, гео — нет (медиа-бит по копии).
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMedia, 0); err != nil {
		t.Fatal(err)
	}
	if err := fwd(text.ID); err != nil {
		t.Fatalf("текст без запрета писать: %v", err)
	}
	if err := fwd(geo.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("гео при запрете медиа: %v, want ErrForbidden", err)
	}
	// Запрет писать — никакой пересылки.
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMessages, 0); err != nil {
		t.Fatal(err)
	}
	if err := fwd(text.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылка при запрете писать: %v, want ErrForbidden", err)
	}
	// Личное ограничение участника (стенд аудита: denied_rights=3).
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 0); err != nil {
		t.Fatal(err)
	}
	if err := fg.SetRestriction(ctx, domain.MemberRestriction{ChatID: id, UserID: 8, DeniedRights: domain.PermSendMessages | domain.PermSendMedia}); err != nil {
		t.Fatal(err)
	}
	if err := fwd(text.ID); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылка ограниченного: %v, want ErrForbidden", err)
	}
}

// Медленный режим: пересылка — отправка; пачку из нескольких единиц в нём не
// переслать (SLOWMODE_MULTI_MSGS_DISABLED), альбом — одна единица.
func TestForward_Slowmode(t *testing.T) {
	in, _, _, id := gateGroup(t)
	ctx := context.Background()
	a, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "раз"})
	b, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 7, Text: "два"})
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 60); err != nil {
		t.Fatal(err)
	}
	fwd := func(ids ...int64) error {
		_, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: id, ToChatID: id, MsgIDs: ids, SenderID: 8})
		return err
	}
	if err := fwd(a.ID, b.ID); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("две единицы в медленном режиме: %v, want ErrSlowmode", err)
	}
	if err := fwd(a.ID); err != nil {
		t.Fatalf("одна единица: %v", err)
	}
	if err := fwd(b.ID); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("вторая пересылка в окне: %v, want ErrSlowmode", err)
	}
}

// Личка: заблокированный не пишет пересылкой (стенд аудита: forward → 200).
func TestForward_PrivateBlocked(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const victim, blocked, other int64 = 1, 2, 3
	src, _ := in.CreatePrivateChat(ctx, blocked, other)
	dst, _ := in.CreatePrivateChat(ctx, blocked, victim)
	m, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: other, Text: "привет"})
	in.SetPrivacy(blockedBy{owner: victim})
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{m.ID}, SenderID: blocked}); !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("пересылка заблокировавшему: %v, want ErrPrivacy", err)
	}
}

// Служебное сообщение не пересылается (tweb canForward: только message).
func TestForward_ServiceRejected(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	src, _ := in.CreatePrivateChat(ctx, 1, 2)
	dst, _ := in.CreatePrivateChat(ctx, 1, 3)
	svc, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: 1, Action: domain.NewMessageActionTopicCreate("t", 0)})
	if _, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{svc.ID}, SenderID: 1}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("пересылка служебки: %v, want ErrForbidden", err)
	}
}

// --- Копия содержимого (A1-02, A3-20) и out пересылающего (A1-05) ---

func TestForward_CopiesContentAndRegroupsAlbum(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	const a, b, c int64 = 1, 2, 3
	src, _ := in.CreatePrivateChat(ctx, a, b)
	dst, _ := in.CreatePrivateChat(ctx, a, c)
	s.seedUsername(c, "carol")
	geo, err := in.Send(ctx, SendInput{ChatID: src, SenderID: b, Type: "geo", GeoLat: f64(55.7), GeoLng: f64(37.6), GeoTitle: strp("Кремль")})
	if err != nil {
		t.Fatal(err)
	}
	// Контакт кладётся строкой: гидрация контакта по аккаунту — не предмет теста.
	cu, cname, cphone := c, "Кэрол", "+79990000003"
	contact, err := (fakeMsgs{s}).Insert(ctx, domain.Message{ChatID: src, Seq: 100, SenderID: b, Type: "contact",
		ContactUserID: &cu, ContactName: &cname, ContactPhone: &cphone})
	if err != nil {
		t.Fatal(err)
	}
	s.seedMedia(101, b)
	s.seedMedia(102, b)
	m101, m102 := int64(101), int64(102)
	al1, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: b, Type: "photo", MediaID: &m101, GroupedID: 555})
	al2, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: b, Type: "photo", MediaID: &m102, GroupedID: 555})

	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, SenderID: a,
		MsgIDs: []int64{geo.ID, contact.ID, al1.ID, al2.ID}})
	if err != nil {
		t.Fatalf("ForwardMessages: %v", err)
	}
	if len(out) != 4 {
		t.Fatalf("копий %d, want 4", len(out))
	}
	g := out[0]
	if g.GeoLat == nil || *g.GeoLat != 55.7 || g.GeoTitle == nil || *g.GeoTitle != "Кремль" {
		t.Fatalf("гео потеряно: %+v", g)
	}
	if k := out[1]; k.ContactUserID == nil || *k.ContactUserID != c || k.ContactPhone == nil {
		t.Fatalf("контакт потерян: %+v", k)
	}
	x, y := out[2].GroupedID, out[3].GroupedID
	if x == nil || y == nil || *x != *y || *x == 555 || *x > maxSafeGroupedID {
		t.Fatalf("альбом: grouped_id копий %v/%v, want общий новый (не 555)", x, y)
	}
	// Своё пересланное — out у пересылающего (кадр журнала), не у получателя.
	if f := lastMessageFlags(t, s, a, "new_message"); !f["out"] {
		t.Fatalf("кадр пересылающему: pFlags=%v, want out", f)
	}
	if f := lastMessageFlags(t, s, c, "new_message"); f["out"] {
		t.Fatalf("кадр получателю: pFlags=%v, want без out", f)
	}
}

func strp(s string) *string { return &s }

// Превью ссылки переживает пересылку (A1-09 часть форварда).
func TestForward_CopiesWebPage(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	src, _ := in.CreatePrivateChat(ctx, 1, 2)
	dst, _ := in.CreatePrivateChat(ctx, 1, 3)
	m, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: 2, Text: "https://example.com"})
	wp := &domain.WebPagePreview{URL: "https://example.com", Title: "Example"}
	if err := (fakeMsgs{s}).SetWebPage(ctx, m.ID, wp); err != nil {
		t.Fatal(err)
	}
	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{m.ID}, SenderID: 1})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := in.msgs.GetByID(ctx, out[0].ID)
	if got.WebPage == nil || got.WebPage.Title != "Example" {
		t.Fatalf("превью потеряно: %+v", got.WebPage)
	}
}

// silent — без пуша; top_msg_id — копия в треде приёмника (A3-34).
func TestForward_SilentAndThread(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	notif := &fakeNotifier{}
	in.SetNotifier(notif)
	src, _ := in.CreatePrivateChat(ctx, 1, 2)
	dst, _ := in.CreatePrivateChat(ctx, 1, 3)
	root, _ := in.Send(ctx, SendInput{ChatID: dst, SenderID: 1, Text: "корень"})
	m, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: 2, Text: "x"})
	notif.mu.Lock()
	notif.recipients = nil
	notif.mu.Unlock()

	out, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{m.ID}, SenderID: 1,
		Silent: true, ThreadRootID: &root.ID})
	if err != nil {
		t.Fatal(err)
	}
	if out[0].ThreadRootID == nil || *out[0].ThreadRootID != root.ID {
		t.Fatalf("копия не в треде: %+v", out[0].ThreadRootID)
	}
	notif.mu.Lock()
	defer notif.mu.Unlock()
	if len(notif.recipients) != 0 {
		t.Fatalf("silent: пуши %v, want нет", notif.recipients)
	}
}

// --- Зеркало поста — тот же копировщик (A1-08) ---

func TestMirror_CopiesGeo(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	ch, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	if _, err := i.EnableDiscussion(ctx, ch, 7); err != nil {
		t.Fatal(err)
	}
	post, err := i.Send(ctx, SendInput{ChatID: ch, SenderID: 7, Type: "geo", GeoLat: f64(1), GeoLng: f64(2)})
	if err != nil {
		t.Fatal(err)
	}
	id, err := i.msgs.MirrorByPost(ctx, ch, post.ID)
	if err != nil || id == 0 {
		t.Fatalf("зеркала нет: %d %v", id, err)
	}
	mirror, _ := i.msgs.GetByID(ctx, id)
	if mirror.GeoLat == nil || *mirror.GeoLat != 1 || mirror.Type != "geo" {
		t.Fatalf("гео в зеркале потеряно: %+v", mirror)
	}
}

// --- Правка = canEditMessage (A5-13, A5-16, A5-31) ---

func TestEdit_ForwardedAndServiceForbidden(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const alice, bob int64 = 1, 2
	src, _ := in.CreatePrivateChat(ctx, alice, bob)
	dst, _ := in.CreatePrivateChat(ctx, bob, 3)
	orig, _ := in.Send(ctx, SendInput{ChatID: src, SenderID: alice, Text: "Оригинал Алисы"})
	fwd, err := in.ForwardMessages(ctx, ForwardInput{FromChatID: src, ToChatID: dst, MsgIDs: []int64{orig.ID}, SenderID: bob})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := in.EditMessage(ctx, dst, fwd[0].ID, bob, "Я, Алиса, признаю всё", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("правка пересланного: %v, want ErrForbidden", err)
	}
	svc, _ := in.Send(ctx, SendInput{ChatID: dst, SenderID: bob, Action: domain.NewMessageActionTopicCreate("t", 0)})
	if _, err := in.EditMessage(ctx, dst, svc.ID, bob, "подмена", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("правка служебки: %v, want ErrForbidden", err)
	}
}

func TestEdit_PrivateTimeLimit(t *testing.T) {
	in, s := newInteractor()
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)
	m, _ := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: "старое"})
	if _, err := in.EditMessage(ctx, chat, m.ID, 1, "свежая правка", nil); err != nil {
		t.Fatalf("правка свежего: %v", err)
	}
	s.mu.Lock()
	for idx := range s.messages[chat] {
		s.messages[chat][idx].CreatedAt = time.Now().Add(-49 * time.Hour)
	}
	s.mu.Unlock()
	if _, err := in.EditMessage(ctx, chat, m.ID, 1, "задним числом", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("правка через 49 ч: %v, want ErrForbidden", err)
	}
}

func TestEdit_GroupNeedsSendRight(t *testing.T) {
	in, _, _, id := gateGroup(t)
	ctx := context.Background()
	m, _ := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "моё"})
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMessages, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := in.EditMessage(ctx, id, m.ID, 8, "правка без права писать", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("правка при запрете писать: %v, want ErrForbidden", err)
	}
}

func TestEdit_ChannelByEditRight(t *testing.T) {
	s := newStore()
	fg := newFakeGroupRepo()
	in := New(fakeTx{}, groupMembershipChats{fg, s}, fakeMsgs{s}, fakeUpdates{s}, nil, fakeMedia{s}, fg, nil, newFakeChannelRepo(), newFakeSearchRepo(), nil)
	in.SetChannelPublisher(&fakeChannelPublisher{})
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	ctx := context.Background()
	ch, _ := in.CreateChannel(ctx, 7, "News", "", "", true)
	post, err := in.PostToChannel(ctx, ch, 7, "пост владельца", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	// Админ с edit_messages правит ЧУЖОЙ пост (tweb: broadcast → hasRights).
	_ = fg.AddMember(ctx, ch, 8, domain.RoleAdmin, domain.RightEditMessages)
	if _, err := in.EditMessage(ctx, ch, post.ID, 8, "правка админа", nil); err != nil {
		t.Fatalf("админ с edit_messages: %v", err)
	}
	// Снятый админ свои старые посты больше не правит.
	_ = fg.AddMember(ctx, ch, 9, domain.RoleAdmin, domain.RightPostMessages)
	own, err := in.Send(ctx, SendInput{ChatID: ch, SenderID: 9, Text: "пост 9"})
	if err != nil {
		t.Fatal(err)
	}
	_ = fg.SetRole(ctx, ch, 9, domain.RoleSubscriber, 0, 0)
	if _, err := in.EditMessage(ctx, ch, own.ID, 9, "правка снятого", nil); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("снятый админ: %v, want ErrForbidden", err)
	}
}

// --- Служебки по запросу пользователя через гейты Send (A5-12) ---

func TestUserActions_ThroughSendGates(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	const victim, blocked int64 = 1, 2
	in.SetPrivacy(blockedBy{owner: victim})
	if _, err := in.SuggestBirthday(ctx, blocked, victim, domain.Birthday{Day: 1, Month: 2}); !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("дата рождения заблокировавшему: %v, want ErrPrivacy", err)
	}
}

func TestCreateTopic_ForumAndRights(t *testing.T) {
	in, fg, _, id := gateGroup(t)
	in.SetTopics(newFakeTopicRepo())
	ctx := context.Background()
	if _, err := in.CreateTopic(ctx, id, 8, "тема", "", 0); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("тема в не-форуме: %v, want ErrForbidden", err)
	}
	_ = fg.SetForum(ctx, id, true)
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms&^domain.PermSendMessages, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := in.CreateTopic(ctx, id, 8, "тема", "", 0); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("тема участника без права писать: %v, want ErrForbidden", err)
	}
	if _, err := in.CreateTopic(ctx, id, 7, "тема владельца", "", 0); err != nil {
		t.Fatalf("тема владельца: %v", err)
	}
}

// --- Мелкие гейты отправки ---

// A5-19: «когда будет в сети» раскрывает момент входа — только при видимом last seen.
func TestScheduleWhenOnline_LastSeenPrivacy(t *testing.T) {
	in, s, _ := newScheduledTestInteractor()
	ctx := context.Background()
	cid, _ := fakeChats{s}.CreatePrivate(ctx, 1, 2)
	in.SetPrivacy(blockedBy{owner: 2, lastSeenHidden: true})
	if _, err := in.ScheduleMessage(ctx, SendInput{ChatID: cid, SenderID: 1, Text: "x"}, time.Now(), true); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("when_online при скрытом last seen: %v, want ErrForbidden", err)
	}
}

// A5-20: альбом — одна единица медленного режима.
func TestSlowmode_AlbumIsOneUnit(t *testing.T) {
	in, _, s, id := gateGroup(t)
	ctx := context.Background()
	if err := in.SetChatPermissions(ctx, id, 7, domain.AllMemberPerms, 10); err != nil {
		t.Fatal(err)
	}
	s.seedMedia(201, 8)
	s.seedMedia(202, 8)
	m1, m2 := int64(201), int64(202)
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "photo", MediaID: &m1, GroupedID: 77}); err != nil {
		t.Fatal(err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Type: "photo", MediaID: &m2, GroupedID: 77}); err != nil {
		t.Fatalf("второй элемент альбома: %v", err)
	}
	if _, err := in.Send(ctx, SendInput{ChatID: id, SenderID: 8, Text: "после альбома"}); !errors.Is(err, domain.ErrSlowmode) {
		t.Fatalf("новое сообщение в окне: %v, want ErrSlowmode", err)
	}
}

// A5-22: цитата — фрагмент оригинала, offset в UTF-16.
func TestReplyQuote_MustBeFragmentOfOriginal(t *testing.T) {
	in, _ := newInteractor()
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)
	orig, _ := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: "😀 Привет, мир"})
	fake := "Я, Алиса, этого не писала"
	if _, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 2, Text: "ответ", ReplyToID: &orig.Seq, ReplyQuoteText: &fake}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("поддельная цитата: %v, want ErrInvalid", err)
	}
	q, wrong := "мир", 0
	m, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 2, Text: "ответ", ReplyToID: &orig.Seq, ReplyQuoteText: &q, ReplyQuoteOffset: &wrong})
	if err != nil {
		t.Fatalf("настоящая цитата: %v", err)
	}
	// «😀 Привет, » — эмодзи занимает две единицы UTF-16: 2+1+8 = 11.
	if m.ReplyQuoteOffset == nil || *m.ReplyQuoteOffset != 11 {
		t.Fatalf("offset = %v, want 11 (UTF-16)", m.ReplyQuoteOffset)
	}
}

// A5-24: подарок заблокировавшему — отказ ДО списания: ни звёзд, ни подарка.
func TestSendGift_BlockedNoCharge(t *testing.T) {
	in, fs, _ := newStarsInteractor()
	ctx := context.Background()
	if _, err := in.TopUpStars(ctx, 1, 50); err != nil {
		t.Fatal(err)
	}
	in.SetPrivacy(blockedBy{owner: 2})
	if _, _, err := in.SendGift(ctx, 1, 2, 1, "", false); !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("подарок заблокировавшему: %v, want ErrPrivacy", err)
	}
	if bal, _ := fs.Balance(ctx, 1); bal != 50 {
		t.Fatalf("баланс %d, want 50 (звёзды не списаны)", bal)
	}
	if gifts, _ := fs.ProfileGifts(ctx, 2, 2); len(gifts) != 0 {
		t.Fatalf("подарок выдан заблокировавшему: %+v", gifts)
	}
}

// A5-33: удалённому аккаунту не пишут и новой переписки с ним не заводят.
func TestSend_DeletedPeer(t *testing.T) {
	s := newStore()
	fg := newFakeGroupRepo()
	in := New(fakeTx{}, fakeChats{s}, fakeMsgs{s}, fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, nil, nil, nil, nil)
	ctx := context.Background()
	chat, _ := in.CreatePrivateChat(ctx, 1, 2)
	fg.users[2] = domain.NewUser(2, domain.UserFlags{Deleted: true})
	fg.users[3] = domain.NewUser(3, domain.UserFlags{Deleted: true})
	if _, err := in.Send(ctx, SendInput{ChatID: chat, SenderID: 1, Text: "в пустоту"}); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("отправка удалённому: %v, want ErrForbidden", err)
	}
	if _, err := in.CreatePrivateChat(ctx, 1, 3); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("новая личка с удалённым: %v, want ErrForbidden", err)
	}
}

// A5-34: секретный чат подчиняется блоку — и создание, и отправка.
func TestSecretChat_BlockAndPrivacy(t *testing.T) {
	in, _ := newSecretTestInteractor(t)
	ctx := context.Background()
	in.SetPrivacy(blockedBy{owner: 2})
	if _, err := in.CreateSecretChat(ctx, 1, 2, []byte{1}); !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("секретный чат с заблокировавшим: %v, want ErrPrivacy", err)
	}
	in2, s := newInteractor()
	in2.SetPrivacy(blockedBy{owner: 2})
	s.seedChat(500, domain.ChatTypeSecret, 1, 2)
	if _, err := in2.Send(ctx, SendInput{ChatID: 500, SenderID: 1, Type: "encrypted", EncBody: []byte{1, 2}}); !errors.Is(err, domain.ErrPrivacy) {
		t.Fatalf("сообщение в секретный чат заблокировавшему: %v, want ErrPrivacy", err)
	}
}

// --- Реле сигналинга звонков (A5-04, A5-32, A2-09) ---

type fakeGroupCalls struct {
	mu    sync.Mutex
	parts map[int64][]int64
}

func (f *fakeGroupCalls) Join(_ context.Context, chatID, userID int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !slices.Contains(f.parts[chatID], userID) {
		f.parts[chatID] = append(f.parts[chatID], userID)
	}
	return nil
}
func (f *fakeGroupCalls) Leave(context.Context, int64, int64) error { return nil }
func (f *fakeGroupCalls) Participants(_ context.Context, chatID int64) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.parts[chatID]), nil
}

func TestGroupCallSignal_OnlyBetweenParticipants(t *testing.T) {
	in, s := newInteractor()
	pub := &fakePublisher{}
	in.SetPublisher(pub)
	in.SetGroupCalls(&fakeGroupCalls{parts: map[int64][]int64{}})
	ctx := context.Background()
	s.seedChat(600, domain.ChatTypeGroup, 1, 2, 3)
	if _, err := in.JoinGroupCall(ctx, 600, 1); err != nil {
		t.Fatal(err)
	}
	offer := func() map[string]any { return map[string]any{"sdp": map[string]any{"type": "offer"}} }
	// Посторонний (не участник чата) и участник чата вне звонка — мимо.
	if err := in.RelayGroupCallSignal(ctx, 9, 600, 1, offer()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("сигнал не-участника чата: %v, want ErrForbidden", err)
	}
	if err := in.RelayGroupCallSignal(ctx, 2, 600, 1, offer()); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("сигнал не-участника звонка: %v, want ErrForbidden", err)
	}
	if n := framesOfType(pub, 1, "group_call_signal"); n != 0 {
		t.Fatalf("Алисе доставлено %d чужих сигналов", n)
	}
	if _, err := in.JoinGroupCall(ctx, 600, 2); err != nil {
		t.Fatal(err)
	}
	if err := in.RelayGroupCallSignal(ctx, 2, 600, 1, offer()); err != nil {
		t.Fatalf("сигнал участника: %v", err)
	}
	if n := framesOfType(pub, 1, "group_call_signal"); n != 1 {
		t.Fatalf("сигнал участника: доставлено %d, want 1", n)
	}
}

func TestPhoneCall_FramesOnlyWithinCall(t *testing.T) {
	in, _, _, pub := newCallInteractor()
	const stranger = int64(9)
	// Кадр без звонка и с пустым call_id — мимо.
	relay(t, in, "call_end", stranger, calleeID, `{"call_id":"nope"}`)
	relay(t, in, "call_end", stranger, calleeID, `{}`)
	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"c1"}`)
	// Посторонний обрывает чужой звонок — мимо; перехват чужого call_id — мимо.
	relay(t, in, "call_end", stranger, calleeID, `{"call_id":"c1"}`)
	relay(t, in, "call_request", stranger, calleeID, `{"call_id":"c1"}`)
	if n := framesOfType(pub, calleeID, "call_end"); n != 0 {
		t.Fatalf("адресату дошло %d чужих call_end", n)
	}
	if n := framesOfType(pub, calleeID, "call_request"); n != 1 {
		t.Fatalf("call_request адресату: %d, want 1 (перехват не прошёл)", n)
	}
	// Звонящий не «отвечает» за вызываемого.
	relay(t, in, "call_accept", callerID, calleeID, `{"call_id":"c1"}`)
	if n := framesOfType(pub, calleeID, "call_accept"); n != 0 {
		t.Fatalf("call_accept от звонящего доставлен")
	}
}

// A2-09: ответ на одном устройстве гасит звонок на остальных; запоздалый
// отказ второго устройства разговор не рвёт.
func TestPhoneCall_AnsweredElsewhere(t *testing.T) {
	in, s, calls, pub := newCallInteractor()
	relay(t, in, "call_request", callerID, calleeID, `{"call_id":"c1"}`)
	relay(t, in, "call_accept", calleeID, callerID, `{"call_id":"c1"}`)

	pub.mu.Lock()
	var got map[string]any
	for _, f := range pub.frames {
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if f.userID == calleeID && json.Unmarshal(f.frame, &env) == nil && env.T == "call_end" {
			got = env.D
		}
	}
	pub.mu.Unlock()
	if got == nil || got["reason"] != callAnsweredElsewhere || got["call_id"] != "c1" {
		t.Fatalf("устройствам вызываемого: %v, want call_end answered_elsewhere", got)
	}

	relay(t, in, "call_decline", calleeID, callerID, `{"call_id":"c1","reason":"missed"}`)
	if n := framesOfType(pub, callerID, "call_decline"); n != 0 {
		t.Fatalf("запоздалый call_decline доставлен звонящему")
	}
	if _, err := calls.Get(context.Background(), "c1"); err != nil {
		t.Fatalf("звонок кончился от запоздалого отказа: %v", err)
	}
	if n := len(callLogs(s)); n != 0 {
		t.Fatalf("лог звонка до конца разговора: %d", n)
	}
}

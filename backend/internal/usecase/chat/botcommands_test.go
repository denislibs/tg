package chat

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"sort"
	"sync"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Команды бота по скоупам и их рассылка (Ф-6, f6-bots): updateBotCommands после
// setMyCommands/deleteMyCommands/BotFather, bot_info в карточках.

// botCmdWorld — общее состояние фейков BotRepo и BotAPIRepo: одна «таблица
// bot_commands» и один «chat_members», как в реальной БД.
type botCmdWorld struct {
	mu      sync.Mutex
	isBot   map[int64]bool
	lists   map[botCmdKey][]domain.BotCommand
	chats   map[int64]string           // chatID -> тип
	members map[int64]map[int64]string // chatID -> userID -> роль (боты тоже)
	// fetches — выборки команд: по чатам (CommandsFor*) и GroupLists (ключ -1).
	fetches map[int64]int
	// gate — если не nil, BotChats ждёт его закрытия (держит рассылку «идущей»).
	gate chan struct{}
	// panicOnce — следующий BotChats паникует (проверка снятия записи рассылки).
	panicOnce bool
}

type botCmdKey struct {
	bot   int64
	scope domain.BotCommandScope
	lang  string
}

func newBotCmdWorld() *botCmdWorld {
	return &botCmdWorld{
		isBot:   map[int64]bool{},
		lists:   map[botCmdKey][]domain.BotCommand{},
		chats:   map[int64]string{},
		members: map[int64]map[int64]string{},
		fetches: map[int64]int{},
	}
}

func (w *botCmdWorld) addChat(chatID int64, typ string, members map[int64]string) {
	w.chats[chatID] = typ
	w.members[chatID] = members
}

func (w *botCmdWorld) put(bot int64, scope domain.BotCommandScope, lang string, cmds ...string) {
	scope.Type = scope.Norm()
	var list []domain.BotCommand
	for _, c := range cmds {
		list = append(list, domain.BotCommand{Command: c, Description: c + " d"})
	}
	w.lists[botCmdKey{bot, scope, lang}] = list
}

// fakeBotRepo — BotRepo поверх botCmdWorld; приоритет скоупов зеркалит SQL-репо.
type fakeBotRepo struct{ w *botCmdWorld }

func (f fakeBotRepo) IsBot(_ context.Context, id int64) (bool, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	return f.w.isBot[id], nil
}

func (f fakeBotRepo) CommandsFor(ctx context.Context, botID, chatID, viewerID int64, isAdmin bool, lang string) ([]domain.BotCommand, error) {
	m, err := f.CommandsForBots(ctx, []int64{botID}, chatID, viewerID, isAdmin, lang)
	return m[botID], err
}

func (f fakeBotRepo) CommandsForBots(_ context.Context, botIDs []int64, chatID, viewerID int64, isAdmin bool, lang string) (map[int64][]domain.BotCommand, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	f.w.fetches[chatID]++
	var order []domain.BotCommandScope
	if chatID == 0 {
		order = []domain.BotCommandScope{{Type: domain.BotScopeAllPrivateChats}, {Type: domain.BotScopeDefault}}
	} else {
		if viewerID != 0 {
			order = append(order, domain.BotCommandScope{Type: domain.BotScopeChatMember, ChatID: chatID, UserID: viewerID})
		}
		if isAdmin {
			order = append(order, domain.BotCommandScope{Type: domain.BotScopeChatAdministrator, ChatID: chatID})
		}
		order = append(order, domain.BotCommandScope{Type: domain.BotScopeChat, ChatID: chatID})
		if isAdmin {
			order = append(order, domain.BotCommandScope{Type: domain.BotScopeAllChatAdmins})
		}
		order = append(order, domain.BotCommandScope{Type: domain.BotScopeAllGroupChats}, domain.BotCommandScope{Type: domain.BotScopeDefault})
	}
	out := map[int64][]domain.BotCommand{}
	for _, bot := range botIDs {
	pick:
		for _, sc := range order {
			for _, l := range []string{lang, ""} {
				if cs := f.w.lists[botCmdKey{bot, sc, l}]; len(cs) > 0 {
					out[bot] = cs
					break pick
				}
			}
		}
	}
	return out, nil
}

func (f fakeBotRepo) BotChats(_ context.Context, botID int64, types []string, limit int) ([]domain.BotChat, error) {
	f.w.mu.Lock()
	gate := f.w.gate
	if f.w.panicOnce {
		f.w.panicOnce = false
		f.w.mu.Unlock()
		panic("boom")
	}
	f.w.mu.Unlock()
	if gate != nil {
		<-gate
	}
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	var ids []int64
	for chatID, ms := range f.w.members {
		if _, ok := ms[botID]; ok && slices.Contains(types, f.w.chats[chatID]) {
			ids = append(ids, chatID)
		}
	}
	sort.Slice(ids, func(a, b int) bool { return ids[a] < ids[b] })
	var out []domain.BotChat
	for _, id := range ids {
		if len(out) == limit {
			break
		}
		out = append(out, domain.BotChat{ChatID: id, Type: f.w.chats[id]})
	}
	return out, nil
}

func (f fakeBotRepo) ChatRecipients(_ context.Context, botID int64, chatIDs []int64, flt domain.BotRecipientFilter, limit int) ([]domain.BotRecipient, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	var out []domain.BotRecipient
	for _, id := range chatIDs {
		uids := make([]int64, 0, len(f.w.members[id]))
		for uid := range f.w.members[id] {
			uids = append(uids, uid)
		}
		sort.Slice(uids, func(a, b int) bool { return uids[a] < uids[b] })
		for _, uid := range uids {
			role := f.w.members[id][uid]
			staff := role == domain.RoleCreator || role == domain.RoleAdmin
			if uid == botID || f.w.isBot[uid] || (flt.UserID != 0 && uid != flt.UserID) || (flt.StaffOnly && !staff) {
				continue
			}
			if len(out) == limit {
				return out, nil
			}
			out = append(out, domain.BotRecipient{ChatID: id, UserID: uid, Staff: staff})
		}
	}
	return out, nil
}

func (f fakeBotRepo) GroupLists(_ context.Context, botID int64, chatIDs []int64) (domain.BotGroupLists, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	f.w.fetches[-1]++
	out := domain.BotGroupLists{
		Global: map[string][]domain.BotCommand{},
		Chat:   map[int64]map[string][]domain.BotCommand{},
		Member: map[int64]map[int64][]domain.BotCommand{},
	}
	for k, cs := range f.w.lists {
		if k.bot != botID || k.lang != "" || len(cs) == 0 {
			continue
		}
		switch k.scope.Type {
		case domain.BotScopeDefault, domain.BotScopeAllPrivateChats, domain.BotScopeAllGroupChats, domain.BotScopeAllChatAdmins:
			out.Global[k.scope.Type] = cs
		case domain.BotScopeChat, domain.BotScopeChatAdministrator:
			if slices.Contains(chatIDs, k.scope.ChatID) {
				if out.Chat[k.scope.ChatID] == nil {
					out.Chat[k.scope.ChatID] = map[string][]domain.BotCommand{}
				}
				out.Chat[k.scope.ChatID][k.scope.Type] = cs
			}
		case domain.BotScopeChatMember:
			if slices.Contains(chatIDs, k.scope.ChatID) {
				if out.Member[k.scope.ChatID] == nil {
					out.Member[k.scope.ChatID] = map[int64][]domain.BotCommand{}
				}
				out.Member[k.scope.ChatID][k.scope.UserID] = cs
			}
		}
	}
	return out, nil
}

func (f fakeBotRepo) ChatBotIDs(_ context.Context, chatID int64, limit int) ([]int64, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	var out []int64
	for uid := range f.w.members[chatID] {
		if f.w.isBot[uid] {
			out = append(out, uid)
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a] < out[b] })
	return out, nil
}

// fakeCmdAPI — fakeBotAPI с «таблицей» команд из botCmdWorld.
type fakeCmdAPI struct {
	*fakeBotAPI
	w       *botCmdWorld
	failSet error
}

func (f *fakeCmdAPI) SetCommands(_ context.Context, id int64, scope domain.BotCommandScope, lang string, cmds []domain.BotCommand) (bool, error) {
	if f.failSet != nil {
		return false, f.failSet
	}
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	scope.Type = scope.Norm()
	k := botCmdKey{id, scope, lang}
	if slices.Equal(f.w.lists[k], cmds) || (len(f.w.lists[k]) == 0 && len(cmds) == 0) {
		return false, nil
	}
	if len(cmds) == 0 {
		delete(f.w.lists, k)
		return true, nil
	}
	f.w.lists[k] = cmds
	return true, nil
}

func (f *fakeCmdAPI) DeleteCommands(_ context.Context, id int64, scope domain.BotCommandScope, lang string) (bool, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	scope.Type = scope.Norm()
	k := botCmdKey{id, scope, lang}
	_, had := f.w.lists[k]
	delete(f.w.lists, k)
	return had, nil
}

func (f *fakeCmdAPI) CommandsScoped(_ context.Context, id int64, scope domain.BotCommandScope, lang string) ([]domain.BotCommand, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	scope.Type = scope.Norm()
	return f.w.lists[botCmdKey{id, scope, lang}], nil
}

type botCmdEnv struct {
	in  *Interactor
	s   *store
	pub *fakePublisher
	w   *botCmdWorld
	api *fakeCmdAPI
	bot domain.BotAccount
}

// newBotCmdEnv: бот 42 с учёткой Bot API; топологию чатов задаёт тест.
func newBotCmdEnv(t *testing.T) *botCmdEnv {
	t.Helper()
	in, s := newInteractor()
	w := newBotCmdWorld()
	w.isBot[42] = true
	api := &fakeCmdAPI{fakeBotAPI: newFakeBotAPI(), w: w}
	bot := domain.BotAccount{BotID: 42, OwnerID: 1, Username: "cmd_bot", Name: "Бот"}
	api.bots[42] = bot
	pub := &fakePublisher{}
	in.SetBots(fakeBotRepo{w})
	in.SetBotAPI(api)
	in.SetPublisher(pub)
	return &botCmdEnv{in: in, s: s, pub: pub, w: w, api: api, bot: bot}
}

type botCmdRow struct {
	Peer     json.RawMessage `json:"peer"`
	BotID    int64           `json:"bot_id"`
	Commands []struct {
		Command string `json:"command"`
	} `json:"commands"`
}

// rows — строки журнала bot_commands пользователя: (ключ пира, команды).
func (e *botCmdEnv) rows(t *testing.T, uid int64) []struct {
	Peer domain.PeerID
	Cmds []string
} {
	t.Helper()
	var out []struct {
		Peer domain.PeerID
		Cmds []string
	}
	for _, u := range e.s.updates[uid] {
		if u.Type != "bot_commands" {
			continue
		}
		var body botCmdRow
		if err := json.Unmarshal(u.Payload, &body); err != nil {
			t.Fatalf("payload: %v", err)
		}
		var head struct {
			Underscore string `json:"_"`
		}
		_ = json.Unmarshal(u.Payload, &head)
		if head.Underscore != domain.UpdateBotCommandsTag {
			t.Fatalf("дискриминатор строки журнала = %q", head.Underscore)
		}
		peer, err := domain.UnmarshalPeer(body.Peer)
		if err != nil || peer == nil {
			t.Fatalf("peer: %v", err)
		}
		cmds := []string{}
		for _, c := range body.Commands {
			cmds = append(cmds, c.Command)
		}
		out = append(out, struct {
			Peer domain.PeerID
			Cmds []string
		}{domain.GetPeerID(peer), cmds})
		if body.BotID != 42 {
			t.Fatalf("bot_id = %d", body.BotID)
		}
	}
	return out
}

// chat заводит чат и в «таблице» команд, и в общем store (ChatType/IsMember).
func (e *botCmdEnv) chat(chatID int64, typ string, members map[int64]string) {
	e.w.addChat(chatID, typ, members)
	e.s.mu.Lock()
	defer e.s.mu.Unlock()
	e.s.chatType[chatID] = typ
	e.s.members[chatID] = map[int64]*member{}
	for uid := range members {
		e.s.members[chatID][uid] = &member{}
	}
}

func (e *botCmdEnv) set(t *testing.T, scope domain.BotCommandScope, lang string, cmds ...string) {
	t.Helper()
	var list []domain.BotCommand
	for _, c := range cmds {
		list = append(list, domain.BotCommand{Command: c, Description: c + " d"})
	}
	if err := e.in.BotSetCommands(context.Background(), e.bot, scope, lang, list); err != nil {
		t.Fatalf("BotSetCommands: %v", err)
	}
	e.in.bg.Wait() // рассылка идёт в фоне
}

func TestSetMyCommands_PrivatePartnerGetsUpdate(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})

	e.set(t, domain.BotCommandScope{}, "", "start", "help")

	rows := e.rows(t, 7)
	if len(rows) != 1 || rows[0].Peer != 42 || !reflect.DeepEqual(rows[0].Cmds, []string{"start", "help"}) {
		t.Fatalf("строка собеседника: %+v; want peerUser(42) [start help]", rows)
	}
	if len(e.rows(t, 42)) != 0 {
		t.Fatal("сам бот получил updateBotCommands")
	}
	// Живой кадр: {t, d, pts} — курсор в конверте, не в теле.
	var frame struct {
		T   string          `json:"t"`
		Pts int64           `json:"pts"`
		D   json.RawMessage `json:"d"`
	}
	var found bool
	for _, f := range e.pub.frames {
		if f.userID == 7 {
			found = true
			if err := json.Unmarshal(f.frame, &frame); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !found || frame.T != "bot_commands" || frame.Pts != e.s.pts[7] || frame.Pts == 0 {
		t.Fatalf("кадр: %+v (pts в журнале %d)", frame, e.s.pts[7])
	}
	var d map[string]any
	_ = json.Unmarshal(frame.D, &d)
	if _, inBody := d["pts"]; inBody {
		t.Fatalf("pts попал в тело updateBotCommands: %v", d)
	}
}

func TestSetMyCommands_BotFatherPathNotifiesToo(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.api.byOwner[1] = []int64{42}
	// BotFather сидит в чате владельца: пишет мастер /setcommands.
	e.w.isBot[domain.BotFatherID] = true
	ctx := context.Background()
	chatID, err := e.in.CreatePrivateChat(ctx, 1, domain.BotFatherID)
	if err != nil {
		t.Fatal(err)
	}
	e.in.botFatherReply(ctx, chatID, 1, "/setcommands")
	e.in.botFatherReply(ctx, chatID, 1, "start - запустить")
	e.in.bg.Wait()

	rows := e.rows(t, 7)
	if len(rows) != 1 || !reflect.DeepEqual(rows[0].Cmds, []string{"start"}) {
		t.Fatalf("после BotFather: %+v; want [start]", rows)
	}
}

func TestSetMyCommands_GroupBodiesByRole(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(200, domain.ChatTypeGroup, map[int64]string{
		1: domain.RoleCreator, 2: domain.RoleAdmin, 3: domain.RoleMember, 4: domain.RoleMember, 5: domain.RoleMember, 42: domain.RoleMember,
	})
	e.w.put(42, domain.BotCommandScope{Type: "all_group_chats"}, "", "group")
	e.w.put(42, domain.BotCommandScope{Type: "chat_administrators", ChatID: 200}, "", "adm")
	e.w.put(42, domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4}, "", "for4")

	e.set(t, domain.BotCommandScope{Type: "chat", ChatID: 200}, "", "chat")

	chatPeer := domain.ToPeerID(200, true)
	// Тело (а): список chat получают рядовые. Админам он перекрыт
	// chat_administrators, пользователю 4 — его записью chat_member: им кадр не нужен.
	for _, uid := range []int64{3, 5} {
		rows := e.rows(t, uid)
		if len(rows) != 1 || rows[0].Peer != chatPeer || !reflect.DeepEqual(rows[0].Cmds, []string{"chat"}) {
			t.Errorf("рядовой %d: %+v; want peerChannel(200) [chat]", uid, rows)
		}
	}
	for _, uid := range []int64{1, 2, 4} {
		if n := len(e.rows(t, uid)); n != 0 {
			t.Errorf("пользователь %d с перекрывающим списком получил %d строк; want 0", uid, n)
		}
	}
	// Одна выборка списков на все группы бота, а не запрос на чат.
	if n := e.w.fetches[-1]; n != 1 {
		t.Fatalf("выборок GroupLists: %d; want 1", n)
	}
	if n := e.w.fetches[200]; n != 0 {
		t.Fatalf("запросов команд на чат: %d; want 0", n)
	}

	// Тело (б): смена списка админов — только админам.
	e.set(t, domain.BotCommandScope{Type: "chat_administrators", ChatID: 200}, "", "adm2")
	for _, uid := range []int64{1, 2} {
		rows := e.rows(t, uid)
		if len(rows) != 1 || !reflect.DeepEqual(rows[0].Cmds, []string{"adm2"}) {
			t.Errorf("админ %d: %+v; want [adm2]", uid, rows)
		}
	}
	for _, uid := range []int64{3, 5} {
		if n := len(e.rows(t, uid)); n != 1 {
			t.Errorf("рядовой %d получил строку на смену списка админов: %d", uid, n)
		}
	}

	// Тело (в): смена записи chat_member — ровно одному её владельцу.
	e.set(t, domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4}, "", "for4_v2")
	rows := e.rows(t, 4)
	if len(rows) != 1 || !reflect.DeepEqual(rows[0].Cmds, []string{"for4_v2"}) {
		t.Fatalf("пользователь 4: %+v; want [for4_v2]", rows)
	}
	for _, uid := range []int64{1, 2, 3, 5} {
		if n := len(e.rows(t, uid)); n > 1 {
			t.Errorf("пользователь %d получил лишнюю строку после chat_member другого: %d", uid, n)
		}
	}
}

// Тот же список повторно (рестарт бота) и deleteMyCommands несуществующего
// скоупа — не изменение: ни строк журнала, ни кадров.
func TestSetMyCommands_UnchangedSendsNothing(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.set(t, domain.BotCommandScope{}, "", "start")
	e.set(t, domain.BotCommandScope{}, "", "start")
	if n := len(e.rows(t, 7)); n != 1 {
		t.Fatalf("повторный setMyCommands дал строку: %d; want 1", n)
	}
	if err := e.in.BotDeleteCommands(context.Background(), e.bot, domain.BotCommandScope{Type: "all_private_chats"}, ""); err != nil {
		t.Fatal(err)
	}
	e.in.bg.Wait()
	if n := len(e.rows(t, 7)); n != 1 {
		t.Fatalf("deleteMyCommands несуществующего скоупа дал строку: %d; want 1", n)
	}
}

// Параллельные изменения одного бота сворачиваются: рассылка одна, повторный
// проход по свежему состоянию — последним у получателя остаётся актуальный список.
func TestSetMyCommands_ConcurrentChangesEndOnLatest(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	ctx := context.Background()
	for _, c := range []string{"a", "b", "c", "d", "e"} {
		if err := e.in.BotSetCommands(ctx, e.bot, domain.BotCommandScope{}, "", []domain.BotCommand{{Command: c}}); err != nil {
			t.Fatal(err)
		}
	}
	e.in.bg.Wait()
	rows := e.rows(t, 7)
	if len(rows) == 0 || !reflect.DeepEqual(rows[len(rows)-1].Cmds, []string{"e"}) {
		t.Fatalf("последняя строка получателя: %+v; want [e]", rows)
	}
}

func TestSetMyCommands_ChatScopeNarrowsRecipients(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.chat(200, domain.ChatTypeGroup, map[int64]string{3: domain.RoleMember, 42: domain.RoleMember})
	e.chat(201, domain.ChatTypeGroup, map[int64]string{6: domain.RoleMember, 42: domain.RoleMember})

	e.set(t, domain.BotCommandScope{Type: "chat", ChatID: 200}, "", "only200")
	if len(e.rows(t, 3)) != 1 || len(e.rows(t, 6)) != 0 || len(e.rows(t, 7)) != 0 {
		t.Fatalf("скоуп чата 200 разослан шире: 3=%d 6=%d 7=%d", len(e.rows(t, 3)), len(e.rows(t, 6)), len(e.rows(t, 7)))
	}

	e.set(t, domain.BotCommandScope{Type: "all_private_chats"}, "", "pm")
	if len(e.rows(t, 7)) != 1 || len(e.rows(t, 3)) != 1 || len(e.rows(t, 6)) != 0 {
		t.Fatalf("all_private_chats тронул группы: 3=%d 6=%d 7=%d", len(e.rows(t, 3)), len(e.rows(t, 6)), len(e.rows(t, 7)))
	}
}

func TestSetMyCommands_BroadcastChannelSkipped(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(300, domain.ChatTypeChannel, map[int64]string{8: domain.RoleMember, 42: domain.RoleAdmin})
	e.set(t, domain.BotCommandScope{}, "", "start")
	if len(e.rows(t, 8)) != 0 {
		t.Fatal("подписчик broadcast-канала получил updateBotCommands")
	}
}

func TestSetMyCommands_LanguageSpecificListIsNotBroadcast(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.set(t, domain.BotCommandScope{}, "ru", "privet")
	if len(e.rows(t, 7)) != 0 {
		t.Fatal("список для языка ru разослан пользователям без языка")
	}
	if n := e.w.fetches[0] + e.w.fetches[-1]; n != 0 {
		t.Fatalf("лишние выборки команд: %d", n)
	}
}

func TestSetMyCommands_OverLimitIsAllOrNothing(t *testing.T) {
	e := newBotCmdEnv(t)
	e.in.botCommandsLimit = 2
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.chat(200, domain.ChatTypeGroup, map[int64]string{3: domain.RoleMember, 4: domain.RoleMember, 42: domain.RoleMember})

	e.set(t, domain.BotCommandScope{}, "", "start") // участников: 1+2 (без бота) + бот в счёте = больше 2
	for _, uid := range []int64{7, 3, 4} {
		if n := len(e.rows(t, uid)); n != 0 {
			t.Fatalf("сверх предела пользователь %d получил %d строк; want 0", uid, n)
		}
	}
	if len(e.pub.frames) != 0 {
		t.Fatalf("сверх предела ушли кадры: %d", len(e.pub.frames))
	}
	// Сам список при этом сохранён: новые карточки возьмут его из бэка.
	got, _ := e.in.BotGetCommands(context.Background(), e.bot, domain.BotCommandScope{}, "")
	if len(got) != 1 {
		t.Fatalf("список не сохранён: %v", got)
	}
}

func TestDeleteMyCommands_FallsBackAndNotifies(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.w.put(42, domain.BotCommandScope{Type: "default"}, "", "start")
	e.set(t, domain.BotCommandScope{Type: "all_private_chats"}, "", "pm")

	if err := e.in.BotDeleteCommands(context.Background(), e.bot, domain.BotCommandScope{Type: "all_private_chats"}, ""); err != nil {
		t.Fatal(err)
	}
	e.in.bg.Wait()
	rows := e.rows(t, 7)
	if len(rows) != 2 || !reflect.DeepEqual(rows[1].Cmds, []string{"start"}) {
		t.Fatalf("после deleteMyCommands: %+v; want вторая строка [start]", rows)
	}
	if got, _ := e.in.BotGetCommands(context.Background(), e.bot, domain.BotCommandScope{Type: "all_private_chats"}, ""); len(got) != 0 && got[0].Command == "pm" {
		t.Fatalf("список не снят: %v", got)
	}
}

func TestSetMyCommands_StoreFailureSendsNothing(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.api.failSet = errors.New("db down")
	err := e.in.BotSetCommands(context.Background(), e.bot, domain.BotCommandScope{}, "", []domain.BotCommand{{Command: "a"}})
	if err == nil || len(e.rows(t, 7)) != 0 {
		t.Fatalf("err=%v rows=%d; want ошибка и ни одной строки", err, len(e.rows(t, 7)))
	}
}

func TestSetMyCommands_ListValidation(t *testing.T) {
	e := newBotCmdEnv(t)
	long := make([]byte, 257)
	for i := range long {
		long[i] = 'x'
	}
	many := make([]domain.BotCommand, 101)
	for i := range many {
		many[i] = domain.BotCommand{Command: "c" + string(rune('a'+i%26)) + string(rune('a'+i/26))}
	}
	for name, cmds := range map[string][]domain.BotCommand{
		"заглавные":        {{Command: "Start"}},
		"пробел":           {{Command: "a b"}},
		"пустое имя":       {{Command: ""}},
		"длинное имя":      {{Command: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},
		"длинное описание": {{Command: "ok", Description: string(long)}},
		"дубль":            {{Command: "a"}, {Command: "a"}},
		"больше ста":       many,
	} {
		if err := e.in.BotSetCommands(context.Background(), e.bot, domain.BotCommandScope{}, "", cmds); !errors.Is(err, domain.ErrInvalid) {
			t.Errorf("%s: err = %v; want ErrInvalid", name, err)
		}
	}
	for _, lang := range []string{"RU", "rus", "r1", "r"} {
		if err := e.in.BotSetCommands(context.Background(), e.bot, domain.BotCommandScope{}, lang, []domain.BotCommand{{Command: "a"}}); !errors.Is(err, domain.ErrInvalid) {
			t.Errorf("язык %q: err = %v; want ErrInvalid", lang, err)
		}
	}
}

func TestSetMyCommands_ScopeValidation(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(200, domain.ChatTypeGroup, map[int64]string{3: domain.RoleMember, 42: domain.RoleMember})
	for name, sc := range map[string]domain.BotCommandScope{
		"неизвестный тип":      {Type: "everyone"},
		"chat без чата":        {Type: "chat"},
		"chat_member без user": {Type: "chat_member", ChatID: 200},
		"default с чатом":      {Type: "default", ChatID: 200},
	} {
		if err := e.in.BotSetCommands(context.Background(), e.bot, sc, "", nil); !errors.Is(err, domain.ErrInvalid) {
			t.Errorf("%s: err = %v; want ErrInvalid", name, err)
		}
	}
}

// BotInfo — карточка бота для профиля: описание, команды скоупа лички, about.
func TestBotInfo_ProfileDescriptionAndCommands(t *testing.T) {
	e := newBotCmdEnv(t)
	acc := e.bot
	acc.Description, acc.About, acc.MenuButtonText, acc.MenuButtonURL = "Что умеет бот", "О боте", "Меню", "https://app"
	e.api.bots[42] = acc
	e.w.put(42, domain.BotCommandScope{Type: "default"}, "", "start")
	e.w.put(42, domain.BotCommandScope{Type: "all_private_chats"}, "", "pm")
	e.w.put(42, domain.BotCommandScope{Type: "all_group_chats"}, "", "group")

	info, about, err := e.in.BotInfo(context.Background(), 42, 7)
	if err != nil || info == nil {
		t.Fatalf("BotInfo: %v %v", info, err)
	}
	if info.UserID != 42 || info.Description != "Что умеет бот" || about != "О боте" {
		t.Fatalf("info=%+v about=%q", info, about)
	}
	if len(info.Commands) != 1 || info.Commands[0].Command != "pm" {
		t.Fatalf("команды лички: %+v; want [pm]", info.Commands)
	}
	if info.MenuButton == nil || info.MenuButton.URL != "https://app" {
		t.Fatalf("menu_button: %+v", info.MenuButton)
	}

	// Бот без учётки Bot API (демо-бот): карточка есть, описания нет.
	e.w.isBot[424242] = true
	e.w.put(424242, domain.BotCommandScope{Type: "default"}, "", "demo")
	info, about, err = e.in.BotInfo(context.Background(), 424242, 7)
	if err != nil || info == nil || info.Description != "" || about != "" || len(info.Commands) != 1 {
		t.Fatalf("демо-бот: %+v %q %v", info, about, err)
	}
}

// ChatFullContainer: боты-участники группы в bot_info, карточки ботов в users.
func TestChatFullContainer_BotInfoOfGroupBots(t *testing.T) {
	in, fg, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	w := newBotCmdWorld()
	in.SetBots(fakeBotRepo{w})
	fg.users[42] = domain.NewUser(42, domain.UserFlags{Bot: true})
	fg.users[7] = domain.UserReal{ID: 7, FirstName: "Алиса"}
	fg.users[8] = domain.UserReal{ID: 8, FirstName: "Боб"}

	gid, _, err := in.CreateGroup(ctx, 7, "Группа", "", "", false, []int64{8})
	if err != nil {
		t.Fatal(err)
	}
	// Группа без ботов: bot_info — пустой вектор.
	w.addChat(gid, domain.ChatTypeGroup, map[int64]string{7: domain.RoleCreator, 8: domain.RoleMember})
	out, err := in.ChatFullContainer(ctx, gid, 8)
	if err != nil {
		t.Fatal(err)
	}
	if out.FullChat.BotInfo == nil || len(out.FullChat.BotInfo) != 0 {
		t.Fatalf("группа без ботов: bot_info = %#v; want []", out.FullChat.BotInfo)
	}

	// Бот вступил: рядовой видит chat-список, админ — chat_administrators.
	_ = fg.AddMember(ctx, gid, 42, domain.RoleMember, 0)
	w.addChat(gid, domain.ChatTypeGroup, map[int64]string{7: domain.RoleCreator, 8: domain.RoleMember, 42: domain.RoleMember})
	w.isBot[42] = true
	w.put(42, domain.BotCommandScope{Type: "all_group_chats"}, "", "group")
	w.put(42, domain.BotCommandScope{Type: "chat_administrators", ChatID: gid}, "", "adm")

	out, err = in.ChatFullContainer(ctx, gid, 8)
	if err != nil {
		t.Fatal(err)
	}
	bi := out.FullChat.BotInfo
	if len(bi) != 1 || bi[0].UserID != 42 || len(bi[0].Commands) != 1 || bi[0].Commands[0].Command != "group" {
		t.Fatalf("рядовой: bot_info = %+v; want [{42 [group]}]", bi)
	}
	hasBot := false
	for _, u := range out.Users {
		hasBot = hasBot || u.ID == 42
	}
	if !hasBot {
		t.Fatalf("карточка бота не в users: %+v", out.Users)
	}

	out, err = in.ChatFullContainer(ctx, gid, 7)
	if err != nil {
		t.Fatal(err)
	}
	if bi := out.FullChat.BotInfo; len(bi) != 1 || bi[0].Commands[0].Command != "adm" {
		t.Fatalf("создатель: bot_info = %+v; want [adm]", bi)
	}
}

// Изменения, пришедшие, пока рассылка идёт, проходятся каждое по своему скоупу:
// запись chat_member одного пользователя не теряется в общем «default».
func TestSetMyCommands_ScopesQueuedDuringFanoutAreAllDelivered(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.chat(200, domain.ChatTypeGroup, map[int64]string{3: domain.RoleMember, 4: domain.RoleMember, 42: domain.RoleMember})
	e.chat(201, domain.ChatTypeGroup, map[int64]string{6: domain.RoleMember, 42: domain.RoleMember})
	gate := make(chan struct{})
	e.w.gate = gate
	ctx := context.Background()
	set := func(scope domain.BotCommandScope, cmd string) {
		if err := e.in.BotSetCommands(ctx, e.bot, scope, "", []domain.BotCommand{{Command: cmd}}); err != nil {
			t.Fatal(err)
		}
	}
	set(domain.BotCommandScope{}, "base")                                             // рассылка стартует и ждёт ворота
	set(domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4}, "mine")  // встаёт в очередь
	set(domain.BotCommandScope{Type: "chat", ChatID: 201}, "only201")                 // встаёт в очередь
	set(domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4}, "mine2") // тот же скоуп другим списком: проход не плодится
	close(gate)
	e.in.bg.Wait()

	last := func(uid int64) []string {
		rows := e.rows(t, uid)
		if len(rows) == 0 {
			return nil
		}
		return rows[len(rows)-1].Cmds
	}
	if got := last(4); !reflect.DeepEqual(got, []string{"mine2"}) {
		t.Fatalf("владелец chat_member: %v; want [mine2]", got)
	}
	if got := last(6); !reflect.DeepEqual(got, []string{"only201"}) {
		t.Fatalf("участник чата 201: %v; want [only201]", got)
	}
	if got := last(3); !reflect.DeepEqual(got, []string{"base"}) {
		t.Fatalf("рядовой чата 200: %v; want [base]", got)
	}
	if got := last(7); !reflect.DeepEqual(got, []string{"base"}) {
		t.Fatalf("личка: %v; want [base]", got)
	}
	// Базовый проход его не касается (своя запись важнее), своя — ровно одна строка.
	if n := len(e.rows(t, 4)); n != 1 {
		t.Fatalf("у владельца chat_member строк %d; want 1", n)
	}
}

// Паника в рассылке не оставляет бота «в рассылке» навсегда.
func TestSetMyCommands_PanicInFanoutDoesNotWedgeBot(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.w.panicOnce = true
	e.set(t, domain.BotCommandScope{}, "", "first")
	if n := len(e.rows(t, 7)); n != 0 {
		t.Fatalf("после паники строк %d; want 0", n)
	}
	e.set(t, domain.BotCommandScope{}, "", "second")
	if rows := e.rows(t, 7); len(rows) != 1 || !reflect.DeepEqual(rows[0].Cmds, []string{"second"}) {
		t.Fatalf("после паники рассылка не работает: %+v", rows)
	}
}

// Удаление chat_member возвращает владельцу тело (а)/(б).
func TestDeleteMyCommands_ChatMemberFallsBackToRoleBody(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(200, domain.ChatTypeGroup, map[int64]string{1: domain.RoleAdmin, 4: domain.RoleMember, 42: domain.RoleMember})
	e.w.put(42, domain.BotCommandScope{Type: "chat", ChatID: 200}, "", "chat")
	e.w.put(42, domain.BotCommandScope{Type: "chat_administrators", ChatID: 200}, "", "adm")
	e.w.put(42, domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4}, "", "mine")
	e.w.put(42, domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 1}, "", "mine_adm")

	for _, uid := range []int64{1, 4} {
		if err := e.in.BotDeleteCommands(context.Background(), e.bot, domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: uid}, ""); err != nil {
			t.Fatal(err)
		}
	}
	e.in.bg.Wait()
	if rows := e.rows(t, 4); len(rows) != 1 || !reflect.DeepEqual(rows[0].Cmds, []string{"chat"}) {
		t.Fatalf("рядовой после снятия записи: %+v; want [chat]", rows)
	}
	if rows := e.rows(t, 1); len(rows) != 1 || !reflect.DeepEqual(rows[0].Cmds, []string{"adm"}) {
		t.Fatalf("админ после снятия записи: %+v; want [adm]", rows)
	}
}

// Смена скоупа, который у получателя перекрыт более важным, кадра не даёт.
func TestSetMyCommands_ShadowedScopeSendsNothing(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.chat(200, domain.ChatTypeGroup, map[int64]string{1: domain.RoleAdmin, 3: domain.RoleMember, 42: domain.RoleMember})
	e.w.put(42, domain.BotCommandScope{Type: "all_private_chats"}, "", "pm")
	e.w.put(42, domain.BotCommandScope{Type: "all_group_chats"}, "", "group")
	e.w.put(42, domain.BotCommandScope{Type: "chat", ChatID: 200}, "", "chat")

	e.set(t, domain.BotCommandScope{Type: "default"}, "", "def")
	for _, uid := range []int64{7, 1, 3} {
		if n := len(e.rows(t, uid)); n != 0 {
			t.Fatalf("default перекрыт, а пользователь %d получил %d строк", uid, n)
		}
	}
	// all_group_chats перекрыт chat(200) у обоих, а в личке его нет вовсе.
	e.set(t, domain.BotCommandScope{Type: "all_group_chats"}, "", "group2")
	if n := len(e.rows(t, 3)) + len(e.rows(t, 1)) + len(e.rows(t, 7)); n != 0 {
		t.Fatalf("all_group_chats перекрыт chat(200): строк %d", n)
	}
	// chat(200) побеждает у рядового — кадр есть; админу не нужен, если у него chat_administrators.
	e.w.put(42, domain.BotCommandScope{Type: "chat_administrators", ChatID: 200}, "", "adm")
	e.set(t, domain.BotCommandScope{Type: "chat", ChatID: 200}, "", "chat2")
	if len(e.rows(t, 3)) != 1 || len(e.rows(t, 1)) != 0 {
		t.Fatalf("chat(200): рядовой %d строк (want 1), админ %d (want 0)", len(e.rows(t, 3)), len(e.rows(t, 1)))
	}
}

// Переполнение очереди: адресные скоупы схлопываются до «пересчитать чат», но не
// до прохода по всем чатам бота — у бота сверх предела узкие изменения доходят.
func TestSetMyCommands_QueueOverflowKeepsNarrowChanges(t *testing.T) {
	old := botFanoutPendingMax
	botFanoutPendingMax = 1
	t.Cleanup(func() { botFanoutPendingMax = old })

	e := newBotCmdEnv(t)
	e.in.botCommandsLimit = 3 // у бота «сверх предела»: проход по всем чатам ничего не шлёт
	e.chat(100, domain.ChatTypePrivate, map[int64]string{7: "member", 42: "member"})
	e.chat(200, domain.ChatTypeGroup, map[int64]string{3: domain.RoleMember, 4: domain.RoleMember, 42: domain.RoleMember})
	e.chat(201, domain.ChatTypeGroup, map[int64]string{6: domain.RoleMember, 42: domain.RoleMember})
	e.chat(202, domain.ChatTypeGroup, map[int64]string{8: domain.RoleMember, 42: domain.RoleMember})
	e.chat(203, domain.ChatTypeGroup, map[int64]string{9: domain.RoleMember, 42: domain.RoleMember})
	gate := make(chan struct{})
	e.w.gate = gate
	ctx := context.Background()
	set := func(scope domain.BotCommandScope, cmd string) {
		if err := e.in.BotSetCommands(ctx, e.bot, scope, "", []domain.BotCommand{{Command: cmd}}); err != nil {
			t.Fatal(err)
		}
	}
	set(domain.BotCommandScope{}, "base") // старт прохода, ждёт ворота
	set(domain.BotCommandScope{Type: "chat", ChatID: 201}, "c201")
	set(domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4}, "mine")
	set(domain.BotCommandScope{Type: "chat", ChatID: 202}, "c202")
	close(gate)
	e.in.bg.Wait()

	last := func(uid int64) []string {
		rows := e.rows(t, uid)
		if len(rows) == 0 {
			return nil
		}
		return rows[len(rows)-1].Cmds
	}
	for uid, want := range map[int64][]string{6: {"c201"}, 4: {"mine"}, 8: {"c202"}} {
		if got := last(uid); !reflect.DeepEqual(got, want) {
			t.Errorf("пользователь %d: %v; want %v", uid, got, want)
		}
	}
	if len(e.rows(t, 9)) != 0 {
		t.Error("чат без изменений получил кадр")
	}
}

// Запись chat_member вышедшего из группы пользователя снимается: членство при
// удалении не проверяется (иначе запись осталась бы навсегда).
func TestDeleteMyCommands_ChatMemberOfDepartedUser(t *testing.T) {
	e := newBotCmdEnv(t)
	e.chat(200, domain.ChatTypeGroup, map[int64]string{3: domain.RoleMember, 42: domain.RoleMember})
	scope := domain.BotCommandScope{Type: "chat_member", ChatID: 200, UserID: 4} // 4 уже не в группе
	e.w.put(42, scope, "", "stale")
	if err := e.in.BotDeleteCommands(context.Background(), e.bot, scope, ""); err != nil {
		t.Fatalf("удаление записи вышедшего: %v", err)
	}
	e.in.bg.Wait()
	if got, _ := e.in.BotGetCommands(context.Background(), e.bot, scope, ""); len(got) != 0 {
		t.Fatalf("запись не снята: %v", got)
	}
	if err := e.in.BotSetCommands(context.Background(), e.bot, scope, "", []domain.BotCommand{{Command: "x"}}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("запись для не-участника: %v; want ErrInvalid", err)
	}
	if n := len(e.rows(t, 3)); n != 0 {
		t.Fatalf("рядовой получил кадр на чужую запись: %d", n)
	}
}

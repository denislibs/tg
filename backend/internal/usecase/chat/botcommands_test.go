package chat

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
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
	// fetches — выборки команд (CommandsFor*, ChatMemberCommands) по чатам.
	fetches map[int64]int
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

func (f fakeBotRepo) BotChats(_ context.Context, botID int64, limit int) ([]domain.BotChat, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	var ids []int64
	for chatID, ms := range f.w.members {
		if _, ok := ms[botID]; ok {
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

func (f fakeBotRepo) CountChatMembers(_ context.Context, chatIDs []int64, limit int) (int, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	n := 0
	for _, id := range chatIDs {
		n += len(f.w.members[id])
	}
	return min(n, limit), nil
}

func (f fakeBotRepo) ChatRecipients(_ context.Context, botID int64, chatIDs []int64) ([]domain.BotRecipient, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	var out []domain.BotRecipient
	for _, id := range chatIDs {
		for uid, role := range f.w.members[id] {
			if uid == botID {
				continue
			}
			out = append(out, domain.BotRecipient{ChatID: id, UserID: uid, Staff: role == domain.RoleCreator || role == domain.RoleAdmin})
		}
	}
	return out, nil
}

func (f fakeBotRepo) ChatMemberCommands(_ context.Context, botID, chatID int64) (map[int64][]domain.BotCommand, error) {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	f.w.fetches[chatID]++
	out := map[int64][]domain.BotCommand{}
	for k, cs := range f.w.lists {
		if k.bot == botID && k.scope.Type == domain.BotScopeChatMember && k.scope.ChatID == chatID && k.lang == "" && len(cs) > 0 {
			out[k.scope.UserID] = cs
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

func (f *fakeCmdAPI) SetCommands(_ context.Context, id int64, scope domain.BotCommandScope, lang string, cmds []domain.BotCommand) error {
	if f.failSet != nil {
		return f.failSet
	}
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	scope.Type = scope.Norm()
	if len(cmds) == 0 {
		delete(f.w.lists, botCmdKey{id, scope, lang})
		return nil
	}
	f.w.lists[botCmdKey{id, scope, lang}] = cmds
	return nil
}

func (f *fakeCmdAPI) DeleteCommands(_ context.Context, id int64, scope domain.BotCommandScope, lang string) error {
	f.w.mu.Lock()
	defer f.w.mu.Unlock()
	scope.Type = scope.Norm()
	delete(f.w.lists, botCmdKey{id, scope, lang})
	return nil
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
	want := map[int64][]string{1: {"adm"}, 2: {"adm"}, 3: {"chat"}, 4: {"for4"}, 5: {"chat"}}
	for uid, cmds := range want {
		rows := e.rows(t, uid)
		if len(rows) != 1 || rows[0].Peer != chatPeer || !reflect.DeepEqual(rows[0].Cmds, cmds) {
			t.Errorf("пользователь %d: %+v; want peerChannel(200) %v", uid, rows, cmds)
		}
	}
	// Не больше трёх выборок команд на чат: (а), (б) и записи chat_member.
	if n := e.w.fetches[200]; n > 3 {
		t.Fatalf("выборок команд на чат: %d; want <= 3", n)
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
	if n := e.w.fetches[0]; n != 0 {
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

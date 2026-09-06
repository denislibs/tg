package demoseed

import (
	"context"
	"testing"
)

// demoUsers — «юзернейм → id» для всех, кого поминают спеки демо-контента:
// список пользователей стенда живёт в postgres.SeedDemo, а сиду важно только,
// что каждый упомянутый им автор существует.
func demoUsers() map[string]int64 {
	users := map[string]int64{}
	add := func(name string) {
		if name == "" {
			return
		}
		if _, ok := users[name]; !ok {
			users[name] = int64(len(users) + 1)
		}
	}
	for _, c := range channels {
		add(c.creator)
		if c.discussion != nil {
			for _, cm := range c.discussion.comments {
				add(cm.author)
			}
		}
	}
	for _, g := range groups {
		add(g.creator)
		for _, name := range g.members {
			add(name)
		}
		for _, name := range g.lateJoin {
			add(name)
		}
		for _, r := range g.script {
			add(r.author)
		}
	}
	return users
}

// postSpecByKey — пост спеки по его КЛЮЧУ (не по позиции в срезе): им спека
// адресует пост из comment.post и pinKey.
func postSpecByKey(t *testing.T, spec channelSpec, key int) post {
	t.Helper()
	for _, p := range spec.posts {
		if p.key == key {
			return p
		}
	}
	t.Fatalf("в спеке канала %q нет поста с ключом %d", spec.title, key)
	return post{}
}

// channelWithDiscussion — единственный канал спеки, у которого заведено
// обсуждение: без него футер комментариев не появляется ни под одним постом.
func channelWithDiscussion(t *testing.T) channelSpec {
	t.Helper()
	var found []channelSpec
	for _, c := range channels {
		if c.discussion != nil {
			found = append(found, c)
		}
	}
	if len(found) != 1 {
		t.Fatalf("каналов с обсуждением в спеке: %d, ожидался ровно 1", len(found))
	}
	return found[0]
}

// seedOldVersion прогоняет сид спекой БЕЗ обсуждений — ровно то состояние, в
// котором стенд оставила версия сида, которая про обсуждения ещё не знала.
func seedOldVersion(t *testing.T, f *fakeChat, users map[string]int64) {
	t.Helper()
	orig := channels
	defer func() { channels = orig }()
	old := make([]channelSpec, len(channels))
	copy(old, channels)
	for i := range old {
		old[i].discussion = nil
	}
	channels = old
	seed(context.Background(), f, nil, users)
}

// checkComments — комментарии спеки сели на свои посты, в порядке спеки, от
// своих авторов и в группу обсуждения канала.
func checkComments(t *testing.T, f *fakeChat, ch *fakeChatRec, spec channelSpec, users map[string]int64) {
	t.Helper()
	type want struct {
		text   string
		author int64
	}
	expected := map[int][]want{}
	for _, cm := range spec.discussion.comments {
		expected[cm.post] = append(expected[cm.post], want{cm.text, users[cm.author]})
	}
	for postKey, wants := range expected {
		text, _ := compose(postSpecByKey(t, spec, postKey).body)
		post := f.postByText(ch.id, text)
		if post == nil {
			t.Fatalf("пост %d канала %q не найден", postKey, spec.title)
		}
		got := f.commentsOn(post.id)
		if len(got) != len(wants) {
			t.Fatalf("пост %d: комментариев %d, ожидалось %d", postKey, len(got), len(wants))
		}
		for i, w := range wants {
			if got[i].text != w.text {
				t.Fatalf("пост %d, комментарий %d: текст %q, ожидался %q", postKey, i, got[i].text, w.text)
			}
			if got[i].senderID != w.author {
				t.Fatalf("пост %d, комментарий %d: автор %d, ожидался %d", postKey, i, got[i].senderID, w.author)
			}
			if got[i].chatID != f.discussion[ch.id] {
				t.Fatalf("пост %d, комментарий %d лёг в чат %d, а не в группу обсуждения", postKey, i, got[i].chatID)
			}
		}
	}
}

func TestSeed_DiscussionLinkedToChannel(t *testing.T) {
	f := newFakeChat()
	seed(context.Background(), f, nil, demoUsers())

	spec := channelWithDiscussion(t)
	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("канал %q не создан", spec.title)
	}
	if len(f.discussion) != 1 {
		t.Fatalf("привязок канал↔обсуждение: %d, ожидалась 1", len(f.discussion))
	}
	groupID := f.discussion[ch.id]
	if groupID == 0 {
		t.Fatalf("у канала %q нет привязанной группы обсуждения", spec.title)
	}
	g := f.chats[groupID]
	if g.typ != "group" {
		t.Fatalf("обсуждение %q имеет тип %q, ожидался group", g.title, g.typ)
	}
	if g.title != spec.discussion.title {
		t.Fatalf("название группы обсуждения %q, ожидалось %q", g.title, spec.discussion.title)
	}
	if g.creator != ch.creator {
		t.Fatalf("группу обсуждения завёл %d, а канал — %d", g.creator, ch.creator)
	}
	// Привязанная группа обсуждения в списке диалогов НЕ ПОКАЗЫВАЕТСЯ (правило
	// прода, chatsrepo.ListDialogs): доступ к ней только через тред. Поэтому
	// искать её по названию сид и не имеет права — ключ привязки один,
	// chats.discussion_chat_id.
	dialogs, err := f.ListDialogs(context.Background(), ch.creator)
	if err != nil {
		t.Fatalf("ListDialogs: %v", err)
	}
	for _, d := range dialogs {
		if d.ChatID == groupID {
			t.Fatalf("группа обсуждения %q попала в список диалогов автора", d.Title)
		}
	}

	// Привязка обязана состояться ДО постов: зеркало (корень треда) рождается
	// на вставке поста, и у канала с обсуждением зеркало есть у КАЖДОГО поста,
	// а не только у прокомментированных.
	for _, p := range spec.posts {
		text, _ := compose(p.body)
		post := f.postByText(ch.id, text)
		if post == nil {
			t.Fatalf("пост %d канала %q не найден", p.key, spec.title)
		}
		if f.mirrorOfPost(post.id) == 0 {
			t.Fatalf("у поста %d канала %q нет зеркала в группе обсуждения", p.key, spec.title)
		}
	}
}

func TestSeed_CommentsAttachedToTheirPosts(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	seed(context.Background(), f, nil, users)

	spec := channelWithDiscussion(t)
	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("канал %q не создан", spec.title)
	}
	checkComments(t, f, ch, spec, users)

	// Футер поста рисует стек последних комментаторов (RecentRepliersLimit = 3),
	// поэтому хотя бы у одного поста комментаторов должно быть три разных —
	// иначе стек на стенде не проверить.
	maxAuthors := 0
	for _, cm := range spec.discussion.comments {
		text, _ := compose(postSpecByKey(t, spec, cm.post).body)
		post := f.postByText(ch.id, text)
		seen := map[int64]bool{}
		for _, m := range f.commentsOn(post.id) {
			seen[m.senderID] = true
		}
		if len(seen) > maxAuthors {
			maxAuthors = len(seen)
		}
	}
	if maxAuthors < 3 {
		t.Fatalf("максимум разных комментаторов на посте: %d, для стека аватарок нужно ≥3", maxAuthors)
	}
}

// Сид ДОЗАВОДИТ недостающее уже засеянному чату: канал, заведённый версией без
// обсуждения (ровно так выглядит живой стенд), получает и привязку обсуждения,
// и комментарии — гвард по названию канала отсекал бы его целиком.
func TestSeed_BackfillsDiscussionIntoSeededChannel(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	spec := channelWithDiscussion(t)

	seedOldVersion(t, f, users)

	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("старый сид не завёл канал %q", spec.title)
	}
	if len(f.discussion) != 0 {
		t.Fatalf("старый сид завёл обсуждений: %d, ожидалось 0", len(f.discussion))
	}
	chats, msgs, reacts := len(f.chats), len(f.msgOrder), f.reactCalls

	seed(context.Background(), f, nil, users)

	discID := f.discussion[ch.id]
	if discID == 0 {
		t.Fatalf("обсуждение не привязано к уже засеянному каналу %q", spec.title)
	}
	if got := f.chats[discID].title; got != spec.discussion.title {
		t.Fatalf("привязана группа %q, ожидалась %q", got, spec.discussion.title)
	}
	if got := len(f.chats); got != chats+1 {
		t.Fatalf("чатов %d, ожидалось %d (только новая группа обсуждения)", got, chats+1)
	}
	checkComments(t, f, ch, spec, users)

	// Ничего, кроме комментариев и зеркал их постов, не добавилось: посты,
	// подписки, закрепления и реакции у канала уже были.
	commented := map[int]bool{}
	for _, cm := range spec.discussion.comments {
		commented[cm.post] = true
	}
	want := msgs + len(spec.discussion.comments) + len(commented)
	if got := len(f.msgOrder); got != want {
		t.Fatalf("сообщений %d, ожидалось %d (было %d + %d комментариев + %d зеркал)",
			got, want, msgs, len(spec.discussion.comments), len(commented))
	}
	if f.reactCalls != reacts {
		t.Fatalf("реакции переставлены заново: вызовов %d, было %d", f.reactCalls, reacts)
	}

	// Честная граница бэкфилла: зеркало поста (корень треда, он же условие
	// футера комментариев) рождается на вставке поста и только при уже
	// привязанном обсуждении. Посты канала опубликованы РАНЬШЕ привязки,
	// поэтому зеркало дозаводит первый комментарий — и футер появляется только
	// под прокомментированными постами, а не под всеми.
	for _, p := range spec.posts {
		text, _ := compose(p.body)
		post := f.postByText(ch.id, text)
		if post == nil {
			t.Fatalf("пост %d канала %q не найден", p.key, spec.title)
		}
		if got := f.mirrorOfPost(post.id) != 0; got != commented[p.key] {
			t.Fatalf("пост %d: зеркало есть=%v, ожидалось %v (прокомментирован=%v)",
				p.key, got, commented[p.key], commented[p.key])
		}
	}
}

// Пополнение спеки доезжает до уже засеянного стенда: новый комментарий
// добавляется в тред, а не теряется вместе со всем каналом.
func TestSeed_BackfillsNewSpecCommentIntoSeededChannel(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	seed(ctx, f, nil, users)

	spec := channelWithDiscussion(t)
	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("канал %q не создан", spec.title)
	}
	// Пост, к которому в спеке комментариев ещё нет (адресуется КЛЮЧОМ).
	const postKey = 2
	for _, cm := range spec.discussion.comments {
		if cm.post == postKey {
			t.Fatalf("пост %d уже прокомментирован спекой — для пина нужен чистый", postKey)
		}
	}
	msgs := len(f.msgOrder)

	const text = "Комментарий, которого в спеке раньше не было."
	orig := channels
	defer func() { channels = orig }()
	grown := make([]channelSpec, len(channels))
	copy(grown, channels)
	for i := range grown {
		if grown[i].discussion == nil {
			continue
		}
		d := *grown[i].discussion
		d.comments = append(append([]comment{}, d.comments...),
			cm(freeCommentKey(d.comments), postKey, spec.discussion.comments[0].author, text))
		grown[i].discussion = &d
	}
	channels = grown
	seed(ctx, f, nil, users)

	body, _ := compose(postSpecByKey(t, spec, postKey).body)
	post := f.postByText(ch.id, body)
	if post == nil {
		t.Fatalf("пост %d канала %q не найден", postKey, spec.title)
	}
	got := f.commentsOn(post.id)
	if len(got) != 1 || got[0].text != text {
		t.Fatalf("в треде поста %d %d комментариев, ожидался один новый", postKey, len(got))
	}
	if want := msgs + 1; len(f.msgOrder) != want {
		t.Fatalf("сообщений %d, ожидалось %d (только новый комментарий)", len(f.msgOrder), want)
	}
}

// Сид идемпотентен по каждой единице содержимого: повторный прогон не должен ни
// создавать вторую группу обсуждения, ни дублировать комментарии, посты,
// служебные пилюли и реакции.
func TestSeed_RerunCreatesNothing(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	seed(ctx, f, nil, users)

	chats, msgs, links, reacts := len(f.chats), len(f.msgOrder), len(f.discussion), f.reactCalls
	if chats == 0 || msgs == 0 || links == 0 || reacts == 0 {
		t.Fatalf("первый прогон пуст: чатов %d, сообщений %d, привязок %d, реакций %d", chats, msgs, links, reacts)
	}

	seed(ctx, f, nil, users)

	if got := len(f.chats); got != chats {
		t.Fatalf("после повторного прогона чатов %d, было %d", got, chats)
	}
	if got := len(f.msgOrder); got != msgs {
		t.Fatalf("после повторного прогона сообщений %d, было %d", got, msgs)
	}
	if got := len(f.discussion); got != links {
		t.Fatalf("после повторного прогона привязок обсуждения %d, было %d", got, links)
	}
	if f.reactCalls != reacts {
		t.Fatalf("после повторного прогона вызовов React %d, было %d", f.reactCalls, reacts)
	}
}

// То же самое поверх ДОЗАВЕДЁННОГО состояния: бэкфилл не должен превратиться в
// источник дублей на следующем старте стенда.
func TestSeed_RerunAfterBackfillCreatesNothing(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()

	seedOldVersion(t, f, users)
	seed(ctx, f, nil, users)

	chats, msgs, links, reacts := len(f.chats), len(f.msgOrder), len(f.discussion), f.reactCalls

	seed(ctx, f, nil, users)

	if got := len(f.chats); got != chats {
		t.Fatalf("после прогона поверх бэкфилла чатов %d, было %d", got, chats)
	}
	if got := len(f.msgOrder); got != msgs {
		t.Fatalf("после прогона поверх бэкфилла сообщений %d, было %d", got, msgs)
	}
	if got := len(f.discussion); got != links {
		t.Fatalf("после прогона поверх бэкфилла привязок обсуждения %d, было %d", got, links)
	}
	if f.reactCalls != reacts {
		t.Fatalf("после прогона поверх бэкфилла вызовов React %d, было %d", f.reactCalls, reacts)
	}
}

package demoseed

import (
	"context"
	"testing"
)

// Пины на то, что ключ идемпотентности отправки собирается из ЗАПИСАННОГО В
// СПЕКЕ номера, а не из позиции элемента в срезе, и на гварды, без которых сид
// платит за уже сделанную работу заново.

// free* — следующий свободный номер: правило спеки требует выдавать новой
// единице именно его, а не «вставить и сдвинуть».
func freePostKey(posts []post) int {
	max := -1
	for _, p := range posts {
		if p.key > max {
			max = p.key
		}
	}
	return max + 1
}

func freeCommentKey(comments []comment) int {
	max := -1
	for _, c := range comments {
		if c.key > max {
			max = c.key
		}
	}
	return max + 1
}

func freeReplyKey(script []reply) int {
	max := -1
	for _, r := range script {
		if r.key > max {
			max = r.key
		}
	}
	return max + 1
}

// swapSpec подменяет глобальные спеки на время теста.
func swapSpec(t *testing.T, chs []channelSpec, grs []groupSpec) {
	t.Helper()
	origCh, origGr := channels, groups
	t.Cleanup(func() { channels, groups = origCh, origGr })
	channels, groups = chs, grs
}

// Ключ каждой единицы спеки записан явно и уникален в своей области, а все
// ссылки (comment.post, reply.replyTo, pinKey) разрешаются ПО КЛЮЧУ. Иначе
// ключ идемпотентности отправки собирать не из чего.
func TestSpec_KeysAreExplicitAndUnique(t *testing.T) {
	seenGroup := map[int]bool{}
	for _, g := range groups {
		if g.key < 0 || seenGroup[g.key] {
			t.Fatalf("группа %q: ключ %d повторяется или отрицателен", g.title, g.key)
		}
		seenGroup[g.key] = true
		seen := map[int]bool{}
		for _, r := range g.script {
			if r.key < 0 || seen[r.key] {
				t.Fatalf("группа %q: ключ реплики %d повторяется или отрицателен", g.title, r.key)
			}
			seen[r.key] = true
		}
		for _, r := range g.script {
			if r.replyTo == -1 {
				continue
			}
			if r.replyTo == r.key || !seen[r.replyTo] {
				t.Fatalf("группа %q, реплика %d: replyTo=%d не разрешается", g.title, r.key, r.replyTo)
			}
		}
		if g.pinKey != -1 && !seen[g.pinKey] {
			t.Fatalf("группа %q: pinKey=%d не разрешается", g.title, g.pinKey)
		}
	}
	for _, c := range channels {
		seen := map[int]bool{}
		for _, p := range c.posts {
			if p.key < 0 || seen[p.key] {
				t.Fatalf("канал %q: ключ поста %d повторяется или отрицателен", c.title, p.key)
			}
			seen[p.key] = true
		}
		if c.pinKey != -1 && !seen[c.pinKey] {
			t.Fatalf("канал %q: pinKey=%d не разрешается", c.title, c.pinKey)
		}
		if c.discussion == nil {
			continue
		}
		seenCm := map[int]bool{}
		for _, cm := range c.discussion.comments {
			if cm.key < 0 || seenCm[cm.key] {
				t.Fatalf("канал %q: ключ комментария %d повторяется или отрицателен", c.title, cm.key)
			}
			seenCm[cm.key] = true
			if !seen[cm.post] {
				t.Fatalf("канал %q, комментарий %d: post=%d не разрешается", c.title, cm.key, cm.post)
			}
		}
	}
}

// Перестановка групп в спеке НИЧЕГО не добавляет: ключ отправки берётся из
// groupSpec.key, а не из позиции в срезе. Пока ключом была позиция, эта
// перестановка давала +38 дублей.
func TestSeed_GroupsReorderCreatesNothing(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	media := &fakeMedia{}
	seed(ctx, f, media, users)

	chats, msgs, reacts, uploads := len(f.chats), len(f.msgOrder), f.reactCalls, media.uploads

	reordered := make([]groupSpec, 0, len(groups))
	for i := len(groups) - 1; i >= 0; i-- {
		reordered = append(reordered, groups[i])
	}
	swapSpec(t, channels, reordered)
	seed(ctx, f, media, users)

	if got := len(f.msgOrder); got != msgs {
		t.Fatalf("после перестановки групп сообщений %d, было %d (+%d дублей)", got, msgs, got-msgs)
	}
	if got := len(f.chats); got != chats {
		t.Fatalf("после перестановки групп чатов %d, было %d", got, chats)
	}
	if f.reactCalls != reacts {
		t.Fatalf("после перестановки групп вызовов React %d, было %d", f.reactCalls, reacts)
	}
	if media.uploads != uploads {
		t.Fatalf("после перестановки групп заливок %d, было %d", media.uploads, uploads)
	}
}

// Вставка единицы в СЕРЕДИНУ спеки добавляет ровно её саму: соседи по срезу
// сохраняют свои ключи и потому не отправляются заново. Пока ключом была
// позиция, один вставленный комментарий давал +12 дублей, а вставленный в
// середину пост не попадал в ленту вовсе.
func TestSeed_SpecInsertInMiddleAddsOnlyNewUnits(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	media := &fakeMedia{}
	seed(ctx, f, media, users)

	spec := channelWithDiscussion(t)
	ch := f.chatByTitle(spec.title)
	if ch == nil {
		t.Fatalf("канал %q не создан", spec.title)
	}
	msgs, chats := len(f.msgOrder), len(f.chats)

	const (
		postText    = "Вставленный в середину пост, которого в спеке раньше не было."
		commentText = "Вставленный в середину комментарий, которого в спеке раньше не было."
		replyText   = "Вставленная в середину реплика, которой в спеке раньше не было."
	)

	grownCh := make([]channelSpec, len(channels))
	copy(grownCh, channels)
	for i := range grownCh {
		c := &grownCh[i]
		if c.discussion == nil {
			continue
		}
		mid := len(c.posts) / 2
		newPost := ps(freePostKey(c.posts), tx(postText))
		c.posts = append(append(append([]post{}, c.posts[:mid]...), newPost), c.posts[mid:]...)

		d := *c.discussion
		at := len(d.comments) / 2
		// Комментарий садится на УЖЕ прокомментированный пост: нового зеркала в
		// группе обсуждения он тогда не заводит, и прирост ровно один.
		newCm := cm(freeCommentKey(d.comments), d.comments[0].post, d.comments[0].author, commentText)
		d.comments = append(append(append([]comment{}, d.comments[:at]...), newCm), d.comments[at:]...)
		c.discussion = &d
	}
	grownGr := make([]groupSpec, len(groups))
	copy(grownGr, groups)
	g := &grownGr[0]
	at := len(g.script) / 2
	newReply := rp(freeReplyKey(g.script), g.script[0].author, tx(replyText))
	g.script = append(append(append([]reply{}, g.script[:at]...), newReply), g.script[at:]...)

	swapSpec(t, grownCh, grownGr)
	seed(ctx, f, media, users)

	// Новый пост + его зеркало в группе обсуждения, новый комментарий, новая
	// реплика — и ничего больше.
	if want := msgs + 4; len(f.msgOrder) != want {
		t.Fatalf("сообщений %d, ожидалось %d (+1 пост, +1 зеркало, +1 комментарий, +1 реплика); лишних %d",
			len(f.msgOrder), want, len(f.msgOrder)-want)
	}
	if got := len(f.chats); got != chats {
		t.Fatalf("чатов %d, было %d", got, chats)
	}
	post := f.postByText(ch.id, postText)
	if post == nil {
		t.Fatalf("вставленный в середину пост не доехал до ленты канала %q", spec.title)
	}
	if f.mirrorOfPost(post.id) == 0 {
		t.Fatalf("у вставленного поста нет зеркала в группе обсуждения")
	}
	if f.postByText(f.discussion[ch.id], commentText) == nil {
		t.Fatalf("вставленный в середину комментарий не доехал до группы обсуждения")
	}
	gr := f.chatByTitle(grownGr[0].title)
	if gr == nil || f.postByText(gr.id, replyText) == nil {
		t.Fatalf("вставленная в середину реплика не доехала до группы %q", grownGr[0].title)
	}
}

// Опрос уезжает только в ТОЛЬКО ЧТО заведённый чат. На живом стенде у опросов
// ключа идемпотентности нет вовсе (ранние версии сида его не проставляли), так
// что этот гвард — единственное, что удерживает от семи дублей опроса.
func TestSeed_LegacyPollWithoutKeyIsNotResent(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	seed(ctx, f, nil, users)

	polls := len(f.pollMsgs())
	if want := len(channels) + len(groups); polls != want {
		t.Fatalf("опросов после первого прогона %d, ожидалось %d", polls, want)
	}
	if n := f.dropPollKeys(); n != polls {
		t.Fatalf("ключ снят у %d опросов из %d", n, polls)
	}
	msgs := len(f.msgOrder)

	seed(ctx, f, nil, users)

	if got := len(f.pollMsgs()); got != polls {
		t.Fatalf("опросов %d, было %d: опрос без ключа отправлен повторно (+%d)", got, polls, got-polls)
	}
	if got := len(f.msgOrder); got != msgs {
		t.Fatalf("сообщений %d, было %d", got, msgs)
	}
}

// Повторный прогон с ДОСТУПНЫМ медиа: альбом узнаётся по ключу ПЕРВОГО КАДРА
// (под ключом самой реплики не отправлено ничего), а картинки не заливаются
// заново. Без медиа альбомный путь не исполняется вовсе, и сломанный ключ
// гварда альбома тестом не ловится.
func TestSeed_RerunWithMediaCreatesNothing(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	media := &fakeMedia{}
	seed(ctx, f, media, users)

	frames := 0
	for _, g := range groups {
		for _, r := range g.script {
			frames += r.album
		}
	}
	if frames == 0 {
		t.Fatalf("в спеке групп нет ни одного альбома — гвард альбома проверять нечем")
	}
	if media.uploads == 0 {
		t.Fatalf("медиа-фейк не получил ни одной заливки")
	}
	chats, msgs, reacts, uploads := len(f.chats), len(f.msgOrder), f.reactCalls, media.uploads

	seed(ctx, f, media, users)

	if got := len(f.msgOrder); got != msgs {
		t.Fatalf("после повторного прогона сообщений %d, было %d (+%d дублей)", got, msgs, got-msgs)
	}
	if got := len(f.chats); got != chats {
		t.Fatalf("после повторного прогона чатов %d, было %d", got, chats)
	}
	if media.uploads != uploads {
		t.Fatalf("после повторного прогона заливок %d, было %d (+%d лишних)", media.uploads, uploads, media.uploads-uploads)
	}
	if f.reactCalls != reacts {
		t.Fatalf("после повторного прогона вызовов React %d, было %d", f.reactCalls, reacts)
	}
}

// Гвард комментария — ЭКОНОМИЯ, а не корректность: дубль отсёк бы и Send внутри
// PostComment, поэтому снятие гварда ловится только по числу вызовов.
func TestSeed_RerunMakesNoPostCommentCalls(t *testing.T) {
	f := newFakeChat()
	users := demoUsers()
	ctx := context.Background()
	seed(ctx, f, nil, users)

	spec := channelWithDiscussion(t)
	if f.postCommentCalls != len(spec.discussion.comments) {
		t.Fatalf("вызовов PostComment %d, ожидалось %d", f.postCommentCalls, len(spec.discussion.comments))
	}
	calls := f.postCommentCalls

	seed(ctx, f, nil, users)

	if f.postCommentCalls != calls {
		t.Fatalf("повторный прогон позвал PostComment ещё %d раз — гвард по ключу отправки не сработал",
			f.postCommentCalls-calls)
	}
}

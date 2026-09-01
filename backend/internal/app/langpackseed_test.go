package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
	"github.com/messenger-denis/backend/internal/langsource"
	usecaselangpack "github.com/messenger-denis/backend/internal/usecase/langpack"
)

// Проводка сида языкового пакета.
//
// До этих тестов её не проверял никто: `app_test.go` сервер не собирает, а
// `seedLangPack` не упоминался больше нигде. Обещания проводки — «отказ сида не
// валит приложение» и «у сида есть дедлайн» — держались на честном слове:
// замена `log.Printf` на `log.Fatalf` прошла бы весь `go test ./...` зелёной.
//
// Хранилище здесь фейковое и БЕЗ базы: проверяется не заливка (её проверяет
// `TestLangPack` на настоящем Postgres), а поведение самой проводки — что она
// зовёт, с каким контекстом и что делает с отказом.

// seedRepo — хранилище, которое считает вызовы и умеет отказывать по языку.
type seedRepo struct {
	mu sync.Mutex
	// applied — версия, под которой залит каждый язык.
	applied map[string]int
	// failOn — языки, на которых Apply отказывает.
	failOn map[string]bool
	// deadline — дедлайн контекста, с которым пришёл первый вызов.
	deadline time.Time
	hadCtx   bool
}

func newSeedRepo(failOn ...string) *seedRepo {
	r := &seedRepo{applied: map[string]int{}, failOn: map[string]bool{}}
	for _, code := range failOn {
		r.failOn[code] = true
	}
	return r
}

func (r *seedRepo) note(ctx context.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.hadCtx {
		r.hadCtx = true
		r.deadline, _ = ctx.Deadline()
	}
}

// Version — языка ещё нет: сид идёт по пути первой заливки.
func (r *seedRepo) Version(ctx context.Context, _ string) (int, error) {
	r.note(ctx)
	return 0, domain.ErrNotFound
}

func (r *seedRepo) Apply(ctx context.Context, meta domain.LangPackLanguageMeta, version int, _ []domain.LangPackStringRecord) error {
	r.note(ctx)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failOn[meta.Code] {
		return errors.New("база не отвечает")
	}
	r.applied[meta.Code] = version
	return nil
}

func (r *seedRepo) Strings(context.Context, string, int, bool) ([]domain.LangPackStringRecord, error) {
	return nil, nil
}

func (r *seedRepo) StringsByKeys(context.Context, string, []string) ([]domain.LangPackStringRecord, error) {
	return nil, nil
}

func (r *seedRepo) Languages(context.Context) ([]domain.LangPackLanguage, error) { return nil, nil }

func (r *seedRepo) Language(context.Context, string) (domain.LangPackLanguage, error) {
	return domain.LangPackLanguage{}, domain.ErrNotFound
}

func seedWith(t *testing.T, repo *seedRepo) {
	t.Helper()
	seedLangPack(context.Background(), usecaselangpack.New(repo))
}

// Сид заливает ВЕСЬ снимок и берёт версию каждого языка ИЗ НЕГО.
func TestSeedLangPack_FillsWholePack(t *testing.T) {
	pack, err := langsource.Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	repo := newSeedRepo()
	seedWith(t, repo)

	if len(repo.applied) != len(pack.Languages) {
		t.Fatalf("залито %d языков из %d: %v", len(repo.applied), len(pack.Languages), repo.applied)
	}
	for _, lang := range pack.Languages {
		if got := repo.applied[lang.Code]; got != lang.Version {
			t.Errorf("%s залит версией %d; в снимке %d", lang.Code, got, lang.Version)
		}
	}
}

// ОТКАЗ НА ОДНОМ ЯЗЫКЕ НЕ СНИМАЕТ СИД С ОСТАЛЬНЫХ.
//
// Языки друг от друга не зависят, и выход по первому отказу оставил бы на
// чистой базе остальные НЕЗАЛИТЫМИ: `getLanguages` не показал бы их вовсе, а
// `getLangPack` ответил бы 404 на язык, который лежит в этом же бинаре.
// Достижимо буднично — откатом бинаря или забытой перегенерацией снимка.
func TestSeedLangPack_OneFailureDoesNotStopTheRest(t *testing.T) {
	pack, err := langsource.Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	// Русский идёт вторым из шести: при выходе по первому отказу четыре
	// последних языка остались бы незалитыми.
	repo := newSeedRepo("ru")
	seedWith(t, repo)

	if _, present := repo.applied["ru"]; present {
		t.Error("отказавший язык считается залитым")
	}
	if len(repo.applied) != len(pack.Languages)-1 {
		t.Fatalf("залито %d языков из %d: %v — отказ на одном снял сид с остальных",
			len(repo.applied), len(pack.Languages)-1, repo.applied)
	}
	for _, lang := range pack.Languages {
		if lang.Code == "ru" {
			continue
		}
		if _, present := repo.applied[lang.Code]; !present {
			t.Errorf("%s не залит, хотя отказал только ru", lang.Code)
		}
	}
}

// Версия, под которой заливается язык, берётся ИЗ СНИМКА, а не выдумывается.
//
// На живом снимке это утверждение сегодня не проверить: у всех шести языков
// версия единица, и подстановка литерала `1` вместо `lang.Version` прошла бы
// незамеченной. Поэтому пакет здесь синтетический и версии у языков РАЗНЫЕ —
// ровно за этим applyLangPack и отделён от чтения снимка.
func TestApplyLangPack_TakesVersionFromSnapshot(t *testing.T) {
	pack := langsource.Pack{Languages: []langsource.Language{
		{LangPackLanguageMeta: domain.LangPackLanguageMeta{Code: "en"}, Version: 3},
		{LangPackLanguageMeta: domain.LangPackLanguageMeta{Code: "ru", BaseCode: "en"}, Version: 7},
		{LangPackLanguageMeta: domain.LangPackLanguageMeta{Code: "de", BaseCode: "en"}, Version: 11},
	}}
	repo := newSeedRepo()
	applyLangPack(context.Background(), usecaselangpack.New(repo), pack)

	want := map[string]int{"en": 3, "ru": 7, "de": 11}
	for code, version := range want {
		if got := repo.applied[code]; got != version {
			t.Errorf("%s залит версией %d; в снимке %d", code, got, version)
		}
	}
	if len(repo.applied) != len(want) {
		t.Errorf("залито %v; ожидались все три языка", repo.applied)
	}
}

// Отказ сида не валит приложение.
//
// Тест держится на том, что `log.Fatalf` завершил бы ПРОЦЕСС: замена им
// `log.Printf` уронила бы весь тестовый бинарь, а не одно утверждение. Поэтому
// проверка «функция вернула управление» здесь настоящая, а не формальная.
func TestSeedLangPack_TotalFailureReturns(t *testing.T) {
	pack, err := langsource.Embedded()
	if err != nil {
		t.Fatalf("снимок не читается: %v", err)
	}
	codes := make([]string, 0, len(pack.Languages))
	for _, lang := range pack.Languages {
		codes = append(codes, lang.Code)
	}
	repo := newSeedRepo(codes...)

	done := make(chan struct{})
	go func() {
		defer close(done)
		seedWith(t, repo)
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("сид не вернул управление: старт сервера заблокирован")
	}
	if len(repo.applied) != 0 {
		t.Errorf("залито %v при отказе на всех языках", repo.applied)
	}
}

// У сида есть ДЕДЛАЙН.
//
// Он идёт в фазе invoke, до того как сервер начнёт слушать порт: без дедлайна
// зависший Postgres означал бы, что не отвечает и `/health`, то есть сервис не
// поднялся вовсе. Проверяется не «мы передали контекст», а что у контекста,
// доехавшего до хранилища, срок есть и он тот самый.
func TestSeedLangPack_PassesDeadline(t *testing.T) {
	repo := newSeedRepo()
	before := time.Now()
	seedWith(t, repo)

	if !repo.hadCtx {
		t.Fatal("хранилище не позвали вовсе")
	}
	if repo.deadline.IsZero() {
		t.Fatal("контекст сида без дедлайна: зависшая база задержала бы старт навсегда")
	}
	// Срок сверяется с ЛИТЕРАЛОМ, а не с самой константой: сравнение константы
	// с собой прошло бы и после того, как её поменяли на сутки. Полминуты — это
	// «база не отвечает»; заливка пяти тысяч строк укладывается в доли секунды.
	const want = 30 * time.Second
	if left := repo.deadline.Sub(before); left > want+2*time.Second || left < want-2*time.Second {
		t.Errorf("до дедлайна %s (константа %s); ожидались 30s", left, langPackSeedTimeout)
	}
}

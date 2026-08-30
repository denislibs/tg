package langpack

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/messenger-denis/backend/internal/domain"
)

// Отказы подсистемы. Названы поимённо, потому что клиент ветвится по ИМЕНИ
// отказа (`HttpError.type`), а «неверный аргумент» — не имя: по нему нельзя
// отличить «спросил слишком много ключей» от «прислал версию из мусора».
// Оба заворачивают domain.ErrInvalid, чтобы общий разбор ошибок (400 против
// 500) продолжал работать, не зная про подсистему ничего.
var (
	// ErrTooManyKeys — за раз спрошено больше MaxStringKeys ключей.
	ErrTooManyKeys = fmt.Errorf("langpack: спрошено слишком много ключей: %w", domain.ErrInvalid)
	// ErrVersionInvalid — версия клиента не может существовать (отрицательная).
	ErrVersionInvalid = fmt.Errorf("langpack: версия клиента невозможна: %w", domain.ErrInvalid)
)

// Interactor — языковой пакет: выдача и версии.
type Interactor struct{ repo Repo }

func New(repo Repo) *Interactor { return &Interactor{repo: repo} }

// Languages — список языков пакета (`langpack.getLanguages`).
func (i *Interactor) Languages(ctx context.Context) ([]domain.LangPackLanguage, error) {
	return i.repo.Languages(ctx)
}

// Language — один язык (`langpack.getLanguage`); domain.ErrNotFound у чужого кода.
func (i *Interactor) Language(ctx context.Context, code string) (domain.LangPackLanguage, error) {
	return i.repo.Language(ctx, code)
}

// LangPack — весь пакет языка (`langpack.getLangPack`).
//
// Это та же разница, посчитанная от нуля: отдельного конструктора «весь пакет» в
// схеме нет. Снятых ключей здесь НЕТ, и это не оптимизация: клиент, у которого
// пакета не было вовсе, удалять у себя нечего — «удали ключ, которого ты не
// видел» не утверждение, а мусор в выдаче.
func (i *Interactor) LangPack(ctx context.Context, code string) (domain.LangPackDifference, error) {
	version, err := i.repo.Version(ctx, code)
	if err != nil {
		return domain.LangPackDifference{}, err
	}
	return i.difference(ctx, code, 0, version, false)
}

// Difference — что изменилось у языка ПОСЛЕ версии клиента
// (`langpack.getDifference`).
//
// Снятые ключи входят в выдачу: клиент, который их однажды получил, обязан
// узнать, что их больше нет, — иначе снятая строка останется у него на экране
// навсегда.
//
// Ноль означает «у меня ничего нет» и даёт весь пакет.
//
// Версия БОЛЬШЕ текущей означает, что клиент пришёл с более нового деплоя, и
// сам собой этот случай не рассасывается: клиент применит разницу, только если
// её `version` больше сохранённой у него (tweb `langPack.ts:770-773`), а
// применяя — потребует точного совпадения своей версии с `from_version`
// (`:710-713`), иначе уйдёт в «слишком длинно» и повторит тот же запрос. То
// есть «откатится сам» он НЕ может — такого механизма у оригинала нет.
//
// Поэтому здесь отдаётся весь пакет: это самое полное, что у сервера есть, и
// честная граница (`from_version: 0`) вместо разницы, у которой `version`
// меньше `from_version`. Клиента с версией из будущего это всё равно не
// вылечит — вылечило бы только то, чтобы наша версия не отставала, а этого мы
// добиваемся иначе: версия приезжает из снимка вместе с бинарём и не
// уменьшается при сбросе базы (докблок `langsource.Language.Version`).
func (i *Interactor) Difference(ctx context.Context, code string, fromVersion int) (domain.LangPackDifference, error) {
	if fromVersion < 0 {
		return domain.LangPackDifference{}, fmt.Errorf("%d: %w", fromVersion, ErrVersionInvalid)
	}
	// За версией ходим ОДИН раз на запрос. Эту ручку каждый клиент дёргает на
	// старте, и второй поход в базу за тем же числом — это лишний запрос на
	// каждое открытие приложения.
	version, err := i.repo.Version(ctx, code)
	if err != nil {
		return domain.LangPackDifference{}, err
	}
	if fromVersion == 0 || fromVersion > version {
		return i.difference(ctx, code, 0, version, false)
	}
	return i.difference(ctx, code, fromVersion, version, true)
}

// difference собирает витрину по УЖЕ ИЗВЕСТНОЙ версии языка: спрашивать её
// здесь повторно значило бы ходить в базу дважды за одним числом.
func (i *Interactor) difference(ctx context.Context, code string, fromVersion, version int, withDeleted bool) (domain.LangPackDifference, error) {
	records, err := i.repo.Strings(ctx, code, fromVersion, withDeleted)
	if err != nil {
		return domain.LangPackDifference{}, err
	}
	strings, err := constructors(records)
	if err != nil {
		return domain.LangPackDifference{}, err
	}
	return domain.NewLangPackDifference(code, fromVersion, version, strings), nil
}

// MaxStringKeys — сколько ключей можно спросить за раз.
//
// `getStrings` — метод ДОСПРОСА отдельных ключей (у оригинала им дотягивают
// строку, которой не оказалось в пакете); за пакетом целиком ходят в
// getLangPack, и он не стоит ни одного лишнего условия. Предел бережёт не
// столько базу, сколько смысл метода: сотней ключей доспрашивают, тысячей —
// выкачивают пакет в обход getLangPack.
const MaxStringKeys = 100

// Strings — запрошенные ключи (`langpack.getStrings`).
//
// Ключ, которого в языке нет, приезжает `langPackStringDeleted` — так же, как у
// оригинала. Промолчать о нём нельзя: клиент ждёт ответ НА КАЖДЫЙ ключ, и
// молчание он прочитал бы как «строка ещё едет».
func (i *Interactor) Strings(ctx context.Context, code string, keys []string) ([]domain.LangPackString, error) {
	if len(keys) > MaxStringKeys {
		return nil, fmt.Errorf("%d при пределе %d: %w", len(keys), MaxStringKeys, ErrTooManyKeys)
	}
	// Существование языка спрашиваем отдельно: без этого чужой код языка отдал
	// бы вектор из одних снятых ключей, то есть «этих строк нет» вместо «такого
	// языка нет».
	if _, err := i.repo.Version(ctx, code); err != nil {
		return nil, err
	}

	records, err := i.repo.StringsByKeys(ctx, code, keys)
	if err != nil {
		return nil, err
	}
	found := make(map[string]domain.LangPackStringRecord, len(records))
	for _, r := range records {
		found[r.Key] = r
	}

	out := make([]domain.LangPackString, 0, len(keys))
	// Порядок ответа — порядок ЗАПРОСА: клиент спрашивал ключи списком, и
	// сопоставлять ответ он вправе по позиции.
	for _, key := range keys {
		rec, ok := found[key]
		if !ok {
			rec = domain.LangPackStringRecord{Key: key, Deleted: true}
		}
		c, err := rec.Constructor()
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// Sync приводит язык к состоянию источника и возвращает его версию.
//
// Версию НАЗНАЧАЕТ ИСТОЧНИК (sourceVersion — из снимка словарей), а не сид, и
// это главное здесь. Считай её сид «предыдущая плюс один», она обнулялась бы
// вместе с базой: `Down` роняет обе таблицы, и после «откатили-накатили» сид
// начинал бы с единицы. Клиент, дошедший до пятой версии, не принял бы после
// этого ни одной строки НИКОГДА — он применяет разницу только когда её версия
// больше сохранённой (tweb `langPack.ts:770-773`). Версия из снимка едет
// вместе с бинарём и сброс базы переживает.
//
// Остальное сид решает сам:
//
//   - строка, чей текст не изменился, НЕ трогается;
//   - изменившаяся или новая получает версию источника;
//   - исчезнувшая из источника помечается СНЯТОЙ, а не удаляется строкой из
//     таблицы: удалённую строку разница не покажет никак, и у клиента она
//     останется навсегда;
//   - если менять нечего, версия языка всё равно доводится до версии
//     источника — иначе пустая база после сброса осталась бы на нуле.
//
// Назад версия не двигается ни при каких условиях (см. ниже про откат бинаря).
func (i *Interactor) Sync(ctx context.Context, meta domain.LangPackLanguageMeta, want []domain.LangPackStringRecord, sourceVersion int) (int, error) {
	if sourceVersion < 1 {
		// Ноль означает «пакета нет»: клиент с нулём спрашивает весь пакет
		// заново, и отдать ему ноль в ответе значило бы зациклить его.
		return 0, fmt.Errorf("langpack: %s: версия источника %d: %w", meta.Code, sourceVersion, ErrVersionInvalid)
	}
	current, err := i.repo.Version(ctx, meta.Code)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return 0, err
	}

	var have []domain.LangPackStringRecord
	if err == nil {
		// Всё, что о языке известно, включая уже снятые ключи: без них
		// повторный сид снимал бы один и тот же ключ на каждом старте.
		if have, err = i.repo.Strings(ctx, meta.Code, 0, true); err != nil {
			return 0, err
		}
	}

	stored := make(map[string]domain.LangPackStringRecord, len(have))
	for _, r := range have {
		stored[r.Key] = r
	}
	source := make(map[string]bool, len(want))

	var changed []domain.LangPackStringRecord
	for _, w := range want {
		if source[w.Key] {
			return 0, fmt.Errorf("langpack: %s: ключ %q в источнике дважды", meta.Code, w.Key)
		}
		source[w.Key] = true
		if w.Deleted {
			return 0, fmt.Errorf("langpack: %s: ключ %q в источнике помечен снятым", meta.Code, w.Key)
		}
		if old, ok := stored[w.Key]; ok && !old.Deleted && old.SameText(w) {
			continue
		}
		changed = append(changed, w)
	}
	for key, old := range stored {
		if source[key] || old.Deleted {
			continue
		}
		changed = append(changed, domain.LangPackStringRecord{Key: key, Deleted: true})
	}
	// Порядок записи — по ключу: обход карты случаен, а сид обязан давать
	// одинаковый результат на одинаковых данных.
	sort.Slice(changed, func(a, b int) bool { return changed[a].Key < changed[b].Key })

	version := sourceVersion
	switch {
	case version < current:
		// Откатили бинарь: снимок старее того, что уже в базе. Двигать версию
		// назад нельзя (клиент замёрзнет), поэтому оставляем сохранённую — но
		// тогда изменившиеся строки уехали бы под уже известной клиенту
		// версией, то есть незаметно для него. Молчать об этом нельзя.
		if len(changed) > 0 {
			return 0, fmt.Errorf("langpack: %s: снимок версии %d старее базы (%d), а строки разошлись: %w",
				meta.Code, sourceVersion, current, domain.ErrConflict)
		}
		version = current
	case version == current && len(changed) > 0:
		// Строки разошлись, а версия источника не выросла — снимок не
		// перегенерирован (`go run ./cmd/langpackgen`). Записать их под текущей
		// версией значит отдать их клиенту НИКОГДА.
		return 0, fmt.Errorf("langpack: %s: строки разошлись, а версия источника осталась %d — снимок не перегенерирован: %w",
			meta.Code, sourceVersion, domain.ErrConflict)
	}
	if err := i.repo.Apply(ctx, meta, version, changed); err != nil {
		return 0, err
	}
	return version, nil
}

func constructors(records []domain.LangPackStringRecord) ([]domain.LangPackString, error) {
	out := make([]domain.LangPackString, 0, len(records))
	for _, r := range records {
		c, err := r.Constructor()
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

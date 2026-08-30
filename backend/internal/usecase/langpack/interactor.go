package langpack

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/messenger-denis/backend/internal/domain"
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
	return i.difference(ctx, code, 0, false)
}

// Difference — что изменилось у языка ПОСЛЕ версии клиента
// (`langpack.getDifference`).
//
// Снятые ключи входят в выдачу: клиент, который их однажды получил, обязан
// узнать, что их больше нет, — иначе снятая строка останется у него на экране
// навсегда.
//
// fromVersion, равная нулю или больше текущей, — не ошибка: ноль означает «у
// меня ничего нет» и даёт весь пакет, версия из будущего (клиент из другого
// деплоя) даёт пустую разницу и текущий номер, по которому клиент откатится сам.
func (i *Interactor) Difference(ctx context.Context, code string, fromVersion int) (domain.LangPackDifference, error) {
	if fromVersion < 0 {
		return domain.LangPackDifference{}, fmt.Errorf("langpack: версия %d: %w", fromVersion, domain.ErrInvalid)
	}
	if fromVersion == 0 {
		return i.LangPack(ctx, code)
	}
	return i.difference(ctx, code, fromVersion, true)
}

func (i *Interactor) difference(ctx context.Context, code string, fromVersion int, withDeleted bool) (domain.LangPackDifference, error) {
	version, err := i.repo.Version(ctx, code)
	if err != nil {
		return domain.LangPackDifference{}, err
	}
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
		return nil, fmt.Errorf("langpack: запрошено %d ключей при пределе %d: %w", len(keys), MaxStringKeys, domain.ErrInvalid)
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
// Здесь живёт всё, что делает версию версией:
//
//   - строка, чей текст не изменился, НЕ трогается — иначе каждый перезапуск
//     сервера растил бы версию и слал всем клиентам весь пакет заново;
//   - изменившаяся или новая получает новую версию языка;
//   - исчезнувшая из источника помечается СНЯТОЙ, а не удаляется строкой из
//     таблицы: удалённую строку разница не покажет никак, и у клиента она
//     останется навсегда;
//   - версия растёт РОВНО НА ОДИН и ровно тогда, когда что-то изменилось.
func (i *Interactor) Sync(ctx context.Context, meta domain.LangPackLanguageMeta, want []domain.LangPackStringRecord) (int, error) {
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

	version := current
	if len(changed) > 0 {
		version++
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

package domain

// Опрос в форме оригинала — конструкторы схемы TL. Правила фазы 0 — в шапке
// mtmedia.go.
//
// До этого шага опрос ехал собственным ключом `poll` строки витрины, плоской
// записью PollInfo{question, options[], counts[], my_votes[], total_voters,
// anonymous, multiple, quiz, closed, correct_option}. В схеме на его месте ЧЕТЫРЕ
// конструктора, и разделены они не по прихоти:
//
//   - poll         — САМ ОПРОС: вопрос и варианты. Не меняется после создания
//                    (кроме закрытия) и одинаков для всех зрителей;
//   - pollResults  — ИТОГИ: числа голосов, и они ЗАВИСЯТ ОТ ЗРИТЕЛЯ («мой»
//                    вариант отмечен флагом chosen);
//   - pollAnswer   — один вариант: его текст и НЕПРОЗРАЧНЫЙ КЛЮЧ (option:bytes);
//   - pollAnswerVoters — итог одного варианта, адресованный тем же ключом.
//
// Плоская запись смешивала первые два: `counts` лежал рядом с `options`, и
// «сколько проголосовало» приходилось искать по ИНДЕКСУ массива. В схеме индекса
// нет вовсе — есть ключ option, и он же уезжает обратно при голосовании. У нас
// этим ключом служит НОМЕР варианта одним байтом: колонка poll_votes.option_idx
// хранит именно номер, и подделывать вместо него строковый идентификатор
// значило бы завести второе пространство имён на ровном месте.

// Значения дискриминатора `_` подсистемы опроса.
const (
	MessageMediaPollTag = "messageMediaPoll"
	PollTag             = "poll"
	PollAnswerTag       = "pollAnswer"
	PollResultsTag      = "pollResults"
	PollAnswerVotersTag = "pollAnswerVoters"
)

// messageMediaPoll#773f4e66 flags:# poll:Poll results:PollResults
// attached_media:flags.0?MessageMedia = MessageMedia;
//
// Оба параметра обязательные: опрос без итогов — не форма, а полуфабрикат.
// attached_media (вложение к вопросу) предмета не имеет.
type MessageMediaPoll struct {
	Underscore string      `json:"_"`
	Poll       MTPoll      `json:"poll"`
	Results    PollResults `json:"results"`
}

func (MessageMediaPoll) isMessageMedia() {}
func (m MessageMediaPoll) Tag() string   { return m.Underscore }

// poll#966e2dbf id:long flags:# closed:flags.0?true public_voters:flags.1?true
// multiple_choice:flags.2?true quiz:flags.3?true open_answers:flags.6?true
// revoting_disabled:flags.7?true shuffle_answers:flags.8?true
// hide_results_until_close:flags.9?true creator:flags.10?true
// subscribers_only:flags.11?true question:TextWithEntities
// answers:Vector<PollAnswer> close_period:flags.4?int close_date:flags.5?int
// countries_iso2:flags.12?Vector<string> hash:long = Poll;
//
// САМ ОПРОС. Имя структуры с префиксом MT — `Poll` в пакете занято строкой
// таблицы polls (domain/poll.go); приём тот же, что у MTMessage и MTFactCheck.
//
// ── Анонимность — это ОТРИЦАНИЕ public_voters ───────────────────────────────
// Наш `anonymous bool` в схеме не существует: там `public_voters` — «видно, кто
// как проголосовал». Это ровно тот же вопрос, заданный с другой стороны, и
// класть его как есть нельзя: pFlags несёт только true, поэтому «анонимный»
// значило бы «ключа public_voters нет».
//
// Не производятся: open_answers (свободный ответ), revoting_disabled,
// shuffle_answers, hide_results_until_close, creator («опрос создал зритель» —
// клиент выводит из from_id), subscribers_only, close_period/close_date
// (автозакрытия по таймеру у нас нет), countries_iso2 — механики нет ни у
// одного.
//
// hash (ОБЯЗАТЕЛЬНЫЙ) не производится: это хэш для кэширования запроса, а
// хэш-кэширования запросов у нас нет вовсе — тот же случай, что factCheck.hash.
// На фазе 2 станет заглушкой-нулём в потоке.
type MTPoll struct {
	Underscore string          `json:"_"`
	ID         int64           `json:"id"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Question — обязательный: вопрос ВМЕСТЕ со своей разметкой, одним объектом
	// textWithEntities. У нас разметки у вопроса нет, поэтому вектор сущностей
	// едет пустым — это [] , а не отсутствие ключа.
	Question *TextWithEntities `json:"question"`
	// Answers — обязательный вектор вариантов.
	Answers []PollAnswer `json:"answers"`
}

// pollAnswer#4b7d786a flags:# text:TextWithEntities option:bytes
// media:flags.0?MessageMedia added_by:flags.1?Peer date:flags.1?int = PollAnswer;
//
// ОДИН вариант ответа. option — непрозрачный ключ (bytes), у нас это номер
// варианта одним байтом; на JSON-проводе фазы 0 байты едут base64, ровно как
// photoStrippedSize.bytes и keyboardButtonCallback.data.
//
// media (картинка у варианта), added_by и date (кто и когда дописал вариант в
// опрос со свободными ответами) предмета не имеют.
type PollAnswer struct {
	Underscore string            `json:"_"`
	Text       *TextWithEntities `json:"text"`
	Option     []byte            `json:"option"`
}

// NewPollAnswer — вариант ответа с ключом-номером.
func NewPollAnswer(index int, text string) PollAnswer {
	return PollAnswer{
		Underscore: PollAnswerTag,
		Text:       NewTextWithEntities(text, nil),
		Option:     PollOption(index),
	}
}

// PollOption — ключ варианта из его номера. Одно место перевода на обе стороны:
// номер уезжает ключом в pollAnswer/pollAnswerVoters и приезжает обратно при
// голосовании.
func PollOption(index int) []byte { return []byte{byte(index)} }

// pollResults#ba7bb15e flags:# min:flags.0?true has_unread_votes:flags.6?true
// can_view_stats:flags.7?true results:flags.1?Vector<PollAnswerVoters>
// total_voters:flags.2?int recent_voters:flags.3?Vector<Peer>
// solution:flags.4?string solution_entities:flags.4?Vector<MessageEntity>
// solution_media:flags.5?MessageMedia = PollResults;
//
// ИТОГИ, и это ПЕР-ЗРИТЕЛЬСКАЯ часть опроса: «мой выбор» живёт здесь, флагом
// chosen у конкретного варианта (см. PollAnswerVoters), а не отдельным массивом
// my_votes рядом с counts.
//
// Обязательных параметров нет ни одного: пустой pollResults — законная форма
// («опрос есть, никто не голосовал»).
//
// ── min: «объект пришёл УРЕЗАННЫМ» ──────────────────────────────────────────
// Флаг долго числился в «нет предмета» — «двух степеней полноты у нас нет». Это
// было неверно: степени две, и вторая производится ровно одним местом.
// publishPollUpdate собирает итоги для «зрителя 0» (MyVotes пуст), потому что
// тело кадра одно на всех получателей, — то есть шлёт заведомо урезанный
// объект. Именно это min и означает, и именно по нему оригинал
// (appPollsManager.saveResults) решает СОХРАНИТЬ свой выбор вместо того, чтобы
// затереть его пустым.
//
// Пока флага не было, клиент подразумевал урезанность БЕЗУСЛОВНО — и
// персонализированные итоги, начни мы их слать, молча игнорировались бы.
// Ставится он единственным местом — PollResults.MarkMin.
//
// Не производятся: has_unread_votes, can_view_stats (статистика опроса),
// recent_voters (последних проголосовавших мы не храним),
// solution/solution_entities/solution_media (пояснение к правильному ответу
// викторины — поля у опроса нет).
type PollResults struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	// Results — flags.1?Vector<PollAnswerVoters>: числа по вариантам.
	Results []PollAnswerVoters `json:"results,omitempty"`
	// TotalVoters — flags.2?int: сколько РАЗНЫХ людей проголосовало (не сумма по
	// вариантам: при мультивыборе они не совпадают).
	TotalVoters int `json:"total_voters,omitempty"`
}

// pollAnswerVoters#3645230a flags:# chosen:flags.0?true correct:flags.1?true
// option:bytes voters:flags.2?int recent_voters:flags.2?Vector<Peer>
// = PollAnswerVoters;
//
// Итог ОДНОГО варианта, адресованный тем же ключом option, что и сам вариант.
//
//	chosen  — этот вариант выбрал ЗРИТЕЛЬ (наш my_votes);
//	correct — правильный ответ викторины. Раскрывается тем же правилом, что и
//	          прежде: только закрытой викторине либо уже ответившему зрителю —
//	          решение принимает read-модель, а не эта структура.
//
// recent_voters не производится, хотя делит бит с voters (flags.2): аватары
// последних проголосовавших ПО ВАРИАНТУ мы не храним. На фазе 2 общий бит
// потребует писать пустой вектор рядом с числом.
type PollAnswerVoters struct {
	Underscore string          `json:"_"`
	PFlags     map[string]bool `json:"pFlags,omitempty"`
	Option     []byte          `json:"option"`
	Voters     int             `json:"voters,omitempty"`
}

// ToMedia — ЕДИНСТВЕННЫЙ перевод представления опроса в конструкторы схемы.
// Пользуются им три места: витрина сообщения, кадр poll_update и ответ ручки
// голосования — второго перевода у опроса быть не должно, иначе повторится та
// же болезнь, что была у сообщения с его десятью формами.
func (p PollInfo) ToMedia() *MessageMediaPoll {
	poll := MTPoll{
		Underscore: PollTag,
		ID:         p.ID,
		Question:   NewTextWithEntities(p.Question, nil),
		Answers:    make([]PollAnswer, 0, len(p.Options)),
	}
	setPFlag(&poll.PFlags, "closed", p.Closed)
	// Анонимность — ОТРИЦАНИЕ public_voters: в схеме вопрос задан с другой
	// стороны, и «выключено» это отсутствие ключа.
	setPFlag(&poll.PFlags, "public_voters", !p.Anonymous)
	setPFlag(&poll.PFlags, "multiple_choice", p.Multiple)
	setPFlag(&poll.PFlags, "quiz", p.Quiz)
	for i, text := range p.Options {
		poll.Answers = append(poll.Answers, NewPollAnswer(i, text))
	}

	chosen := make(map[int]bool, len(p.MyVotes))
	for _, idx := range p.MyVotes {
		chosen[idx] = true
	}
	results := PollResults{Underscore: PollResultsTag, TotalVoters: p.TotalVoters}
	for i := range p.Options {
		v := PollAnswerVoters{Underscore: PollAnswerVotersTag, Option: PollOption(i)}
		if i < len(p.Counts) {
			v.Voters = p.Counts[i]
		}
		setPFlag(&v.PFlags, "chosen", chosen[i])
		setPFlag(&v.PFlags, "correct", p.CorrectOption != nil && *p.CorrectOption == i)
		results.Results = append(results.Results, v)
	}
	return &MessageMediaPoll{Underscore: MessageMediaPollTag, Poll: poll, Results: results}
}

// MarkMin помечает итоги УРЕЗАННЫМИ (pollResults.pFlags.min): в них нет
// пер-зрительской части, и клиенту следует сохранить свой выбор, а не затирать
// его отсутствием chosen. Единственный производитель такого объекта — кадр
// poll_update, тело которого одно на всех получателей.
func (r *PollResults) MarkMin() { setPFlag(&r.PFlags, "min", true) }

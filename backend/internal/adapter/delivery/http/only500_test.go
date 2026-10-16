package http

// Тест-условие повтора 500 на клиенте (план Ф-7, Task 9, Step 11; tweb
// apiManager.ts:800-808): клиент повторяет любой 500 с паузой 1 с ×1,5 до 60 с,
// поэтому 500, который при повторе случится снова (детерминированный), зациклит
// его. Повтор включается, только если перечень ручек с детерминированным 500 пуст.
//
// Как строится перечень. Охрана TestNo500OutsideDomainError гарантирует, что 500
// пишет только разборщик writeDomainError (его fallback). Значит, ручка отдаёт
// 500 ровно тогда, когда до writeDomainError (или до помощника, который её
// зовёт) доезжает ошибка, которую ни ручка, ни разборщик не разобрали. Тест
// строит SSA всего модуля и для каждого вызова разборщика вычисляет, какие
// ошибки могут прийти в его аргумент, — поток значений через возвраты функций,
// фи-узлы, локальные ячейки (в том числе захваченные замыканиями), обёртки
// fmt.Errorf("%w") и errors.Join, с подстановкой на месте вызова для функций
// высшего порядка (WithinTx(fn) возвращает ошибку именно своего fn). Источники:
//
//   - сигнальные ошибки модуля (var ErrX / errX любого пакета: domain, usecase,
//     repo …) — разобраны, если ручка, разборщик или помощник сравнивают с ними
//     (errors.Is / ==) её саму или ошибку, которую она оборачивает;
//   - безымянные errors.New / fmt.Errorf без %w в usecase, domain и репозиториях;
//   - ошибки чужих пакетов (pgx, Redis, MinIO, json …).
//
// Классы, где 500 правомерен (сбой окружения или нарушенный инвариант сервера, а
// не свойство запроса), перечислены ниже с причиной. Всё прочее — находка.
// SQLSTATE 22/23 (данные запроса нарушили ограничение БД) разбирает сам
// writeDomainError; см. TestWriteDomainError_SQLState.

import (
	"fmt"
	"go/constant"
	"go/token"
	"go/types"
	"sort"
	"strings"
	"testing"

	"golang.org/x/tools/go/callgraph"
	"golang.org/x/tools/go/callgraph/cha"
	"golang.org/x/tools/go/callgraph/vta"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"
)

const o5Mod = "github.com/messenger-denis/backend/internal/"

// o5Benign — источники, на которых 500 правомерен и повтор не зациклит клиент
// (или зациклит ровно так же, как tweb на внутренней ошибке сервера TG).
var o5Benign = map[string]string{
	"chat.errScheduledRaced":   "гонка двух публикаций одного отложенного — повтор правомерен",
	"chat.errGiveawayRaced":    "гонка розыгрыша с удалением чата — повтор правомерен",
	"chat.ErrPreviewTransient": "сбой сети при сборке превью ссылки",
	`anon usecase/chat/scheduled.go "scheduled %d: not a message"`:       "инвариант: строка отложенного всегда даёт MessageReal",
	`anon usecase/chat/scheduled.go "scheduled copy: nothing published"`: "инвариант: доставка одной копии возвращает одну копию",
}

// o5BenignExt — ошибки чужих пакетов по префиксу имени.
var o5BenignExt = []struct{ prefix, why string }{
	{"github.com/jackc/pgx/", "сбой БД (связь, таймаут); SQLSTATE 22/23 разбирает writeDomainError"},
	{"adapter/repo/postgres.Querier.", "то же: обёртка pgx"},
	{"adapter/repo/postgres.scanner.", "то же: обёртка pgx"},
	{"github.com/redis/go-redis/", "сбой Redis"},
	{"github.com/minio/minio-go/", "сбой хранилища медиа"},
	{"crypto/rand.", "сбой источника энтропии"},
	{"usecase/auth.Mailer.", "сбой почтового шлюза"},
	{"encoding/json.", "разбор/сборка своих данных (БД, Redis, ответ), не тела запроса"},
	{"encoding/hex.", "разбор токена, который выдал сам сервер"},
	{"github.com/go-webauthn/webauthn/", "конфиг RP проверяется при старте; параметры — данные своей сессии"},
}

func TestOnly500_NoDeterministicSources(t *testing.T) {
	if testing.Short() {
		t.Skip("строит SSA всего модуля")
	}
	cfg := &packages.Config{Mode: packages.LoadAllSyntax, Dir: "../../../.."}
	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		t.Fatal(err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		t.Fatal("пакеты модуля не собрались")
	}
	prog, _ := ssautil.AllPackages(pkgs, ssa.InstantiateGenerics)
	prog.Build()
	all := ssautil.AllFunctions(prog)
	cg := vta.CallGraph(all, cha.CallGraph(prog))
	cg.DeleteSyntheticNodes()
	a := newO5(prog, cg, all)

	var bad []string
	for _, h := range a.handlers() {
		handled := a.handledIn(h)
		for k := range a.reaching(h) {
			if a.isHandled(k, handled) || o5IsBenign(k) {
				continue
			}
			bad = append(bad, fmt.Sprintf("%s ← %s", strings.TrimPrefix(strings.ReplaceAll(h.String(), o5Mod, ""), "(*adapter/delivery/http."), k))
		}
	}
	sort.Strings(bad)
	if len(bad) > 0 {
		t.Fatalf("ручки с детерминированным 500 (ошибка доходит до fallback writeDomainError):\n  %s", strings.Join(bad, "\n  "))
	}
}

func o5IsBenign(k string) bool {
	if o5Benign[k] != "" {
		return true
	}
	if rest, ok := strings.CutPrefix(k, "ext "); ok {
		for _, b := range o5BenignExt {
			if strings.HasPrefix(rest, b.prefix) {
				return true
			}
		}
	}
	return false
}

type o5set map[string]bool

func (s o5set) add(o o5set) bool {
	ch := false
	for k := range o {
		if !s[k] {
			s[k], ch = true, true
		}
	}
	return ch
}

type o5 struct {
	prog    *ssa.Program
	cg      *callgraph.Graph
	all     map[*ssa.Function]bool
	errType types.Type
	ret     map[*ssa.Function]o5set // что может вернуть функция (с #param:i / #call:i)
	sites   map[ssa.CallInstruction][]*ssa.Function
	fvBind  map[*ssa.FreeVar]ssa.Value // свободная переменная замыкания → привязка в родителе
	stores  map[ssa.Value][]ssa.Value  // ячейка → записанные в неё значения
	wraps   map[string]o5set           // сигнал → что он оборачивает (fmt.Errorf("%w") в объявлении)
	compare map[*ssa.Function]o5set    // сигналы, с которыми функция сравнивает
	sinks   map[*ssa.Function]int      // разборщик и помощники: индекс параметра-ошибки
}

func newO5(prog *ssa.Program, cg *callgraph.Graph, all map[*ssa.Function]bool) *o5 {
	a := &o5{prog: prog, cg: cg, all: all, errType: types.Universe.Lookup("error").Type(),
		ret: map[*ssa.Function]o5set{}, sites: map[ssa.CallInstruction][]*ssa.Function{},
		fvBind: map[*ssa.FreeVar]ssa.Value{}, stores: map[ssa.Value][]ssa.Value{},
		wraps: map[string]o5set{}, compare: map[*ssa.Function]o5set{}, sinks: map[*ssa.Function]int{}}
	for f := range all {
		if n := cg.Nodes[f]; n != nil {
			for _, e := range n.Out {
				a.sites[e.Site] = append(a.sites[e.Site], e.Callee.Func)
			}
		}
		for _, b := range f.Blocks {
			for _, ins := range b.Instrs {
				if mc, ok := ins.(*ssa.MakeClosure); ok {
					fn := mc.Fn.(*ssa.Function)
					for i, bv := range mc.Bindings {
						a.fvBind[fn.FreeVars[i]] = bv
					}
				}
			}
		}
	}
	for f := range all {
		for _, b := range f.Blocks {
			for _, ins := range b.Instrs {
				switch in := ins.(type) {
				case *ssa.Store:
					c := a.cell(in.Addr)
					a.stores[c] = append(a.stores[c], in.Val)
				case *ssa.UnOp:
					if g, ok := in.X.(*ssa.Global); ok && in.Op == token.MUL && a.isSentinel(g) && o5OnlyCompared(in) {
						if a.compare[f] == nil {
							a.compare[f] = o5set{}
						}
						a.compare[f][o5Key(g)] = true
					}
				}
			}
		}
	}
	a.solve()
	// var ErrX = fmt.Errorf("…%w", domain.ErrY): что сигнал оборачивает
	for f := range all {
		if f.Name() != "init" {
			continue
		}
		for _, b := range f.Blocks {
			for _, ins := range b.Instrs {
				if st, ok := ins.(*ssa.Store); ok {
					if g, ok := st.Addr.(*ssa.Global); ok && a.isSentinel(g) {
						a.wraps[o5Key(g)] = a.val(st.Val, map[ssa.Value]bool{})
					}
				}
			}
		}
	}
	a.findSinks()
	return a
}

func (a *o5) inMod(f *ssa.Function) bool {
	return f != nil && f.Pkg != nil && strings.HasPrefix(f.Pkg.Pkg.Path(), o5Mod)
}

func (a *o5) isHTTP(f *ssa.Function) bool {
	return f.Pkg != nil && f.Pkg.Pkg.Path() == o5Mod+"adapter/delivery/http"
}

func (a *o5) isSentinel(g *ssa.Global) bool {
	return g.Pkg != nil && strings.HasPrefix(g.Pkg.Pkg.Path(), o5Mod) &&
		types.Implements(g.Type().(*types.Pointer).Elem(), a.errType.Underlying().(*types.Interface))
}

func o5Key(g *ssa.Global) string {
	return strings.TrimPrefix(strings.TrimPrefix(g.Pkg.Pkg.Path(), o5Mod), "usecase/") + "." + g.Name()
}

func o5Top(f *ssa.Function) *ssa.Function {
	for f.Parent() != nil {
		f = f.Parent()
	}
	return f
}

// o5OnlyCompared — загруженный сигнал идёт только в errors.Is/As или ==/!=.
func o5OnlyCompared(v ssa.Value) bool {
	refs := *v.Referrers()
	if len(refs) == 0 {
		return false
	}
	for _, r := range refs {
		switch x := r.(type) {
		case *ssa.BinOp:
			if x.Op != token.EQL && x.Op != token.NEQ {
				return false
			}
		case *ssa.Call:
			f := x.Call.StaticCallee()
			if f == nil || f.Pkg == nil || f.Pkg.Pkg.Path() != "errors" || (f.Name() != "Is" && f.Name() != "As") {
				return false
			}
		case *ssa.MakeInterface:
			if !o5OnlyCompared(x) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (a *o5) cell(v ssa.Value) ssa.Value {
	for {
		fv, ok := v.(*ssa.FreeVar)
		if !ok {
			return v
		}
		b, ok := a.fvBind[fv]
		if !ok {
			return v
		}
		v = b
	}
}

func (a *o5) returnsErr(com *ssa.CallCommon) bool {
	res := com.Signature().Results()
	for i := 0; i < res.Len(); i++ {
		if types.Identical(res.At(i).Type(), a.errType) {
			return true
		}
	}
	return false
}

// val — какие ошибки может нести значение v.
func (a *o5) val(v ssa.Value, vis map[ssa.Value]bool) o5set {
	out := o5set{}
	if v == nil || vis[v] {
		return out
	}
	vis[v] = true
	switch x := v.(type) {
	case *ssa.Parameter:
		for i, p := range x.Parent().Params {
			if p == x {
				out[fmt.Sprintf("#param:%d", i)] = true
			}
		}
	case *ssa.UnOp:
		if g, ok := x.X.(*ssa.Global); ok {
			if a.isSentinel(g) {
				out[o5Key(g)] = true
			}
			return out
		}
		for _, sv := range a.stores[a.cell(x.X)] {
			out.add(a.val(sv, vis))
		}
	case *ssa.Extract:
		out.add(a.val(x.Tuple, vis))
	case *ssa.Call:
		out.add(a.callSet(x, x.Parent(), vis))
	case *ssa.Phi:
		for _, e := range x.Edges {
			out.add(a.val(e, vis))
		}
	case *ssa.MakeInterface:
		out.add(a.val(x.X, vis))
	case *ssa.ChangeInterface:
		out.add(a.val(x.X, vis))
	case *ssa.ChangeType:
		out.add(a.val(x.X, vis))
	case *ssa.TypeAssert:
		out.add(a.val(x.X, vis))
	case *ssa.Slice:
		out.add(a.val(x.X, vis))
	case *ssa.Alloc: // массив varargs fmt.Errorf / errors.Join
		for _, r := range *x.Referrers() {
			if ia, ok := r.(*ssa.IndexAddr); ok {
				for _, sv := range a.stores[ia] {
					out.add(a.val(sv, vis))
				}
			}
		}
	}
	return out
}

func (a *o5) callSet(c ssa.CallInstruction, in *ssa.Function, vis map[ssa.Value]bool) o5set {
	out := o5set{}
	com := c.Common()
	if p, ok := com.Value.(*ssa.Parameter); ok && !com.IsInvoke() {
		for i, pp := range in.Params {
			if pp == p {
				out[fmt.Sprintf("#call:%d", i)] = true
			}
		}
		return out
	}
	if cal := com.StaticCallee(); cal != nil && !a.inMod(cal) {
		name := cal.String()
		if cal.Pkg != nil {
			name = cal.Pkg.Pkg.Path() + "." + cal.Name()
		}
		switch name {
		case "errors.New", "fmt.Errorf":
			format := ""
			if k, ok := com.Args[0].(*ssa.Const); ok && k.Value != nil && k.Value.Kind() == constant.String {
				format = constant.StringVal(k.Value)
			}
			if name == "fmt.Errorf" && strings.Contains(format, "%w") {
				for _, arg := range com.Args[1:] {
					out.add(a.val(arg, vis))
				}
				return out
			}
			pp := strings.TrimPrefix(in.Pkg.Pkg.Path(), o5Mod)
			if strings.HasPrefix(pp, "usecase/") || pp == "domain" || strings.HasPrefix(pp, "adapter/repo/") || strings.HasPrefix(pp, "adapter/cache/") {
				file := a.prog.Fset.Position(c.Pos()).Filename
				if i := strings.Index(file, "/internal/"); i >= 0 {
					file = file[i+len("/internal/"):]
				}
				out[fmt.Sprintf("anon %s %q", file, format)] = true
			}
			return out
		case "errors.Join":
			for _, arg := range com.Args {
				out.add(a.val(arg, vis))
			}
			return out
		}
		if a.returnsErr(com) {
			out["ext "+strings.TrimPrefix(name, o5Mod)] = true
		}
		return out
	}
	modCallee := false
	for _, cal := range a.sites[c] {
		modCallee = modCallee || a.inMod(cal)
	}
	if !modCallee && a.returnsErr(com) {
		name := "?"
		if com.IsInvoke() {
			name = com.Value.Type().String() + "." + com.Method.Name()
		} else if len(a.sites[c]) > 0 {
			name = a.sites[c][0].String()
		}
		out["ext "+strings.TrimPrefix(name, o5Mod)] = true
	}
	for _, cal := range a.sites[c] {
		if !a.inMod(cal) {
			continue
		}
		if cal.Parent() != nil && o5Top(cal) != o5Top(in) {
			// чужое замыкание, вызванное функцией высшего порядка: его вклад
			// подставляет #call:i на месте вызова этой функции
			continue
		}
		for k := range a.ret[cal] {
			var i int
			switch {
			case strings.HasPrefix(k, "#param:"):
				fmt.Sscanf(k, "#param:%d", &i)
				if arg := o5ArgAt(com, i); arg != nil {
					out.add(a.val(arg, vis))
				}
			case strings.HasPrefix(k, "#call:"):
				fmt.Sscanf(k, "#call:%d", &i)
				if arg := o5ArgAt(com, i); arg != nil {
					out.add(a.funcVal(arg, in))
				}
			default:
				out[k] = true
			}
		}
	}
	return out
}

func o5ArgAt(com *ssa.CallCommon, i int) ssa.Value {
	if com.IsInvoke() {
		if i == 0 {
			return com.Value
		}
		i--
	}
	if i < len(com.Args) {
		return com.Args[i]
	}
	return nil
}

// funcVal — что вернёт вызов функционального значения f.
func (a *o5) funcVal(f ssa.Value, in *ssa.Function) o5set {
	out := o5set{}
	var fn *ssa.Function
	switch x := f.(type) {
	case *ssa.MakeClosure:
		fn = x.Fn.(*ssa.Function)
	case *ssa.Function:
		fn = x
	case *ssa.Parameter:
		for i, p := range in.Params {
			if p == x {
				out[fmt.Sprintf("#call:%d", i)] = true
			}
		}
	case *ssa.ChangeType:
		return a.funcVal(x.X, in)
	}
	if fn != nil {
		for k := range a.ret[fn] {
			if !strings.HasPrefix(k, "#") {
				out[k] = true
			}
		}
	}
	return out
}

func (a *o5) solve() {
	for changed := true; changed; {
		changed = false
		for f := range a.all {
			if !a.inMod(f) {
				continue
			}
			if a.ret[f] == nil {
				a.ret[f] = o5set{}
			}
			res := f.Signature.Results()
			for _, b := range f.Blocks {
				r, ok := b.Instrs[len(b.Instrs)-1].(*ssa.Return)
				if !ok {
					continue
				}
				for i, rv := range r.Results {
					if i < res.Len() && types.Implements(res.At(i).Type(), a.errType.Underlying().(*types.Interface)) {
						if a.ret[f].add(a.val(rv, map[ssa.Value]bool{})) {
							changed = true
						}
					}
				}
			}
		}
	}
}

// findSinks — writeDomainError и помощники пакета http, передающие ей свой
// параметр-ошибку (writeSendError, mapErr ручек …), с индексом этого параметра.
func (a *o5) findSinks() {
	for f := range a.all {
		if a.isHTTP(f) && f.Name() == "writeDomainError" && f.Parent() == nil {
			a.sinks[f] = 1
		}
	}
	for changed := true; changed; {
		changed = false
		for f := range a.all {
			if _, done := a.sinks[f]; done || !a.isHTTP(f) {
				continue
			}
			for _, c := range a.sinkCalls(f) {
				for k := range a.val(c.Call.Args[a.sinks[c.Call.StaticCallee()]], map[ssa.Value]bool{}) {
					var i int
					if _, err := fmt.Sscanf(k, "#param:%d", &i); err == nil {
						a.sinks[f] = i
						changed = true
					}
				}
			}
		}
	}
}

func (a *o5) sinkCalls(f *ssa.Function) []*ssa.Call {
	var out []*ssa.Call
	for _, b := range f.Blocks {
		for _, ins := range b.Instrs {
			if c, ok := ins.(*ssa.Call); ok {
				if _, ok := a.sinks[c.Call.StaticCallee()]; ok && c.Call.StaticCallee() != nil {
					out = append(out, c)
				}
			}
		}
	}
	return out
}

// handlers — функции пакета http, которые зовут разборщик со своей ошибкой.
func (a *o5) handlers() []*ssa.Function {
	var out []*ssa.Function
	for f := range a.all {
		if _, isSink := a.sinks[f]; !isSink && a.isHTTP(f) && len(a.sinkCalls(f)) > 0 {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out
}

// reaching — ошибки, которые доходят до аргумента разборщика в ручке h.
func (a *o5) reaching(h *ssa.Function) o5set {
	out := o5set{}
	for _, c := range a.sinkCalls(h) {
		for k := range a.val(c.Call.Args[a.sinks[c.Call.StaticCallee()]], map[ssa.Value]bool{}) {
			if !strings.HasPrefix(k, "#") {
				out[k] = true
			}
		}
	}
	return out
}

// handledIn — сигналы, с которыми сравнивают ручка и достижимые из неё функции
// пакета http (разборщик, помощники, mapErr).
func (a *o5) handledIn(h *ssa.Function) o5set {
	out := o5set{}
	seen := map[*ssa.Function]bool{h: true}
	queue := []*ssa.Function{h}
	for len(queue) > 0 {
		f := queue[0]
		queue = queue[1:]
		out.add(a.compare[f])
		if n := a.cg.Nodes[f]; n != nil {
			for _, e := range n.Out {
				if c := e.Callee.Func; a.isHTTP(c) && !seen[c] {
					seen[c] = true
					queue = append(queue, c)
				}
			}
		}
	}
	return out
}

// isHandled — сигнал k (или то, что он оборачивает) кто-то сравнивает.
func (a *o5) isHandled(k string, handled o5set) bool {
	seen := map[string]bool{}
	var walk func(k string) bool
	walk = func(k string) bool {
		if seen[k] {
			return false
		}
		seen[k] = true
		if handled[k] {
			return true
		}
		for w := range a.wraps[k] {
			if walk(w) {
				return true
			}
		}
		return false
	}
	return walk(k)
}

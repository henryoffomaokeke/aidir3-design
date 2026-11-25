package legacy

import (
	"container/list"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

//go:embed engine.js
var engineJS string

var (
	progOnce sync.Once
	prog     *goja.Program
	progErr  error
)

func program() (*goja.Program, error) {
	progOnce.Do(func() {
		prog, progErr = goja.Compile("engine.js", engineJS, true)
	})
	return prog, progErr
}

// A VM keeps the old library loaded between calls (loading it costs about
// half a second; one listing then costs tens of milliseconds). goja runtimes
// are single-goroutine, so each is checked out of the pool for one call.
type vm struct {
	rt *goja.Runtime
	fn goja.Callable
}

const materialiseTimeout = 20 * time.Second

var (
	poolOnce sync.Once
	pool     chan *vm
	poolSize int
	made     int
	madeMu   sync.Mutex
)

func initPool() {
	poolOnce.Do(func() {
		poolSize = runtime.NumCPU()
		if poolSize > 4 {
			poolSize = 4
		}
		if poolSize < 1 {
			poolSize = 1
		}
		pool = make(chan *vm, poolSize)
	})
}

func newVM() (*vm, error) {
	p, err := program()
	if err != nil {
		return nil, fmt.Errorf("legacy engine: compile: %w", err)
	}
	rt := goja.New()
	if _, err := rt.RunProgram(p); err != nil {
		return nil, fmt.Errorf("legacy engine: load: %w", err)
	}
	fn, ok := goja.AssertFunction(rt.Get("__a3Materialise"))
	if !ok {
		return nil, errors.New("legacy engine: entry point missing")
	}
	return &vm{rt: rt, fn: fn}, nil
}

// checkout takes an idle VM, makes one while fewer than poolSize exist, or
// waits for one to come back.
func checkout(ctx context.Context) (*vm, error) {
	initPool()
	select {
	case v := <-pool:
		return v, nil
	default:
	}
	madeMu.Lock()
	if made < poolSize {
		made++
		madeMu.Unlock()
		v, err := newVM()
		if err != nil {
			madeMu.Lock()
			made--
			madeMu.Unlock()
		}
		return v, err
	}
	madeMu.Unlock()
	select {
	case v := <-pool:
		return v, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// discard drops a VM that was interrupted (its state is no longer trusted).
func discard() {
	madeMu.Lock()
	made--
	madeMu.Unlock()
}

// Result is a materialised variation: an ordinary template view and design
// file, the same shapes the built-in seed holds.
type Result struct {
	Template json.RawMessage
	File     json.RawMessage
	// Lost names what the conversion could not carry over (for reports).
	Lost []string
}

type engineOut struct {
	Template json.RawMessage `json:"template"`
	File     json.RawMessage `json:"file"`
	Warnings []string        `json:"warnings"`
	Lost     []string        `json:"lost"`
	Error    string          `json:"error"`
}

// cache keeps recently materialised variations: a gallery page asks for the
// same files again when it scrolls back, and opening one follows its preview.
const cacheSize = 512

var (
	cacheMu  sync.Mutex
	cacheLRU = list.New()
	cacheIdx = map[string]*list.Element{}
	inflight = map[string]*call{}
)

type cached struct {
	id  string
	res Result
}

type call struct {
	done chan struct{}
	res  Result
	err  error
}

// Materialise builds the variation with this id (served from the cache when
// it was built recently; concurrent calls for one id share a single build).
func Materialise(ctx context.Context, id string) (Result, error) {
	c, err := load()
	if err != nil {
		return Result{}, err
	}
	i, ok := c.byID[strings.TrimPrefix(id, IDPrefix)]
	if !IsID(id) || !ok {
		return Result{}, ErrNotFound
	}
	cacheMu.Lock()
	if el, ok := cacheIdx[id]; ok {
		cacheLRU.MoveToFront(el)
		res := el.Value.(*cached).res
		cacheMu.Unlock()
		return res, nil
	}
	if cl, ok := inflight[id]; ok {
		cacheMu.Unlock()
		select {
		case <-cl.done:
			return cl.res, cl.err
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	}
	cl := &call{done: make(chan struct{})}
	inflight[id] = cl
	cacheMu.Unlock()

	cl.res, cl.err = build(ctx, c.request(int(i)))

	cacheMu.Lock()
	delete(inflight, id)
	if cl.err == nil {
		cacheIdx[id] = cacheLRU.PushFront(&cached{id: id, res: cl.res})
		for cacheLRU.Len() > cacheSize {
			old := cacheLRU.Back()
			cacheLRU.Remove(old)
			delete(cacheIdx, old.Value.(*cached).id)
		}
	}
	cacheMu.Unlock()
	close(cl.done)
	return cl.res, cl.err
}

func build(ctx context.Context, req engineReq) (Result, error) {
	in, err := json.Marshal(req)
	if err != nil {
		return Result{}, err
	}
	v, err := checkout(ctx)
	if err != nil {
		return Result{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, materialiseTimeout)
	defer cancel()
	stop := make(chan struct{})
	interrupted := false
	var mu sync.Mutex
	go func() {
		select {
		case <-ctx.Done():
			mu.Lock()
			interrupted = true
			mu.Unlock()
			v.rt.Interrupt("legacy engine timeout")
		case <-stop:
		}
	}()
	out, callErr := v.fn(goja.Undefined(), v.rt.ToValue(string(in)))
	close(stop)
	mu.Lock()
	bad := interrupted
	mu.Unlock()
	if bad || callErr != nil {
		discard()
		if callErr == nil {
			callErr = ctx.Err()
		}
		return Result{}, fmt.Errorf("legacy engine: %w", callErr)
	}
	pool <- v
	var o engineOut
	if err := json.Unmarshal([]byte(out.String()), &o); err != nil {
		return Result{}, fmt.Errorf("legacy engine: output: %w", err)
	}
	if o.Error != "" {
		return Result{}, fmt.Errorf("legacy engine: %s", o.Error)
	}
	return Result{Template: o.Template, File: o.File, Lost: o.Lost}, nil
}

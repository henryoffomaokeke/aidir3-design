package ai

// aidir3 fork: the xAI (Grok) preset and the instance-wide fallback provider.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hycanvas/backend/internal/accounts"
)

func TestXAIPreset(t *testing.T) {
	p := PresetFor("xai")
	if p == nil {
		t.Fatal("xai preset must exist")
	}
	if p.Label != "xAI (Grok)" || p.BaseURL != "https://api.x.ai/v1" || p.DefaultModel != xaiDefaultModel || p.DefaultImageModel != xaiDefaultImageModel {
		t.Fatalf("xai defaults wrong: %+v", p)
	}
	if p.NeedsBaseURL || p.NeedsSecret {
		t.Fatal("xai needs only a key")
	}
	c := p.Capabilities
	if !c.Text || !c.Image || !c.DescribeImage || !c.EditImage {
		t.Fatalf("xai capabilities wrong: %+v", c)
	}
	if !providerSet["xai"] {
		t.Fatal("xai must be accepted by SetConfig")
	}
}

func TestIsXAI(t *testing.T) {
	cases := []struct {
		cfg  CallConfig
		want bool
	}{
		{CallConfig{Provider: ProviderXAI}, true},
		{CallConfig{Provider: ProviderCustom, BaseURL: "https://api.x.ai/v1"}, true},
		{CallConfig{Provider: ProviderOpenAI, BaseURL: "https://API.X.AI/v1/"}, true},
		{CallConfig{Provider: ProviderCustom, BaseURL: "https://api.x.ai.evil.example/v1"}, false},
		{CallConfig{Provider: ProviderOpenAI}, false},
		{CallConfig{Provider: ProviderAnthropic, BaseURL: "https://api.x.ai/v1"}, false},
	}
	for _, c := range cases {
		if got := isXAI(c.cfg); got != c.want {
			t.Errorf("isXAI(%+v) = %v, want %v", c.cfg, got, c.want)
		}
	}
}

// The reported failure: Custom pointed at api.x.ai with no model sent
// gpt-4o-mini, which xAI answers 404.
func TestXAITextDefaultsOnCustom(t *testing.T) {
	req := buildTextRequest(CallConfig{Provider: ProviderCustom, BaseURL: "https://api.x.ai/v1", APIKey: "k"}, "hi", "")
	body := req.body.(map[string]any)
	if body["model"] != xaiDefaultModel {
		t.Fatalf("custom->x.ai text model = %v, want %s", body["model"], xaiDefaultModel)
	}
	if req.url != "https://api.x.ai/v1/chat/completions" {
		t.Fatalf("url = %s", req.url)
	}
	// Plain OpenAI keeps its own default.
	if m := buildTextRequest(CallConfig{Provider: ProviderOpenAI}, "hi", "").body.(map[string]any)["model"]; m != "gpt-4o-mini" {
		t.Fatalf("openai default changed: %v", m)
	}
}

func TestXAIImageRequest(t *testing.T) {
	req := buildImageRequest(CallConfig{Provider: ProviderXAI, BaseURL: "https://api.x.ai/v1", APIKey: "k"}, "an apple", "1792x1024")
	body := req.body.(map[string]any)
	if _, has := body["size"]; has {
		t.Fatal("xAI rejects size; it must not be sent")
	}
	if body["aspect_ratio"] != "16:9" || body["response_format"] != "b64_json" || body["model"] != xaiDefaultImageModel {
		t.Fatalf("xai image body wrong: %+v", body)
	}
	if req.url != "https://api.x.ai/v1/images/generations" {
		t.Fatalf("url = %s", req.url)
	}
	// OpenAI keeps size.
	if _, has := buildImageRequest(CallConfig{Provider: ProviderOpenAI}, "x", "").body.(map[string]any)["size"]; !has {
		t.Fatal("openai image body lost size")
	}
}

func TestXAIAspectRatio(t *testing.T) {
	for size, want := range map[string]string{
		"": "1:1", "junk": "1:1", "1024x1024": "1:1", "1792x1024": "16:9", "1024x1792": "9:16",
		"1536x1024": "3:2", "1024x1536": "2:3", "1600x1200": "4:3", "1200x1600": "3:4", "2520x1080": "21:9",
	} {
		if got := xaiAspectRatio(size); got != want {
			t.Errorf("xaiAspectRatio(%q) = %s, want %s", size, got, want)
		}
	}
}

func TestParseImageResponseMimeType(t *testing.T) {
	got := parseImageResponse([]byte(`{"data":[{"b64_json":"QUJD","mime_type":"image/jpeg"}]}`))
	if got != "data:image/jpeg;base64,QUJD" {
		t.Fatalf("got %s", got)
	}
	if got := parseImageResponse([]byte(`{"data":[{"b64_json":"QUJD"}]}`)); got != "data:image/png;base64,QUJD" {
		t.Fatalf("default mime changed: %s", got)
	}
}

func TestXAIEditRequestIsJSON(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n0000000000000000")
	b64 := base64.StdEncoding.EncodeToString(png)
	req := buildXAIEditRequest(CallConfig{Provider: ProviderXAI, BaseURL: "https://api.x.ai/v1"}, EditImageInput{ImageBase64: b64, Prompt: "green"}, png)
	body := req.body.(map[string]any)
	img := body["image"].(map[string]any)
	if img["type"] != "image_url" || img["url"] != "data:image/png;base64,"+b64 {
		t.Fatalf("image part wrong: %+v", img)
	}
	if req.url != "https://api.x.ai/v1/images/edits" || body["model"] != xaiDefaultImageModel {
		t.Fatalf("edit request wrong: %s %+v", req.url, body)
	}
}

func TestTextCatalogDropsGrokImagine(t *testing.T) {
	list := finishCatalog([]ModelInfo{{ID: "grok-4.3"}, {ID: "grok-imagine-image"}, {ID: "grok-imagine-video"}}, PurposeText)
	if len(list.Models) != 1 || list.Models[0].ID != "grok-4.3" {
		t.Fatalf("text catalog = %+v", list.Models)
	}
	img := finishCatalog([]ModelInfo{{ID: "grok-4.3"}, {ID: "grok-imagine-image"}, {ID: "grok-imagine-video"}}, PurposeImage)
	if len(img.Models) != 1 || img.Models[0].ID != "grok-imagine-image" {
		t.Fatalf("image catalog = %+v", img.Models)
	}
}

func envOf(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestFallbackEnv(t *testing.T) {
	if fallbackEnv(envOf(nil)) != nil {
		t.Fatal("no env, no fallback")
	}
	if fallbackEnv(envOf(map[string]string{"XAI_API_KEY": "k"})) != nil {
		t.Fatal("a key alone must not opt in")
	}
	if fallbackEnv(envOf(map[string]string{"AIDIR3_AI_FALLBACK": "xai"})) != nil {
		t.Fatal("xai without a key is unusable")
	}
	if fallbackEnv(envOf(map[string]string{"AIDIR3_AI_FALLBACK": "azure-openai", "AIDIR3_AI_FALLBACK_KEY": "k"})) != nil {
		t.Fatal("a provider needing a base URL is refused")
	}
	if fallbackEnv(envOf(map[string]string{"AIDIR3_AI_FALLBACK": "nope", "AIDIR3_AI_FALLBACK_KEY": "k"})) != nil {
		t.Fatal("unknown provider is refused")
	}
	cfg := fallbackEnv(envOf(map[string]string{"AIDIR3_AI_FALLBACK": " XAI ", "XAI_API_KEY": "xk"}))
	if cfg == nil || cfg.Provider != ProviderXAI || cfg.APIKey != "xk" || cfg.BaseURL != "https://api.x.ai/v1" ||
		cfg.Model != xaiDefaultModel || cfg.ImageModel != xaiDefaultImageModel || !cfg.builtin {
		t.Fatalf("xai fallback wrong: %+v", cfg)
	}
	cfg = fallbackEnv(envOf(map[string]string{"AIDIR3_AI_FALLBACK": "xai", "XAI_API_KEY": "xk", "XAI_MODEL": "grok-4.3", "XAI_IMAGE_MODEL": "grok-imagine-image-2.0"}))
	if cfg.Model != "grok-4.3" || cfg.ImageModel != "grok-imagine-image-2.0" {
		t.Fatalf("xai model overrides ignored: %+v", cfg)
	}
	cfg = fallbackEnv(envOf(map[string]string{"AIDIR3_AI_FALLBACK": "deepseek", "AIDIR3_AI_FALLBACK_KEY": "dk", "XAI_API_KEY": "xk"}))
	if cfg == nil || cfg.Provider != "deepseek" || cfg.APIKey != "dk" || cfg.Model != "deepseek-chat" {
		t.Fatalf("generic fallback wrong: %+v", cfg)
	}
}

func TestFallbackCures(t *testing.T) {
	up := func(status int) error {
		return errors.Join(ErrBadGateway, &UpstreamError{Provider: "openai", Status: status})
	}
	for _, c := range []struct {
		name string
		err  error
		want bool
	}{
		{"no provider", ErrBadRequest, true},
		{"rejected key", up(401), true},
		{"forbidden", up(403), true},
		{"no credit", up(402), true},
		{"quota", up(429), true},
		{"unknown model", up(404), true},
		{"outage", up(503), true},
		{"unreachable", errors.Join(ErrBadGateway, ErrProviderUnreachable), true},
		{"text-only provider asked for an image", ErrImageUnsupported, true},
		{"no edit", ErrEditImageUnsupported, true},
		{"no vision", ErrDescribeImageUnsupported, true},
		{"bad request body", up(400), false},
		{"unprocessable", up(422), false},
		{"truncated", errors.Join(ErrBadGateway, ErrReplyTruncated), false},
		{"policy", ErrPolicyBlocked, false},
		{"db error", errors.New("conn reset"), false},
	} {
		if got := fallbackCures(c.err); got != c.want {
			t.Errorf("%s: fallbackCures = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestWithFallbackSelection(t *testing.T) {
	fb := &CallConfig{Provider: ProviderXAI, APIKey: "fb", builtin: true}
	ok := CallConfig{Provider: ProviderOpenAI, APIKey: "mine"}
	rejected := errors.Join(ErrBadGateway, &UpstreamError{Provider: "openai", Status: 401})
	ctx := context.Background()

	type tc struct {
		name      string
		fallback  *CallConfig
		ctx       context.Context
		resolve   func() (CallConfig, error)
		runErr    map[string]error // by key
		wantKeys  []string
		wantErrIs error
	}
	for _, c := range []tc{
		{"own provider works", fb, ctx, func() (CallConfig, error) { return ok, nil }, nil, []string{"mine"}, nil},
		{"no provider, fallback serves", fb, ctx, func() (CallConfig, error) { return CallConfig{}, ErrBadRequest }, nil, []string{"fb"}, nil},
		{"no provider, no fallback", nil, ctx, func() (CallConfig, error) { return CallConfig{}, ErrBadRequest }, nil, nil, ErrBadRequest},
		{"bad key, fallback serves", fb, ctx, func() (CallConfig, error) { return ok, nil }, map[string]error{"mine": rejected}, []string{"mine", "fb"}, nil},
		{"bad key, fallback disabled for this call", fb, WithoutFallback(ctx), func() (CallConfig, error) { return ok, nil }, map[string]error{"mine": rejected}, []string{"mine"}, ErrBadGateway},
		{"policy refusal is final", fb, ctx, func() (CallConfig, error) { return ok, nil }, map[string]error{"mine": ErrPolicyBlocked}, []string{"mine"}, ErrPolicyBlocked},
		{"both fail: the workspace's error wins", fb, ctx, func() (CallConfig, error) { return ok, nil }, map[string]error{"mine": rejected, "fb": ErrImageUnsupported}, []string{"mine", "fb"}, ErrBadGateway},
		{"no provider, fallback fails: its error", fb, ctx, func() (CallConfig, error) { return CallConfig{}, ErrBadRequest }, map[string]error{"fb": ErrPolicyBlocked}, []string{"fb"}, ErrPolicyBlocked},
		{"db error never falls back", fb, ctx, func() (CallConfig, error) { return CallConfig{}, io.ErrUnexpectedEOF }, nil, nil, io.ErrUnexpectedEOF},
	} {
		s := &Service{fallback: c.fallback}
		var got []string
		err := s.withFallback(c.ctx, "ws", c.resolve, func(cfg CallConfig) error {
			got = append(got, cfg.APIKey)
			return c.runErr[cfg.APIKey]
		})
		if strings.Join(got, ",") != strings.Join(c.wantKeys, ",") {
			t.Errorf("%s: ran %v, want %v", c.name, got, c.wantKeys)
		}
		if c.wantErrIs == nil && err != nil || c.wantErrIs != nil && !errors.Is(err, c.wantErrIs) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.wantErrIs)
		}
	}
}

func TestBuiltinViewHasNoKey(t *testing.T) {
	if (&Service{}).BuiltinView() != nil {
		t.Fatal("no fallback, no view")
	}
	v := (&Service{fallback: &CallConfig{Provider: ProviderXAI, APIKey: "secret-key", Model: "m", ImageModel: "im", builtin: true}}).BuiltinView()
	raw, _ := json.Marshal(v)
	if strings.Contains(string(raw), "secret-key") {
		t.Fatal("the fallback key must never be serialized")
	}
	if v.Provider != "xai" || !v.HasKey || !v.Capabilities.Image {
		t.Fatalf("view wrong: %+v", v)
	}
}

// End to end against a stub xAI: a workspace with no provider is served by
// the fallback, one with a rejected key falls back, the stored-config test
// does not, usage is metered, and Effective reports "builtin".
func TestFallback_DB(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, stripSchema(dsn))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	acct := accounts.NewService(tx, "test-jwt-secret")
	_, ws, _, err := acct.Signup(ctx, "ai-fallback+"+uuid.NewString()+"@example.com", "a-strong-password", "Me")
	if err != nil {
		t.Fatalf("signup: %v", err)
	}

	var mu sync.Mutex
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("authorization"), "Bearer ")
		mu.Lock()
		seen = append(seen, key+" "+r.URL.Path)
		mu.Unlock()
		if key != "xk" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/images/generations") {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if _, has := body["size"]; has {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": "QUJD", "mime_type": "image/jpeg"}}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "ok"}}}})
	}))
	defer srv.Close()

	svc := NewService(tx, "test-ai-secret", true)
	svc.fallback = &CallConfig{Provider: ProviderXAI, APIKey: "xk", BaseURL: srv.URL, Model: "grok-x", ImageModel: "grok-imagine-image", builtin: true}

	// No provider: the fallback serves text and images.
	if out, err := svc.Text(ctx, ws.ID, "hi", ""); err != nil || out != "ok" {
		t.Fatalf("text via fallback: %q %v", out, err)
	}
	if img, err := svc.Image(ctx, ws.ID, "an apple", "1024x1024"); err != nil || img != "data:image/jpeg;base64,QUJD" {
		t.Fatalf("image via fallback: %q %v", img, err)
	}
	if u, _ := svc.GetUsage(ctx, ws.ID); u.TokensThisMonth <= imageTokenCost {
		t.Fatalf("fallback usage not metered: %+v", u)
	}
	eff, err := svc.Effective(ctx, ws.ID)
	if err != nil || eff.Source != "builtin" || eff.Config == nil || eff.Config.Provider != "xai" || eff.Builtin == nil {
		t.Fatalf("effective = %+v %v", eff, err)
	}

	// A workspace key the provider rejects: calls fall back...
	if _, err := svc.SetConfig(ctx, ws.ID, ConfigInput{Provider: "custom", BaseURL: strp(srv.URL), APIKey: "bad-key", Model: "m"}); err != nil {
		t.Fatalf("set config: %v", err)
	}
	if out, err := svc.Text(ctx, ws.ID, "hi", ""); err != nil || out != "ok" {
		t.Fatalf("text should fall back past a rejected key: %q %v", out, err)
	}
	// ...but a test of the stored config reports the real failure.
	if _, err := svc.Text(WithoutFallback(ctx), ws.ID, "hi", ""); !errors.Is(err, ErrBadGateway) {
		t.Fatalf("stored-config test must not fall back: %v", err)
	}
	eff, _ = svc.Effective(ctx, ws.ID)
	if eff.Source != "workspace" || eff.Builtin == nil {
		t.Fatalf("effective with own provider = %+v", eff)
	}

	// An admin can still block the fallback provider.
	if err := svc.SetPolicy(ctx, ws.ID, OrgPolicy{BlockedProviders: []string{"xai"}}); err != nil {
		t.Fatalf("set policy: %v", err)
	}
	if _, err := svc.Text(ctx, ws.ID, "hi", ""); !errors.Is(err, ErrBadGateway) {
		t.Fatalf("blocked fallback: want the workspace's own error, got %v", err)
	}
}

// xAI answers a wrong key with 400 "Incorrect API key provided": that is a
// rejected key (401), which the form names and the fallback can cure.
func TestXAIBadKeyIsAuthFailure(t *testing.T) {
	err := badGateway(CallConfig{Provider: ProviderXAI}, &httpStatusError{status: 400, reason: `{"code":"invalid-argument","error":"Incorrect API key provided. You can obtain an API key from https://console.x.ai."}`})
	var up *UpstreamError
	if !errors.As(err, &up) || up.Status != 401 || !fallbackCures(err) {
		t.Fatalf("bad xAI key: %v", err)
	}
	other := badGateway(CallConfig{Provider: ProviderXAI}, &httpStatusError{status: 400, reason: "prompt too long"})
	if !errors.As(other, &up) || up.Status != 400 || fallbackCures(other) {
		t.Fatalf("plain 400 changed: %v", other)
	}
}

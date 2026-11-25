// aidir3 fork: an instance-wide fallback provider, so people can use AI on
// this instance without bringing a key of their own.
//
// The operator opts in from the environment (never from the UI, so the key
// never touches the database or a browser):
//
//	AIDIR3_AI_FALLBACK=xai                 which preset serves as the fallback
//	XAI_API_KEY=...                        the xAI key (xai only)
//	XAI_MODEL / XAI_IMAGE_MODEL            optional model overrides (xai only)
//
// Any other preset that needs neither a base URL nor a second credential can
// serve too, through the generic names:
//
//	AIDIR3_AI_FALLBACK_KEY, AIDIR3_AI_FALLBACK_MODEL, AIDIR3_AI_FALLBACK_IMAGE_MODEL
//
// (the generic names also override the XAI_* ones when both are set).
//
// When it serves: a call in a workspace whose effective provider (its own, or
// the caller's personal one) is missing, cannot do the operation (a text-only
// provider asked for an image), or fails in a way that is about the provider
// rather than the request (a rejected key, no credit, a quota or rate limit,
// an unknown model, an unreachable host, a provider outage). A failure that
// is about the request itself (a 400/413/422, a truncated reply) or a
// workspace policy refusal is returned as is: retrying elsewhere would not
// help, and governance must hold whichever provider serves.
//
// The fallback is metered to the workspace like any call (ai_usages), and the
// workspace policy (allow/block list, monthly cap) is checked against its
// provider id, so an admin can still block it.
package ai

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

// fallbackEnv reads the fallback provider from the environment. It returns nil
// when none is configured or the configuration is unusable (unknown preset, no
// key, or a preset that needs a base URL or a secret), and logs why once.
func fallbackEnv(getenv func(string) string) *CallConfig {
	id := strings.ToLower(strings.TrimSpace(getenv("AIDIR3_AI_FALLBACK")))
	if id == "" || id == "off" || id == "none" {
		return nil
	}
	p := PresetFor(id)
	if p == nil || p.NeedsBaseURL || p.NeedsSecret {
		slog.Warn("ai fallback ignored: unsupported provider", "provider", id)
		return nil
	}
	first := func(names ...string) string {
		for _, n := range names {
			if v := strings.TrimSpace(getenv(n)); v != "" {
				return v
			}
		}
		return ""
	}
	var key, model, imageModel string
	if id == string(ProviderXAI) {
		key = first("AIDIR3_AI_FALLBACK_KEY", "XAI_API_KEY")
		model = first("AIDIR3_AI_FALLBACK_MODEL", "XAI_MODEL")
		imageModel = first("AIDIR3_AI_FALLBACK_IMAGE_MODEL", "XAI_IMAGE_MODEL")
	} else {
		key = first("AIDIR3_AI_FALLBACK_KEY")
		model = first("AIDIR3_AI_FALLBACK_MODEL")
		imageModel = first("AIDIR3_AI_FALLBACK_IMAGE_MODEL")
	}
	if key == "" {
		slog.Warn("ai fallback ignored: no API key in the environment", "provider", id)
		return nil
	}
	cfg := &CallConfig{
		Provider: Provider(id), APIKey: key, BaseURL: p.BaseURL,
		Model: orDefault(model, p.DefaultModel), ImageModel: orDefault(imageModel, p.DefaultImageModel),
		builtin: true,
	}
	slog.Info("ai fallback provider enabled", "provider", id, "model", cfg.Model, "image_model", cfg.ImageModel)
	return cfg
}

func osFallback() *CallConfig { return fallbackEnv(os.Getenv) }

// BuiltinView is the public description of the fallback (never its key), or
// nil when the instance has none.
func (s *Service) BuiltinView() *ConfigView {
	if s.fallback == nil {
		return nil
	}
	caps := Capabilities{Text: true}
	if p := PresetFor(string(s.fallback.Provider)); p != nil {
		caps = p.Capabilities
	}
	model, imageModel := s.fallback.Model, s.fallback.ImageModel
	return &ConfigView{
		Provider: string(s.fallback.Provider), Model: &model, ImageModel: &imageModel,
		HasKey: true, Capabilities: caps,
	}
}

type noFallbackKey struct{}

// WithoutFallback marks a context whose calls must NOT fall back: a connection
// test of a stored provider has to report that provider's own result, or a
// broken key would look healthy.
func WithoutFallback(ctx context.Context) context.Context {
	return context.WithValue(ctx, noFallbackKey{}, true)
}

func fallbackAllowed(ctx context.Context) bool {
	v, _ := ctx.Value(noFallbackKey{}).(bool)
	return !v
}

// fallbackCures reports whether err is a failure the fallback provider could
// plausibly get past: the provider is missing, cannot do this operation, or
// failed for reasons of its own. See the package comment above.
func fallbackCures(err error) bool {
	switch {
	case err == nil, errors.Is(err, ErrPolicyBlocked), errors.Is(err, ErrReplyTruncated):
		return false
	case errors.Is(err, ErrImageUnsupported), errors.Is(err, ErrEditImageUnsupported), errors.Is(err, ErrDescribeImageUnsupported):
		return true
	case errors.Is(err, ErrBadGateway):
		var up *UpstreamError
		if errors.As(err, &up) {
			switch up.Status {
			case http.StatusBadRequest, http.StatusRequestEntityTooLarge, http.StatusUnprocessableEntity:
				return false
			}
		}
		return true
	case errors.Is(err, ErrBadRequest):
		// Raised while RESOLVING the provider: none configured, a key that no
		// longer decrypts, a stored host the SSRF guard now refuses.
		return true
	}
	return false
}

// withFallback resolves the provider for a call and runs it; when that fails in
// a way fallbackCures accepts, and the instance has a fallback, the same
// operation runs once more on the fallback.
//
// Which error the caller sees when both fail: if the workspace had no usable
// provider at all, the fallback's (it is the only provider that was tried for
// real); otherwise the workspace provider's, since that is what its admin can
// fix.
func (s *Service) withFallback(ctx context.Context, workspaceID string, resolve func() (CallConfig, error), run func(CallConfig) error) error {
	cfg, err := resolve()
	resolved := err == nil
	if resolved {
		err = run(cfg)
	}
	if err == nil || s.fallback == nil || cfg.builtin || !fallbackAllowed(ctx) || !fallbackCures(err) {
		return err
	}
	slog.Info("ai call served by the built-in fallback", "workspace", workspaceID, "provider", s.fallback.Provider,
		"from_provider", cfg.Provider, "reason", err.Error())
	ferr := run(*s.fallback)
	if ferr == nil {
		return nil
	}
	slog.Warn("ai built-in fallback failed too", "workspace", workspaceID, "err", ferr)
	if !resolved {
		return ferr
	}
	return err
}

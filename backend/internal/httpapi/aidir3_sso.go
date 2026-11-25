package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/aidir3sso"
)

// mountAidir3SSO attaches single sign-on from aidir3.com (fork-specific).
//
// Configuration, all optional; the feature is off until the secret is set:
//
//	AIDIR3_SSO_SECRET  shared with the site, 32+ characters
//	AIDIR3_SITE_URL    the site's origin, e.g. https://aidir3.com
//	AIDIR3_SSO_START   path on the site that starts the hand-off
//	                   (default /api/design/sso)
//
// Flow: a signed-out visitor is sent to <site><start>?next=<path>. The site
// signs them in if needed, then redirects the browser to
// GET /api/v1/auth/sso/aidir3?token=...&next=<path>. This handler verifies the
// token, finds or creates the account, sets the normal session cookies, and
// redirects into the app. The cookies are SameSite=Lax, which a top-level GET
// redirect satisfies.
func mountAidir3SSO(api chi.Router, acct *accounts.Service, secure bool) {
	verifier := aidir3sso.NewVerifier(os.Getenv("AIDIR3_SSO_SECRET"))
	site := strings.TrimRight(strings.TrimSpace(os.Getenv("AIDIR3_SITE_URL")), "/")
	start := strings.TrimSpace(os.Getenv("AIDIR3_SSO_START"))
	if start == "" {
		start = "/api/design/sso"
	}
	profile := strings.TrimSpace(os.Getenv("AIDIR3_PROFILE_PATH"))
	if profile == "" || !strings.HasPrefix(profile, "/") {
		profile = "/profile"
	}
	enabled := verifier != nil && site != ""
	if os.Getenv("AIDIR3_SSO_SECRET") != "" && !enabled {
		slog.Warn("aidir3 SSO not enabled: AIDIR3_SSO_SECRET needs 32+ characters and AIDIR3_SITE_URL must be set")
	}

	// Public: the sign-in page asks whether to offer "Continue with aidir3".
	api.Get("/auth/sso/aidir3/config", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]any{"enabled": enabled}
		if enabled {
			out["startUrl"] = site + start
			out["siteUrl"] = site
			// The profile lives on the site; the studio links to it.
			out["profileUrl"] = site + profile
		}
		writeJSON(w, http.StatusOK, out)
	})

	api.Get("/auth/sso/aidir3", func(w http.ResponseWriter, r *http.Request) {
		front := frontendURL()
		fail := func(code string) { http.Redirect(w, r, front+"/login?error="+code, http.StatusFound) }
		if !enabled {
			fail("sso")
			return
		}
		claims, err := verifier.Verify(r.URL.Query().Get("token"))
		if err != nil {
			// Say why in the log, never to the browser.
			slog.Warn("aidir3 SSO token rejected", "reason", err.Error(), "ip", clientIP(r))
			fail("sso")
			return
		}
		_, tokens, mfaToken, err := acct.LoginWithAidir3(r.Context(), accounts.Aidir3Profile{
			Subject: claims.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified, Name: claims.Name,
		}, r.UserAgent(), clientIP(r))
		if err != nil {
			switch {
			case errors.Is(err, accounts.ErrMFARequired):
				http.Redirect(w, r, front+"/login?mfa="+url.QueryEscape(mfaToken), http.StatusFound)
			case errors.Is(err, accounts.ErrAidir3Unverified):
				fail("sso_exists")
			default:
				slog.Error("aidir3 SSO sign-in failed", "err", err.Error())
				fail("sso")
			}
			return
		}
		setAuthCookies(w, tokens.Access, tokens.Refresh, secure)
		http.Redirect(w, r, front+safeNextPath(r.URL.Query().Get("next")), http.StatusFound)
	})
}

// safeNextPath keeps a post-sign-in redirect inside this app: a local absolute
// path only. Anything else (another host, a scheme, "//host", a backslash
// trick) falls back to the dashboard, so the endpoint is not an open redirect.
func safeNextPath(next string) string {
	const fallback = "/dashboard"
	if next == "" || len(next) > 512 || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return fallback
	}
	if strings.ContainsAny(next, "\\\r\n") {
		return fallback
	}
	u, err := url.Parse(next)
	if err != nil || u.Host != "" || u.Scheme != "" {
		return fallback
	}
	return next
}

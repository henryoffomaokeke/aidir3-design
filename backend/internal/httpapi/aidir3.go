package httpapi

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/platform/brand"
)

// mountAidir3 attaches everything this fork adds to the API surface, behind
// one hook in server.go so merging upstream changes stays a one-line affair.
func mountAidir3(api chi.Router, acct *accounts.Service, secure bool) {
	mountAidir3About(api)
	mountAidir3SSO(api, acct, secure)
}

// mountAidir3About serves what the app says about itself, including where to
// get its source code.
//
// This app is a modified version of HyCanvas, which is licensed under the
// AGPL-3.0. Section 13 of that licence requires a modified version that people
// use over a network to offer those people its complete corresponding source.
// Set AIDIR3_SOURCE_URL to the public location of this fork's source (the
// repository or a download page); the interface then shows a "Source code"
// link to every signed-in user. Running a public instance without it set does
// not meet the licence.
func mountAidir3About(api chi.Router) {
	source := strings.TrimSpace(os.Getenv("AIDIR3_SOURCE_URL"))
	if source != "" && !strings.HasPrefix(source, "https://") && !strings.HasPrefix(source, "http://") {
		source = ""
	}
	api.Get("/aidir3/about", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"name":        brand.Name,
			"basedOn":     "HyCanvas",
			"upstreamUrl": "https://github.com/hyscaler/HyCanvas",
			"license":     "AGPL-3.0-only",
			"sourceUrl":   source,
		})
	})
}

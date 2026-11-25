package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
	"hycanvas/backend/internal/templates"
	"hycanvas/backend/internal/templates/legacy"
)

// mountTemplateVariations attaches the variation catalogue of the ported
// template library (package templates/legacy):
//
//	GET /templates/variations?q=&base=&category=&format=&offset=&limit=   one page of variations
//	GET /templates/variations/summary                                     total + count per base design
//	GET /templates/photos/*                                               template pictures (public)
//
// A variation itself is opened, previewed and applied through the ordinary
// /templates/{id} routes (its id is "lv-<old listing id>"). The pictures are
// public like /assets/{id}/content: they are openly licensed photos, and a
// shared or exported design must load them without a session.
func mountTemplateVariations(api chi.Router, tm *templates.Service, acct *accounts.Service, photos *legacy.Photos) {
	api.Group(func(r chi.Router) {
		r.Use(requireAuth(acct))
		r.Get("/templates/variations", templateVariationsHandler(tm))
		r.Get("/templates/variations/summary", templateVariationSummaryHandler(tm))
	})
	if photos != nil {
		templatePictures = photos
		api.Get("/templates/photos/*", templatePhotoHandler(photos))
		api.Head("/templates/photos/*", templatePhotoHandler(photos))
	}
}

func templateVariationsHandler(tm *templates.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		offset, _ := strconv.Atoi(q.Get("offset"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		page, err := tm.ListVariations(r.Context(), templates.VariationQuery{
			Text: q.Get("q"), BaseID: q.Get("base"), Category: q.Get("category"), Format: q.Get("format"), Offset: offset, Limit: limit,
		})
		if err != nil {
			templatesProblem(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}
}

func templateVariationSummaryHandler(tm *templates.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := tm.VariationSummary(r.Context())
		if err != nil {
			templatesProblem(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=3600")
		writeJSON(w, http.StatusOK, s)
	}
}

func templatePhotoHandler(photos *legacy.Photos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, mime, err := photos.Photo(r.Context(), chi.URLParam(r, "*"))
		if err != nil {
			if errors.Is(err, legacy.ErrPhotoNotFound) {
				problemWithCode(w, r, http.StatusNotFound, "Not Found", "template picture not found", "template_photo_not_found")
				return
			}
			problemWithCode(w, r, http.StatusBadGateway, "Bad Gateway", "template picture unavailable", "template_photo_unavailable")
			return
		}
		w.Header().Set("Content-Type", mime)
		setUntrustedContentHeaders(w)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		if r.Method != http.MethodHead {
			_, _ = w.Write(data)
		}
	}
}

// templatePictures serves template pictures to the server-side renderers
// (set when the variation routes mount).
var templatePictures *legacy.Photos

// withTemplatePictures lets a design's template pictures (assets whose url is
// under legacy.PhotoURLPrefix rather than workspace uploads, as in a template
// preview or a design whose pictures could not be imported) render in server
// exports: an asset the workspace does not hold is read from the template
// picture service instead of drawing nothing.
func withTemplatePictures(fetch assetContent, file map[string]any) assetContent {
	ph := templatePictures
	if ph == nil {
		return fetch
	}
	urls := map[string]string{}
	assets, _ := file["assets"].([]any)
	for _, a := range assets {
		m, _ := a.(map[string]any)
		id, _ := m["id"].(string)
		u, _ := m["url"].(string)
		if id != "" && strings.HasPrefix(u, legacy.PhotoURLPrefix) {
			urls[id] = strings.TrimPrefix(u, legacy.PhotoURLPrefix)
		}
	}
	if len(urls) == 0 {
		return fetch
	}
	return func(aid string) ([]byte, string, error) {
		data, mime, err := fetch(aid)
		if err == nil && len(data) > 0 {
			return data, mime, nil
		}
		path, ok := urls[aid]
		if !ok {
			return data, mime, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if b, m, perr := ph.Photo(ctx, path); perr == nil {
			return b, m, nil
		}
		return data, mime, err
	}
}

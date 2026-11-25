package templates

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"hycanvas/backend/internal/templates/legacy"
)

// Variations of the ported library (package legacy): every listing of the old
// aidir3 Design gallery, reachable by a template id "lv-<old id>" and built on
// demand. They answer the same calls a built-in template does (get, file,
// fillable fields, apply), so the gallery and the editor treat one like any
// other public template; the gallery lists them through ListVariations.

// variation materialises a variation and returns its template view and file.
func variation(ctx context.Context, id string) (Template, map[string]any, error) {
	res, err := legacy.Materialise(ctx, id)
	if errors.Is(err, legacy.ErrNotFound) {
		return Template{}, nil, ErrNotFound
	}
	if err != nil {
		return Template{}, nil, err
	}
	var t Template
	if err := json.Unmarshal(res.Template, &t); err != nil {
		return Template{}, nil, err
	}
	var f map[string]any
	if err := json.Unmarshal(res.File, &f); err != nil {
		return Template{}, nil, err
	}
	return t, f, nil
}

// VariationQuery is the variation list query (see legacy.Query).
type VariationQuery = legacy.Query

// ListVariations returns one page of variations.
func (s *Service) ListVariations(_ context.Context, q VariationQuery) (legacy.Page, error) {
	return legacy.List(q)
}

// VariationSummary counts variations per base design.
func (s *Service) VariationSummary(_ context.Context) (legacy.Summary, error) {
	return legacy.Summarize()
}

// AssetImporter turns the template pictures of a design (assets served from
// legacy.PhotoURLPrefix) into assets of the workspace the design is created
// in, so an applied template is an ordinary design: its pictures export,
// count against storage and survive the template catalogue changing. It
// rewrites the file in place and leaves a picture it cannot import as it was
// (still shown from its template url).
type AssetImporter func(ctx context.Context, userID, workspaceID string, file map[string]any)

// WithAssetImporter sets the importer Apply runs before creating the design.
func (s *Service) WithAssetImporter(f AssetImporter) *Service {
	s.importAssets = f
	return s
}

// hasTemplatePhotos reports whether a file references template pictures.
func hasTemplatePhotos(file map[string]any) bool {
	for _, a := range asArr(file["assets"]) {
		if strings.HasPrefix(asStr(asObj(a)["url"]), legacy.PhotoURLPrefix) {
			return true
		}
	}
	return false
}

// isVariationID reports whether a template id names a variation (and not a
// built-in or saved template, whose ids never carry the prefix).
func isVariationID(id string) bool {
	if !legacy.IsID(id) {
		return false
	}
	_, seeded := findSeed(id)
	return !seeded
}

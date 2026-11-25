package legacy

import (
	"context"
	"path"
	"strings"
)

// StoreFunc stores picture bytes as an asset of a workspace and returns the
// new asset's id and url (uploads.Service.StoreBuiltin).
type StoreFunc func(ctx context.Context, workspaceID, ownerID, filename string, data []byte) (id, url string, err error)

// Importer returns the hook templates.Service runs when a template is applied:
// every template picture the design references (an asset whose url is under
// PhotoURLPrefix) is copied into the workspace's library and the design's
// asset table and image nodes are pointed at the copy. The node's provenance
// (licence and credit) stays as it was. A picture that cannot be had keeps
// its template url, which the editor still shows.
func Importer(ph *Photos, store StoreFunc) func(ctx context.Context, userID, workspaceID string, file map[string]any) {
	return func(ctx context.Context, userID, workspaceID string, file map[string]any) {
		remap := map[string]string{}
		for _, a := range asArr(file["assets"]) {
			ref := asObj(a)
			u, _ := ref["url"].(string)
			if !strings.HasPrefix(u, PhotoURLPrefix) {
				continue
			}
			data, _, err := ph.Photo(ctx, strings.TrimPrefix(u, PhotoURLPrefix))
			if err != nil {
				continue
			}
			id, url, err := store(ctx, workspaceID, userID, path.Base(u), data)
			if err != nil || id == "" {
				continue
			}
			old, _ := ref["id"].(string)
			remap[old] = id
			ref["id"] = id
			ref["url"] = url
		}
		if len(remap) == 0 {
			return
		}
		for _, p := range asArr(file["pages"]) {
			for _, n := range asArr(asObj(p)["children"]) {
				walk(asObj(n), func(node map[string]any) {
					src := asObj(node["source"])
					if src == nil {
						return
					}
					if id, ok := src["assetId"].(string); ok {
						if nw, ok := remap[id]; ok {
							src["assetId"] = nw
						}
					}
				})
			}
		}
	}
}

func walk(n map[string]any, fn func(map[string]any)) {
	if n == nil {
		return
	}
	fn(n)
	for _, c := range asArr(n["children"]) {
		walk(asObj(c), fn)
	}
}

func asArr(v any) []any          { a, _ := v.([]any); return a }
func asObj(v any) map[string]any { m, _ := v.(map[string]any); return m }

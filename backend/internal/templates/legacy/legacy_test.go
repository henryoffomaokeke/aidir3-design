package legacy

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// The old gallery listed 199,605 templates; every one must be a row here.
const oldListed = 199605

func TestCatalogueCoversTheOldGallery(t *testing.T) {
	c, err := load()
	if err != nil {
		t.Fatal(err)
	}
	if n := len(c.Rows.K); n != oldListed || c.Listed != oldListed {
		t.Fatalf("catalogue has %d rows (listed %d), want %d", n, c.Listed, oldListed)
	}
	// Ids are rebuilt from the rows: they must be unique, or one listing would hide another.
	if len(c.byID) != oldListed {
		t.Fatalf("%d distinct ids for %d rows", len(c.byID), oldListed)
	}
	sum := 0
	for _, rows := range c.perBase {
		sum += len(rows)
	}
	if sum != oldListed {
		t.Fatalf("base designs cover %d rows, want %d", sum, oldListed)
	}
}

func TestListFiltersAndPages(t *testing.T) {
	all, err := List(Query{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != oldListed || len(all.Items) != 10 {
		t.Fatalf("unfiltered: total %d, items %d", all.Total, len(all.Items))
	}
	s, _ := Summarize()
	b := s.Bases[0]
	byBase, _ := List(Query{BaseID: b.BaseID, Limit: 200})
	if byBase.Total != b.Count {
		t.Fatalf("base %s: %d listed, summary says %d", b.BaseID, byBase.Total, b.Count)
	}
	for _, v := range byBase.Items {
		if v.BaseID != b.BaseID || !IsID(v.ID) {
			t.Fatalf("base filter leaked %+v", v)
		}
	}
	next, _ := List(Query{BaseID: b.BaseID, Offset: 200, Limit: 200})
	if len(byBase.Items) == 200 && len(next.Items) > 0 && next.Items[0].ID == byBase.Items[0].ID {
		t.Fatal("offset does not page")
	}
	for _, q := range []Query{{Text: "wedding invitation"}, {Text: "resume"}, {Category: "certificates"}, {Format: "yt-thumb"}, {Text: "aso-ebi"}} {
		p, err := List(q)
		if err != nil || p.Total == 0 {
			t.Fatalf("%+v: %d results (%v)", q, p.Total, err)
		}
	}
	// Name hits lead: a search for a niche starts with listings named after it.
	p, _ := List(Query{Text: "bakery", Limit: 5})
	if !strings.Contains(strings.ToLower(p.Items[0].Title), "bakery") {
		t.Fatalf("first hit for bakery is %q", p.Items[0].Title)
	}
	if none, _ := List(Query{Text: "zzqqxx-no-such-word"}); none.Total != 0 {
		t.Fatalf("nonsense search found %d", none.Total)
	}
}

func TestMaterialiseASpread(t *testing.T) {
	if testing.Short() {
		t.Skip("runs the legacy engine")
	}
	c, err := load()
	if err != nil {
		t.Fatal(err)
	}
	// One listing of every base design, plus every kind of listing.
	ids := []string{}
	for _, rows := range c.perBase {
		if len(rows) > 0 {
			ids = append(ids, IDPrefix+c.oldID(int(rows[len(rows)/2])))
		}
	}
	for _, id := range ids {
		res, err := Materialise(context.Background(), id)
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		var tpl struct {
			ID     string `json:"id"`
			Format struct{ Width, Height float64 }
		}
		var file struct {
			Format string `json:"format"`
			Pages  []struct {
				Width, Height float64
				Children      []json.RawMessage
			}
			Assets []struct{ URL string }
		}
		if json.Unmarshal(res.Template, &tpl) != nil || json.Unmarshal(res.File, &file) != nil {
			t.Fatalf("%s: unreadable output", id)
		}
		v, _ := Lookup(id)
		if tpl.ID != id || file.Format != "hycanvas.design" || len(file.Pages) == 0 || len(file.Pages[0].Children) == 0 {
			t.Fatalf("%s: template %q, %d pages", id, tpl.ID, len(file.Pages))
		}
		if int(file.Pages[0].Width) != v.Width || int(file.Pages[0].Height) != v.Height {
			t.Fatalf("%s: page %vx%v, listing is %dx%d", id, file.Pages[0].Width, file.Pages[0].Height, v.Width, v.Height)
		}
		for _, a := range file.Assets {
			if !strings.HasPrefix(a.URL, PhotoURLPrefix) {
				t.Fatalf("%s: asset outside the template pictures: %s", id, a.URL)
			}
		}
	}
	// A second call is served from the cache.
	if _, err := Materialise(context.Background(), ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := Materialise(context.Background(), IDPrefix+"g-no-such-listing"); err != ErrNotFound {
		t.Fatalf("unknown id: %v", err)
	}
}

func TestPhotoPaths(t *testing.T) {
	p := &Photos{}
	if _, mime, err := p.Photo(context.Background(), "cutouts/faces/d335c35e-2d56-4452-977c-a78e8a1297e1-o.webp"); err != nil || mime != "image/webp" {
		t.Fatalf("embedded cut-out: %v %s", err, mime)
	}
	for _, bad := range []string{"../legacy.go", "ov/not-an-id.jpg", "cutouts/../../catalog.json.gz", "ov/00000000-0000-0000-0000-000000000000.jpg"} {
		if _, _, err := p.Photo(context.Background(), bad); err == nil {
			t.Fatalf("%s served", bad)
		}
	}
}

func TestImporterRewritesTemplatePictures(t *testing.T) {
	p := &Photos{}
	file := map[string]any{
		"assets": []any{
			map[string]any{"id": "tplph-cut-x", "url": PhotoURLPrefix + "cutouts/faces/d335c35e-2d56-4452-977c-a78e8a1297e1-o.webp"},
			map[string]any{"id": "other", "url": "/api/v1/assets/a1/content"},
		},
		"pages": []any{map[string]any{"children": []any{
			map[string]any{"type": "frame", "children": []any{map[string]any{"type": "image", "source": map[string]any{"assetId": "tplph-cut-x"}}}},
		}}},
	}
	Importer(p, func(_ context.Context, ws, owner, name string, data []byte) (string, string, error) {
		if ws != "ws1" || owner != "u1" || len(data) == 0 || !strings.HasSuffix(name, ".webp") {
			t.Fatalf("store got %s %s %s %d", ws, owner, name, len(data))
		}
		return "asset-9", "/api/v1/assets/asset-9/content", nil
	})(context.Background(), "u1", "ws1", file)
	a := asObj(asArr(file["assets"])[0])
	img := asObj(asArr(asObj(asArr(asObj(asArr(file["pages"])[0])["children"])[0])["children"])[0])
	if a["id"] != "asset-9" || a["url"] != "/api/v1/assets/asset-9/content" || asObj(img["source"])["assetId"] != "asset-9" {
		t.Fatalf("not rewritten: %v %v", a, img)
	}
	if asObj(asArr(file["assets"])[1])["id"] != "other" {
		t.Fatal("a workspace asset was touched")
	}
}

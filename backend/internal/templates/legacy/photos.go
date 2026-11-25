package legacy

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// The pictures template designs carry. Ported templates (built-ins and
// variations) reference them as ordinary design assets whose url is
// /api/v1/templates/photos/<path>:
//
//	ov/<openverse id>.jpg       a photo the old library picked from Openverse
//	                            (cc0, public domain or CC BY; the credit sits
//	                            on the image node and in the template)
//	cutouts/<id>.webp           a cut-out person the old library shipped
//	cutouts/faces/<id>[-o].webp
//
// A picture embedded here is served as is (the cut-outs, and the photos the
// built-in templates use, so those work offline). Any other Openverse photo is
// fetched once, downscaled, and kept in object storage under
// template-photos/, so each one leaves the instance at most once.
//
//go:embed all:photos
var photoFS embed.FS

var (
	ovPath  = regexp.MustCompile(`^ov/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$`)
	cutPath = regexp.MustCompile(`^cutouts/(faces/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-o)?\.webp$`)
)

// PhotoURLPrefix is the url path template photo assets are served under.
const PhotoURLPrefix = "/api/v1/templates/photos/"

// Photos serves template pictures.
type Photos struct {
	// Fetch downloads an image from a public URL with the instance's SSRF
	// policy (uploads.Service.FetchImage). Nil: only embedded and cached
	// pictures are served.
	Fetch func(ctx context.Context, url string) ([]byte, error)
	// Get and Put read and write the storage cache (storage.Driver). Nil: no cache.
	Get func(key string) ([]byte, error)
	Put func(key string, data []byte) error
	// OpenverseAPI is the Openverse API base (tests point it elsewhere).
	OpenverseAPI string
	client       *http.Client
	mu           sync.Mutex
	busy         map[string]*photoCall
}

type photoCall struct {
	done chan struct{}
	data []byte
	err  error
}

// ErrPhotoNotFound is returned for a path that names no picture, or one that
// cannot be had right now.
var ErrPhotoNotFound = errors.New("template photo not found")

// maxPhotoEdge is the longest side a fetched photo is stored at: plenty for a
// full-page background, a fraction of a camera original.
const maxPhotoEdge = 1600

// Photo returns the bytes and media type of the picture at path.
func (p *Photos) Photo(ctx context.Context, path string) ([]byte, string, error) {
	if b, err := fs.ReadFile(photoFS, "photos/"+path); err == nil && (ovPath.MatchString(path) || cutPath.MatchString(path)) {
		return b, mimeOf(path), nil
	}
	if cutPath.MatchString(path) {
		return nil, "", ErrPhotoNotFound
	}
	m := ovPath.FindStringSubmatch(path)
	if m == nil {
		return nil, "", ErrPhotoNotFound
	}
	key := "template-photos/" + path
	if p.Get != nil {
		if b, err := p.Get(key); err == nil && len(b) > 0 {
			return b, "image/jpeg", nil
		}
	}
	if p.Fetch == nil {
		return nil, "", ErrPhotoNotFound
	}
	// One download per picture, however many previews ask at once.
	p.mu.Lock()
	if p.busy == nil {
		p.busy = map[string]*photoCall{}
	}
	if c, ok := p.busy[path]; ok {
		p.mu.Unlock()
		select {
		case <-c.done:
			if c.err != nil {
				return nil, "", c.err
			}
			return c.data, "image/jpeg", nil
		case <-ctx.Done():
			return nil, "", ctx.Err()
		}
	}
	c := &photoCall{done: make(chan struct{})}
	p.busy[path] = c
	p.mu.Unlock()
	// The download outlives one impatient client: others may be waiting on it.
	fctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	c.data, c.err = p.fetchOpenverse(fctx, m[1])
	cancel()
	if c.err == nil && p.Put != nil {
		_ = p.Put(key, c.data)
	}
	p.mu.Lock()
	delete(p.busy, path)
	p.mu.Unlock()
	close(c.done)
	if c.err != nil {
		return nil, "", c.err
	}
	return c.data, "image/jpeg", nil
}

func mimeOf(path string) string {
	if strings.HasSuffix(path, ".webp") {
		return "image/webp"
	}
	return "image/jpeg"
}

// fetchOpenverse resolves an Openverse id to its source image (the id comes
// from the catalogue, the URL from Openverse, never from the caller) and
// falls back to Openverse's own thumbnail when the source will not serve.
func (p *Photos) fetchOpenverse(ctx context.Context, id string) ([]byte, error) {
	api := p.OpenverseAPI
	if api == "" {
		api = "https://api.openverse.org/v1/images/"
	}
	if p.client == nil {
		p.client = &http.Client{Timeout: 15 * time.Second}
	}
	var src string
	if req, err := http.NewRequestWithContext(ctx, http.MethodGet, api+id+"/", nil); err == nil {
		req.Header.Set("User-Agent", "aidir3-design-templates/1.0")
		if res, err := p.client.Do(req); err == nil {
			var meta struct {
				URL string `json:"url"`
			}
			if res.StatusCode == http.StatusOK {
				_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&meta)
			}
			res.Body.Close()
			if strings.HasPrefix(meta.URL, "https://") {
				src = meta.URL
			}
		}
	}
	tries := []string{}
	if src != "" {
		tries = append(tries, src)
	}
	tries = append(tries, api+id+"/thumbnail/")
	for _, u := range tries {
		b, err := p.Fetch(ctx, u)
		if err != nil || len(b) == 0 {
			continue
		}
		if out, ok := shrink(b); ok {
			return out, nil
		}
	}
	return nil, ErrPhotoNotFound
}

// shrink decodes a photo and re-encodes it as a JPEG no larger than
// maxPhotoEdge on its long side.
func shrink(b []byte) ([]byte, bool) {
	img, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, false
	}
	r := img.Bounds()
	w, h := r.Dx(), r.Dy()
	if w <= 0 || h <= 0 {
		return nil, false
	}
	if w > maxPhotoEdge || h > maxPhotoEdge {
		k := float64(maxPhotoEdge) / float64(max(w, h))
		nw, nh := max(1, int(float64(w)*k+0.5)), max(1, int(float64(h)*k+0.5))
		dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, r, draw.Src, nil)
		img = dst
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 84}); err != nil {
		return nil, false
	}
	return out.Bytes(), true
}

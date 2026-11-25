package httpapi

import "testing"

func TestSafeNextPath(t *testing.T) {
	cases := map[string]string{
		"":                               "/dashboard",
		"/dashboard/templates/":          "/dashboard/templates/",
		"/editor/abc?page=2":             "/editor/abc?page=2",
		"https://evil.example/":          "/dashboard",
		"//evil.example/":                "/dashboard",
		"/\\evil.example":                "/dashboard",
		"dashboard":                      "/dashboard",
		"javascript:alert(1)":            "/dashboard",
		"/ok\r\nSet-Cookie: x=1":         "/dashboard",
		"/%2F%2Fevil.example":            "/%2F%2Fevil.example", // stays a local path
		"/dashboard#x":                   "/dashboard#x",
		"/a" + string(make([]byte, 600)): "/dashboard",
	}
	for in, want := range cases {
		if got := safeNextPath(in); got != want {
			t.Errorf("safeNextPath(%q) = %q, want %q", in, got, want)
		}
	}
}

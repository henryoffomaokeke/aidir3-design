# aidir3 Design: modifications to HyCanvas

This repository is a modified version of [HyCanvas](https://github.com/hyscaler/HyCanvas) by HyScaler,
licensed under the GNU Affero General Public License v3.0 (see `LICENSE`). It is the source of the
design studio that aidir3 runs at https://design.aidir3.com, published to meet the AGPL.

"HyCanvas" and its logo are trademarks of HyScaler (see `TRADEMARKS.md`). This version is not
endorsed by HyScaler and is shipped under the aidir3 name. The file-format identifiers
(`hycanvas.design`, `.hyc`, `@hc/*`) are kept unchanged for compatibility.

## Changes (November 2026, branch `aidir3`)

- **Branding:** aidir3 name, logo, icons and colour theme (`scripts/aidir3/rebrand.mjs`,
  `scripts/aidir3/build-icons.mjs`, `frontend/src/theme.config.mjs`); dark theme by default.
- **Sign-in through aidir3:** a single-use, signed hand-off from aidir3.com
  (`backend/internal/aidir3sso`, `backend/internal/accounts/aidir3_sso.go`,
  `backend/internal/httpapi/aidir3*.go`, migration `20261125000000_aidir3_sso`,
  `frontend/src/components/auth/Aidir3Gate.tsx`). Emailed sign-in links are off by default.
- **Templates:** about 440 built-in designs, including security, enterprise, technology, governance
  and YouTube sets (`scripts/templates/a3-*.json`), and the aidir3 legacy library served as on-demand
  variations (`backend/internal/templates/legacy/`).
- **Editor:** a collapsible pro toolbox (`frontend/src/components/editor/toolbox/`) and a YouTube kit:
  thumbnail sizes, chapters, end screens, thumbnail from a video frame, Shorts and SRT
  (`frontend/src/components/editor/YouTubePanel.tsx`, `frontend/src/lib/video/youtube.ts`).
- **AI:** xAI Grok as an optional built-in provider and fallback (`backend/internal/ai/`).
- **Source offer:** `GET /api/v1/aidir3/about` and a "Source code" link (`AIDIR3_SOURCE_URL`).

Bundled photos keep their own licences (CC0, public domain or CC BY); credits are stored with each
image in the template data.

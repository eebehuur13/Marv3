# Project Marble

Marble is a Cloudflare-first playground for storing plain-text docs and experimenting with retrieval-augmented chat. The Worker uses Hono, D1, R2, and Vectorize; the frontend is a React + Vite SPA. Authentication through Cloudflare Access is planned, but today the Worker falls back to a deterministic dev user, so you can run everything locally without Access secrets.

## What you can do
- Upload `.txt` files (≤5&nbsp;MB) via the SPA or the `/api/upload-direct` route; the Worker stores them as-is in R2, tracks metadata in D1, and immediately begins ingestion into Vectorize. Private uploads isolate embeddings under a user-specific namespace derived from the uploader’s Access ID.
- Trigger ingestion to chunk files (1.5k chars, 200-char overlap), embed with OpenAI, and write vectors into the configured Vectorize index.
- Ask `/api/chat` questions that cite folder, file, and inclusive line ranges from retrieved chunks.
- Explore the refreshed sidebar navigation (Home, Chat, Personal Files, Library, Inbox, Team Members, User Directory, User Profile, Following, Analytics, About) with staging views ready for upcoming features.
- Manage folders and documents from the SPA with bulk actions (multi-select delete, personal folder removal once empty). Visibility now supports three scopes: `personal` (only you), `team` (members of a given Marble team), and `organization` (everyone in the tenant). Owners keep write access while org/team members get read-only access unless explicitly granted.
- Seed or upload an organization roster (`.txt`, one record per line) to provision accounts and mark admins/owners, then invite rostered users into teams from the Team Members view.
- List, create, and manage teams directly from the SPA—adjust roles, revoke access, and monitor pending invites backed by the new D1 tables.
- Search the user directory (name, email, username) using the Access-provisioned roster and Cloudflare Access metadata so you can quickly share files or add teammates to a team.
- Inspect end-to-end retrieval with `/api/debug/*` routes (embed, query, file drill-down, vector stats).

## Requirements
- Node.js 18 or 20 (matches Wrangler support) and npm.
- A Cloudflare account with:
  - D1 database for `MARBLE_DB` (and optionally `MARBLE_DB_TEST`).
  - R2 bucket `MARBLE_FILES`.
  - Vectorize index `marble_vectors` (dimensions must match your embedding model).
- OpenAI API key with access to `text-embedding-3-small` and the chat model named in `wrangler.toml`.
- `npx wrangler@4` (all Worker commands below use Wrangler v4 explicitly).

## Installation
```bash
npm install
(cd frontend && npm install)
```

## Configure Cloudflare bindings
1. Edit `wrangler.toml` and replace the stub `database_id`, `bucket_name`, and `index_name` in the marv3 configuration with your resource IDs before deploying.
2. Decide how you want to handle auth during development:
   - **No Access (default):** do nothing. The Worker injects a `dev-user` identity for every request.
   - **Cloudflare Access:** set these secrets so `authenticateRequest` will enforce tokens:
     ```bash
     npx wrangler@4 secret put CF_ACCESS_AUD
     npx wrangler@4 secret put CF_ACCESS_TEAM_DOMAIN
     ```
     Optionally set `SKIP_ACCESS_CHECK=true` to bypass verification temporarily.
3. Set the required OpenAI secret:
   ```bash
   npx wrangler@4 secret put OPENAI_API_KEY
   ```
4. Optional but handy (set if your frontend runs on a different origin):
   ```bash
   npx wrangler@4 secret put ALLOWED_ORIGIN
   ```
5. If you plan to expose the Worker publicly, also configure `VECTOR_TOP_K`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `OPENAI_MODEL`, and `OPENAI_EMBEDDING_MODEL` in `wrangler.toml` to match your infra.

## Local development
1. Start the Worker (makes Cloudflare calls, so run remote mode if you rely on managed D1/R2/Vectorize):
   ```bash
   # local mode (needs wrangler dev storage)
   npx wrangler@4 dev --local --port 8787

   # or hit real Cloudflare resources
   npx wrangler@4 dev --remote --port 8787
   ```
2. In a second terminal run the SPA:
   ```bash
   cd frontend
   npm run dev
   ```
3. Visit `http://localhost:5173`. If `VITE_API_BASE` is not set, Vite proxies `/api/*` to `http://127.0.0.1:8787`. To point at a deployed Worker instead, create `frontend/.env.local` with `VITE_API_BASE=https://<your-worker-host>`.

## Database migrations & seeds
```bash
# Apply migrations
npx wrangler@4 d1 migrations apply MARBLE_DB

# Optional: load demo folders/users
npx wrangler@4 d1 execute MARBLE_DB --file ./seeds/seed.sql
```

## Running tests
```bash
npm test
```
Tests use the mocks in `tests/helpers/` to simulate R2, D1, Vectorize, and OpenAI.

## Deploying
```bash
# Deploy the marv3 Worker
npx wrangler@4 deploy

# Build the SPA (deploy to Pages or your static host)
cd frontend
npm run build
```
Create a Cloudflare Pages project (for example `marv3-app`) that points to the built `dist/` output. Add the resulting hostname to your Access policy and set the `ALLOWED_ORIGIN` secret (production uses `https://siematap.xyz`).
Point your static hosting to the Vite build output. If you protect the app with Cloudflare Access, serve the SPA and `/api` Worker on the same eTLD+1 (for production we route both through `https://siematap.xyz` and `https://siematap.xyz/api/*`) so the Access cookie remains first-party; otherwise browsers will drop it on fetch/XHR requests.

### Cloudflare Access branding
Keep the Access login page consistent with the in-app Marble styling:
- Logo assets live in `assets/marble-access-logo.{svg,png}`.
- Recommended colors, copy, and rollback notes are in `docs/access-branding.md`.
- Update the team appearance and the specific Access application for your production hostname together so users see the same look before and after signing in.

## API overview
- `POST /api/upload-url` – generate presigned upload URL to R2.
- `POST /api/upload-direct` – store raw text body straight into R2 (helpful for CLI tooling).
- `POST /api/ingest` – chunk + embed any ready files.
- `POST /api/chat` – run retrieval-augmented chat.
- `GET /api/files` / `DELETE /api/files/:id` – list and delete files for the current user scope.
- `PATCH /api/files/:id` – rename files or move them between personal/team/organization scopes.
- `GET /api/files/:id/sharing` / `PATCH /api/files/:id/sharing` – inspect and update explicit share permissions.
- `GET /api/organization/roster` / `POST /api/organization/roster` – inspect or replace the org roster (admins/owners only for uploads).
- `GET /api/teams` / `POST /api/teams` – list and create teams.
- `POST /api/teams/:id/invite` / `POST /api/teams/:id/accept` – invite rostered users to teams or accept pending invites.
- `PATCH /api/teams/:id/members/:userId` / `DELETE /api/teams/:id/members/:userId` – change a member’s role or remove them.
- `GET /api/directory/users` – search the organization directory (name/email/username) with roster-backed data.
- `GET /api/debug/embed|query|file|probe-file|stats` – diagnostics for embeddings and vector index state.

## Project layout
```
api/             Cloudflare Worker routes, libs, and handlers
frontend/        React + Vite single-page app
migrations/      D1 schema migrations
seeds/           Optional seed data for demo folders/users
tests/           Vitest suites with mocked Cloudflare/OpenAI services
```

## Notes & conventions
- Public folders live under the reserved IDs `public-root` (organization) and `private-root` (personal). Team system folders follow `team:{teamId}`. User-specific storage follows `user:{base64url(id)}` for vectors and `users/{id}` for R2 keys.
- Uploaded PDFs and DOCX files are converted to `.txt` with the same basename before storage; only the text representation is persisted and ingested.
- Chunk ranges are inclusive; if you modify chunk size or overlap keep the overlap ≥200 characters (update this README if you change the invariant).
- The Worker defaults `ALLOWED_ORIGIN` to `http://localhost:5173`; override via secret if your frontend runs elsewhere.
- Keep `wrangler.toml` and automation scripts in sync when you swap OpenAI models or embedding dimensions to avoid Vectorize errors.

## Troubleshooting
- **OpenAI errors:** confirm `OPENAI_API_KEY` is present and the models referenced in `wrangler.toml` exist for your account.
- **Vector dimension mismatch:** ensure the Vectorize index dimension equals the embedding model dimension before ingesting.
- **Access failures:** verify `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` secrets, or temporarily set `SKIP_ACCESS_CHECK=true` if you need to bypass Access while iterating locally.

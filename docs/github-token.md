# Creating and storing your GitHub token

Concilium can make authenticated GitHub API calls if you provide a personal
access token.

A token is **required for the New Project flow** (⧉ in the header) because
repository creation uses authenticated `POST /user/repos`. For read-only
features (for example the active-agent indicator on PR rows), a token is
optional, but unauthenticated requests are rate-limited more aggressively.

## Token type

Use a **classic** personal access token rather than a fine-grained one.

Fine-grained tokens are tied to a single resource owner. A token scoped only to
your account can return `403 forbidden` against repos owned by other users or
organizations. Classic tokens work across repositories you can access.

## Create a token

Create a classic token at <https://github.com/settings/tokens/new>.

![GitHub classic PAT settings for Concilium](../screenshots/GitHubToken.png)

1. **Note** — any memorable name (for example `Concilium`).
2. **Expiration** — set an expiry date.
3. **Select scopes** — tick **`repo`** (full private repo scope). This covers
   current Concilium features, including reading issues/PRs and creating repos.
   If you only need public repos, **`public_repo`** is enough. Optionally add
   **`delete_repo`** if you want Concilium to delete an orphaned repo when a
   post-create `git clone` fails.
4. Click **Generate token**, copy it, then paste it into **Settings (⚙) → GitHub token**.
   Submit an empty value to clear it.

## Storage

Concilium stores the token as `githubToken` in:

`~/.concilium/config.yaml`

Keep `~/.concilium/` readable only by your user account.

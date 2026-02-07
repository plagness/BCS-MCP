# Contributing

## Branching
- Use `main` as the release branch.
- Create short-lived feature branches and open PRs.

## Versioning
- Keep module version in `VERSION` (`YYYY.MM.x`).
- Reflect every public change in `CHANGELOG.md`.

## Local checks
- `docker compose -f compose.yml config`
- `docker compose -f compose.yml up -d --build`
- `curl -fsS http://127.0.0.1:3332/health`

## Secrets
- Never commit real tokens.
- Keep only `.env.example` in git.
- Use local `.env` for runtime values.

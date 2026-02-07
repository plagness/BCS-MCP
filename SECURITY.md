# Security Policy

## Reporting vulnerabilities
Report privately to maintainers before public disclosure.

Include:
- affected component/version,
- reproduction,
- expected impact.

## Secret handling
- `.env` must be untracked.
- Rotate exposed credentials immediately.
- If a secret lands in git history, perform cleanup and force-push as needed.

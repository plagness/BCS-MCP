# Changelog

## [2026.02.4] - 2026-02-07

- Введён единый dual-backend контракт для LLM:
  - `LLM_BACKEND=llm_mcp|ollama` (default `llm_mcp`);
  - `LLM_MCP_BASE_URL`, `LLM_MCP_PROVIDER`, `LLM_BACKEND_FALLBACK_OLLAMA`, `LLM_BACKEND_TIMEOUT_SEC`.
- `worker/embeddings` переведён на backend abstraction:
  - primary `llm-mcp` (`/v1/llm/request` + polling jobs);
  - fallback на Ollama при ошибках (если включён).
- `embedding.search` в MCP server больше не привязан жёстко к Ollama, использует backend strategy.
- `signals.run` получил LLM enrichment:
  - сохраняется heuristic сигнал;
  - дополнительные поля пишутся в `direction.llm` без изменения схемы БД.
- Синхронизированы `.env.example`, `compose.yml`, `README.md`.
- Добавлены governance-файлы публичного репозитория:
  - `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`;
  - `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `.github/CODEOWNERS`.
- Добавлен pragmatic CI: `.github/workflows/ci.yml` (compose config, markdown links, Python compile, TS build).


## [2026.02.3] - 2026-02-07

- `README.md` переведён в единый визуальный стиль экосистемы:
  - badges, кнопки-навигации, emoji-секции.
- Добавлен раздел `Public Git Standards`:
  - версия `YYYY.MM.x`, обязательный changelog, запрет секретов в git.
- Обновлён `VERSION` до `2026.02.3`.

## [2026.02.2] - 2026-02-06

- Нормализована версия модуля к формату `YYYY.MM.x`.
- Обновлён compose-контракт:
  - контейнеры `bcsdb`, `bcsmcp`;
  - labels `ns.module`, `ns.component`, `ns.db_owner`;
  - host ports по политике (`5433`, `3332`).
- Документация и `.env.example` синхронизированы с новыми именами сервисов (`bcsdb`) и портами.
- В Dockerfile добавлены OCI labels + `ns.module/ns.component`.

## [26.02.1]

- Историческая версия до нормализации формата.

# Changelog

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

# PostgreSQL для NIMS v2

## Переменные окружения

| Переменная | Описание | Пример |
|------------|----------|--------|
| `NIMS_STORAGE` | `json` (по умолчанию локально) или `postgres` | `postgres` |
| `DATABASE_URL` | строка подключения | `postgres://nims:nims@postgres:5432/nims` |
| `NIMS_PROJECT_SLUG` | slug проекта после импорта | `main` |
| `POSTGRES_USER` / `PASSWORD` / `DB` | для compose | `nims` |

## Тесты (Docker-only)

Канон запуска из корня репозитория:

```bash
npm run test:docker        # unit + PG integration + Vitest stores + HTTP
npm run test:docker:cov    # то же + c8 HTML/text в ./coverage и --check-coverage
npm run test:docker:down   # down -v
```

Compose: `docker-compose.test.yml` — сервисы `postgres` (БД `nims_test`), `app` (NIMS_STORAGE=postgres), `test` (runner).

Без `DATABASE_URL` PG-тесты падают (не skip).

Пороги c8 (после прогона): `scripts/check-coverage-thresholds.js` — `nims-dbms/pg` ≥70/55, `nims-server/pg` ≥65/50, `permissionProxy` ≥75/60, `requestProcessing`+`auth` ≥60/45. Vitest stores — ≥70/55 (`vitest.config.ts`). Отчёт: `./coverage`.

## Локально / compose

```bash
docker compose -f docker-compose.v2.yml --env-file .env.prod up -d postgres
export DATABASE_URL=postgres://nims:nims@127.0.0.1:5432/nims   # если проброшен порт
cd packages/nims-dbms && npm install && npm run migrate
npm run import-json -- --file /path/to/prod-nims-base1.json --slug main
```

В `docker-compose.v2.yml` сервис `app` зависит от healthy `postgres` и по умолчанию `NIMS_STORAGE=postgres`.

## Runtime

- При старте: миграции → hydrate `project_documents` → `DatabaseEngine` в памяти.
- Mutate-команды (REST/MCP) и autosave: write-through в Postgres (документ + нормализованные таблицы + accounts), debounce ~250ms.
- `NIMS_STORAGE=json` — прежнее поведение с файловым autosave.

## Импорт / экспорт

```bash
node packages/nims-dbms/scripts/import-json-base.js --file data.json --slug main
node packages/nims-dbms/scripts/export-json-base.js --slug main --out backup.json
```

## Cutover 9443

1. Бэкап volume `nims-v2-data` и при необходимости JSON.
2. `docker compose ... up -d postgres`, migrate, import из последнего autosave.
3. Пересобрать/перезапустить app с `NIMS_STORAGE=postgres`.
4. Smoke: логин, CRUD, MCP.
5. Rollback: `NIMS_STORAGE=json` + восстановление volume **или** `export-json` из PG.

См. также [ADR_POSTGRES.md](./ADR_POSTGRES.md).

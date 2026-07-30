# ADR: PostgreSQL как основное хранилище NIMS v2

## Статус

Принято (2026-07-30)

## Контекст

NIMS хранит всю игру в одном JSON-документе в памяти с периодическим autosave на диск. Это мешает понятному бэкапу, транзакциям, нескольким проектам в одном инстансе и аудиту правок.

## Решение

1. **PostgreSQL 16** — source of truth для nims-v2 (порт 9443).
2. **`projects`** — tenant с первого дня; cutover работает с одним проектом (автовыбор).
3. **Нормализованные таблицы** контента + `accounts` / `project_memberships` / `entity_ownership`.
4. **`entity_revisions` / `command_log`** — таблицы создаются сразу; продуктовый UI истории и мультипроект — отдельный план.
5. **Рабочий runtime (переходный):** hydrate — загрузка проекта в существующий `DatabaseEngine` (in-memory API-паритет) + **write-through** в Postgres (полный persist проекта) при autosave и после `setDatabase`. Так сохраняется совместимость со всем REST/MCP без переписывания сотен методов за один релиз. Дальнейший рефакторинг — постепенный перевод методов на SQL.
6. **Флаг** `NIMS_STORAGE=json|postgres` (default `json` для совместимости; prod v2 → `postgres`).
7. **Импорт/экспорт** JSON ↔ Postgres для миграции и аварийного round-trip.

## Последствия

- Нужен сервис Postgres в compose и `DATABASE_URL`.
- JSON autosave на cutover отключается или становится cold standby.
- Переименование сущностей по-прежнему каскадируется в логике движка; в PG — через persist полного снимка проекта после mutate.

## Риски

| Риск | Митигация |
|------|-----------|
| Потеря данных при cutover | `pg_dump` + копия JSON volume до переключения |
| Расхождение hydrate/persist | export-json diff после import; интеграционные прогоны |
| Нагрузка полного rewrite проекта | debounce autosave (как сейчас 60s); mutate-path может вызывать persist сразу для критичных команд |

## Связанные планы

- Cutover: этот ADR + миграции/импортёр
- Follow-up: история UI + мультипроект UI

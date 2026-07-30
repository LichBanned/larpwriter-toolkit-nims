# History & multiproject (NIMS v2)

## История правок

- После mutate (REST/MCP) пишутся `command_log` и `entity_revisions` (snapshot jsonb).
- API: `listEntityRevisions`, `getEntityRevision`, `restoreEntityRevision`, `cleanupEntityRevisions`.
- UI: вкладка **История** на персонаже и истории.
- Retention: `projects.settings.revision_keep_last` (default 50) + CLI:

```bash
DATABASE_URL=... npm run cleanup-revisions --prefix packages/nims-dbms -- --slug main --keep 50
```

Baseline `reason='import'` не удаляется.

## server-admin

- Колонка `accounts.is_server_admin`.
- Bootstrap: `NIMS_SERVER_ADMIN` или `NIMS_ADMIN_LOGIN`.
- Может create/archive/import проектов и открывать любой.
- **Не** заменяет admin проекта внутри игры.

## Мультипроект и роли

- Эффективная `role` в сессии = membership **текущего** проекта (organizer|player).
- Один аккаунт может быть редактором в A и игроком в B.
- После логина — экран выбора проекта; в AppShell — селектор.
- Без `projectSlug` игровой API недоступен (кроме list/set/join/project admin API).

## Заявка игрока

- `requestProjectJoin` → membership `active` + `member_role=player`.
- В админке PlayersInfo видны только active player memberships (после загрузки проекта).

## API проектов

`listProjects`, `setCurrentProject`, `createProject`, `archiveProject`, `requestProjectJoin`, `importProjectFromJson`, `getCurrentProject`.

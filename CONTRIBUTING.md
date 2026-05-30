# Contributing Guide

## Database Migrations

### Naming Convention

Migration directories **must** use ISO timestamp format:

```
YYYYMMDDHHMMSS_descriptive_name
```

Examples:
- `20240325080000_add_database_indexes`
- `20260325164312_add_password_history`

**Do not** use Unix timestamps (e.g. `1711353600_add_database_indexes`).

Prisma sorts migrations alphabetically by directory name. Using ISO timestamps ensures migrations run in chronological order and avoids ambiguity.

To generate a correctly named migration:

```bash
npx prisma migrate dev --name descriptive_name
```

Prisma will automatically prefix the name with the current UTC timestamp in `YYYYMMDDHHMMSS` format.

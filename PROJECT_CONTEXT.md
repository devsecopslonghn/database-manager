# Project Context


## Decisions

2026-08-10:

- Use Next.js App Router
- Use Fastify backend
- MongoDB chosen
- Do not use microservices


## Constraints

- Personal project
- Single deployment
- Kubernetes later


## Important Rules

Never:
- Put business logic in frontend
- Store money as float

## Superseding discovery decisions (2026-08-10)

- The control-plane database is PostgreSQL; target databases supported by the product are PostgreSQL, MySQL, Oracle, and SQL Server.
- A project uses one database engine and maps environments/targets to a Git ref and a concrete database/schema.
- The product blueprint and implementation guidance live under `docs/` and `AGENTS.md`.

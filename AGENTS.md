# SchemaOps Repository Guidance

## Project status

This repository currently contains the product and architecture blueprint for SchemaOps, a multi-tenant database migration control plane. Do not implement application code until the implementation plan and remaining architecture decisions are approved.

## Source of truth

- Product scope: `docs/product.md`
- Functional requirements: `docs/requirements.md`
- UX: `docs/ui-design.md`
- System architecture: `docs/architecture.md`
- Control-plane and target ledger model: `docs/database.md`
- API contract: `docs/api.md`
- Delivery sequencing: `docs/implementation-plan.md`

The latest explicit user decisions take precedence over stale or conflicting notes in `PROJECT_CONTEXT.md`. In particular, the control-plane database is PostgreSQL.

## Architecture constraints

- Use Next.js App Router for the web UI and Fastify for the backend unless an approved ADR changes this decision.
- Keep business logic out of the frontend.
- Use a modular monolith; do not split into microservices without an approved ADR.
- Kubernetes Jobs/workers may isolate migration execution but are execution units, not independently owned microservices.
- Target database adapters must support PostgreSQL, MySQL, Oracle and SQL Server.
- A project uses one database engine. Do not auto-translate SQL between engines.
- Support a first-class `MANUAL_UI` migration source. Store its SQL/checksum/context in the control plane; never silently associate it with a Git commit or sync it back to Git.
- Never store target database passwords or tokens in PostgreSQL or API responses; use secret references.
- Never mutate or delete migration history or audit events to repair state. Use explicit reconcile operations.
- Never execute a stale plan or concurrently execute two operations on the same target.

## Safety requirements

- Treat production target operations, restore, undo and permission changes as high-impact.
- Verify tenant, project, environment, target, Git commit and backup scope before execution.
- Preserve user changes and do not commit, push, deploy, or apply infrastructure without an explicit request.
- Run the narrowest relevant validation after changes and report evidence.

## Documentation requirements

Any implementation must update the relevant blueprint/ADR when it changes migration semantics, permissions, target adapters, persistence, API state transitions, backup/restore behavior or deployment topology.

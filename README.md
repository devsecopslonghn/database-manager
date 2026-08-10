# SchemaOps

SchemaOps is a multi-tenant database migration control plane. The product
blueprint is under `docs/`; implementation is currently a foundation vertical
slice with a Fastify backend and Next.js frontend.

## Local development

Requirements: Node.js 20+, npm 10+, and access to the dedicated SchemaOps
PostgreSQL database `database_manager`. SchemaOps uses the `schemaops` schema
inside that database.

```bash
npm install
npm test
npm run typecheck
npm run build
```

Run the backend with a PostgreSQL connection:

```bash
DATABASE_URL='postgres://schemaops:password@100.117.34.108:5433/database_manager' \
  npm run dev --workspace backend
```

Apply `backend/migrations/001_foundation.sql` with the database migration tool
of the deployment environment.

The current API includes health/readiness, project/target creation and the
`MANUAL_UI` migration metadata path. It deliberately does not execute SQL on a
target database yet.

## CI/CD

`Jenkinsfile` uses the `company-ci` and `company-cd` shared libraries. It
builds frontend/backend images and updates the GitOps values file on the
configured primary branch. Credentials and endpoint/profile configuration
remain Jenkins/global configuration.

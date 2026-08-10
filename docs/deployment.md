# SchemaOps — Deployment Runbook

## Namespace

The development namespace is `database-manager`. It was created on the
verified `k8s-admin-public` context. The declarative source is the
`database-manager` chart under `k8s-namepsace-chart` and its Argo CD Application
under `gitops/workloads.yaml`.

## Required runtime secret

Create `database-manager-runtime` in the `database-manager` namespace through
the approved secret manager. Do not commit it to Git. `DATABASE_URL` must point
to the dedicated `database_manager` database; SchemaOps creates and uses the
`schemaops` schema inside it. The backend requires:

```text
DATABASE_URL
OIDC_JWKS_URL
OIDC_ISSUER
OIDC_AUDIENCE
```

Production OIDC uses the Keycloak deployment in the `database-manager`
namespace, realm `database-manager`, browser client `database-manager-web`,
and API audience `database-manager-api`. The frontend completes Authorization
Code + PKCE at `/auth/callback`; tokens stay in browser session storage and
are sent only to the same-origin API. Realm definition is kept in the GitOps
chart; users, passwords and runtime database secrets remain out of Git.

The current shared PostgreSQL endpoint is `100.117.34.108:5433`, database
`database_manager`, schema `schemaops`. The password must come from the approved
secret manager and must not be placed in Git or shell history.

The namespace also requires the existing `nexus-registry` image pull secret.
The non-secret Jenkins catalog example is `docs/ci-cd-config.example.yaml`.

## Local checks

```bash
npm install
npm test
npm run typecheck
npm run build
helm lint /home/longhn0710/workspace/k8s-namepsace-chart/database-manager
helm template database-manager /home/longhn0710/workspace/k8s-namepsace-chart/database-manager \
  --namespace database-manager --set image.tag=test-001
```

## GitOps sequence

1. Push the application repository and the GitOps repository changes through the normal review process.
2. Jenkins builds and scans the `frontend` and `backend` images.
3. `company-cd` updates `database-manager/values.yaml` with the immutable image tag.
4. Argo CD syncs the `database-manager` Application.
5. The schema migration hook runs before backend rollout.
6. Backend readiness requires PostgreSQL control-plane connectivity.

The first deployment must not be considered healthy until the runtime secret,
PostgreSQL schema migration and OIDC settings are present.

## Current safety boundary

The implemented backend stores manual migration metadata and does not execute
SQL against target databases yet. Do not expose the manual migration endpoint
as a production execution mechanism until RBAC, tenant scope, planner, target
adapter, backup preflight and operation lock are implemented and tested.

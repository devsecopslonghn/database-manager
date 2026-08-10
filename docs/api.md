# SchemaOps — API Blueprint

## 1. API conventions

- REST/JSON dưới `/api/v1`.
- OIDC bearer token; authorization theo tenant/project/target scope.
- Command endpoints nhận `Idempotency-Key`.
- Long-running command trả `202 Accepted` với `operationId`.
- Resource response không chứa secret values.
- Error format có `code`, `message`, `correlationId`, `details` đã redacted.

## 2. Resource endpoints

### Tenants and access

```text
GET    /tenants
POST   /tenants
GET    /tenants/{tenantId}
GET    /tenants/{tenantId}/members
POST   /tenants/{tenantId}/role-bindings
DELETE /tenants/{tenantId}/role-bindings/{bindingId}
```

### Projects, environments and targets

```text
GET    /tenants/{tenantId}/projects
POST   /tenants/{tenantId}/projects
GET    /projects/{projectId}
PATCH  /projects/{projectId}
POST   /projects/{projectId}/environments
GET    /projects/{projectId}/environments
POST   /environments/{environmentId}/targets
GET    /targets/{targetId}
PATCH  /targets/{targetId}
POST   /targets/{targetId}/connection-tests
```

Create target request chỉ nhận `secretRef`, không nhận cơ chế trả credential value trong response.

### Git source

```text
POST /projects/{projectId}/sync
GET  /projects/{projectId}/source-snapshots
GET  /source-snapshots/{snapshotId}
```

Webhook/provider-specific endpoints để phase sau. Core sync endpoint vẫn dùng được bởi UI hoặc CI/CD.

### Migration discovery and plans

```text
POST /targets/{targetId}/validate
POST /targets/{targetId}/plans
GET  /plans/{planId}
GET  /plans/{planId}/items
POST /plans/{planId}/dry-run
```

Plan request có source snapshot/commit, optional `fromVersion`, `toVersion`, selected items, backup profile và execution policy. `dry-run` không mutate target.

### Manual migrations

```text
POST /targets/{targetId}/manual-migrations
GET  /targets/{targetId}/manual-migrations
GET  /manual-migrations/{manualMigrationId}
POST /manual-migrations/{manualMigrationId}/plan
```

Create request gồm SQL payload, optional version context, execution label, `executionSequence`, reason và requested backup profile. API lưu payload trong control plane, tạo source type `MANUAL_UI`, không yêu cầu commit SHA và không tạo Git snapshot.

### Approval and execution

```text
POST /plans/{planId}/approve
POST /plans/{planId}/auto-approve
POST /plans/{planId}/execute
GET  /operations/{operationId}
POST /operations/{operationId}/cancel
GET  /operations/{operationId}/items
GET  /operations/{operationId}/logs
```

Approval request phải ghi actor/policy version. Auto-approve ghi `actorType=SYSTEM` và policy reason.

### Backup and rollback

```text
POST /targets/{targetId}/backup-plans
GET  /targets/{targetId}/backup-plans
POST /operations/{operationId}/rollback/undo
POST /targets/{targetId}/rollback/restore
GET  /targets/{targetId}/backup-artifacts
```

Restore request phải tham chiếu artifact cụ thể và chịu destructive-action policy.

### State and audit

```text
GET /targets/{targetId}/migrations
GET /targets/{targetId}/history
GET /targets/{targetId}/drift
GET /audit-events?tenantId=...&targetId=...&from=...&to=...
```

## 3. Operation state machine

```text
CREATED -> VALIDATING -> PLANNED -> WAITING_APPROVAL
        -> APPROVED -> BACKUP_RUNNING -> EXECUTING
        -> VERIFYING -> SUCCEEDED

Any active state -> FAILED
EXECUTING -> CANCELLING -> CANCELLED
SUCCEEDED/FAILED -> ROLLBACK_REQUESTED -> ROLLING_BACK -> ROLLED_BACK
```

State transition phải được validate ở backend; client không được tự set state tùy ý.

## 4. CI/CD usage

MVP có thể dùng API sequence:

```text
sync -> validate -> plan -> approve/auto-approve -> execute -> poll operation -> fetch logs
```

Webhook callback, signed callbacks và provider-specific status checks là phase 2. API phải tạo correlation ID để pipeline liên kết với commit/build.

## 5. Security and abuse controls

- Rate limit command endpoints.
- Scope token theo tenant/project khi có thể.
- Không cho phép client gửi target connection secret trực tiếp vào execution payload.
- Audit mọi approval, execute, cancel, undo, restore, reconcile và permission change.
- Paginate logs/audit; giới hạn query time range và output size.

## 6. Implemented control-plane slice

The first production slice is available under `/api/v1`: dashboard/projects,
project environments and targets, Git source sync, V/R/U inventory and ledger,
plan creation/approval, manual UI migrations, operation queue/status/logs and
audit events. The queue endpoint returns `202` with an operation ID.

Execution is fail-closed. The worker only opens a target adapter when the
target secret reference resolves to a mounted JSON connection document, the
target lock is acquired and the plan is approved. `SCHEMAOPS_OPERATION_WORKER_ENABLED`
must be explicitly enabled for a deployment; otherwise queueing is audited but
does not touch a target database.

### Target connection management

Admin connection setup is exposed through:

```text
GET  /targets/{targetId}/connection
PUT  /targets/{targetId}/connection
POST /targets/{targetId}/connection/test
POST /targets/{targetId}/connection/rotate
GET  /targets/{targetId}/connection/audit
```

For the Kubernetes backend, the API writes an `Opaque` Secret in the configured
namespace using the supplied `secretRef`. Only non-secret connection metadata,
resource version and test result are stored in `schemaops.targets`. Vault and
External Secrets are metadata-only integrations until their provider resolver
is configured; the API rejects plaintext password writes for those backends.

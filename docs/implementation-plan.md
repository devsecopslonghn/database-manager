# SchemaOps — Implementation Plan

## Phase 0 — Architecture validation

- Chốt product name, OIDC provider, object storage, queue strategy, RPO/RTO.
- Chốt migration filename grammar và supported SQL execution rules cho bốn engines.
- Viết adapter contract và compatibility matrix.
- Tạo threat model/permission matrix trước khi implement execution.

**Exit criteria:** có ADR cho các quyết định còn mở và test fixture cho V/R/U, Flyway import, out-of-order, checksum conflict.

## Phase 1 — Foundation

- Bootstrap Next.js App Router và Fastify modular monolith.
- PostgreSQL control-plane migrations.
- OIDC integration boundary, tenant/project/environment/target RBAC.
- Secret reference abstraction cho Kubernetes Secret/External Secrets.
- Health, metrics, correlation ID và audit event foundation.

**Exit criteria:** user có thể tạo project, environment, target mà không lộ secret.

## Phase 2 — Git and discovery

- Clone/sync repository.
- Source snapshot và commit SHA persistence.
- Parser V/R/U, checksum và validation errors.
- Native history import interface, Flyway reader trước.
- Migration ledger và drift detection.

**Exit criteria:** hiển thị đúng applied/pending/repeatable changed/out-of-order/drift trên fixture databases.

## Phase 3 — Plan and approval

- Deterministic planner.
- From-version/to-version range.
- Dry-run UI/API.
- Manual/automatic approval policy.
- Stale plan rejection và idempotency.
- Manual migration editor/API, SQL payload persistence, source-type separation và risk confirmation.

**Exit criteria:** cùng snapshot + target state tạo cùng plan fingerprint; plan không mutate target.

Manual migration không cần Git snapshot và vẫn tạo fingerprint từ target state, SQL checksum, execution context và policy.

## Phase 4 — Execution engine

- Target adapter contract.
- PostgreSQL, MySQL, Oracle, SQL Server adapters.
- Kubernetes Job execution isolation.
- Lock, timeout, heartbeat, cancellation và recovery.
- Per-script result, log chunking và redaction.

**Exit criteria:** happy path, failed script, transaction limitation, pod restart và concurrent execution được test.

## Phase 5 — Backup and rollback

- Backup plan/range declaration.
- Backup preflight và artifact reference.
- Undo operation theo version.
- Restore operation với explicit confirmation.
- Verification hooks và audit.

**Exit criteria:** không execute khi backup bắt buộc thất bại; undo không mutate original audit/history.

## Phase 6 — CI/CD and operations

- Public API hardening, OpenAPI contract, idempotency.
- Pipeline examples cho sync/plan/approve/execute/status.
- Metrics/dashboard/alerts.
- Retention, PITR restore drill và Kubernetes rollout/rollback runbook.

**Exit criteria:** một pipeline test hoàn chỉnh chạy qua môi trường non-production.

## Phase 7 — Hardening and release

- Security review, authorization tests, tenant isolation tests.
- Load test planner/API và execution queue.
- Failure injection cho worker/target connection.
- Documentation, migration guide và operator runbook.

## 3. Verification matrix

| Area | Verification |
|---|---|
| Parser | Unit/property tests với V/R/U và filename lỗi |
| Planner | Golden plans, deterministic fingerprint, out-of-order |
| Adapter | Integration tests trên bốn database engines |
| Security | RBAC matrix, tenant isolation, secret redaction |
| Reliability | Restart/retry/lock expiry/partial failure |
| API | Contract tests, idempotency, pagination |
| UI | Permission states, destructive confirmation, log rendering |
| Kubernetes | Helm lint/template, rollout, NetworkPolicy, resource limits |

## 4. Risks and mitigations

- **SQL dialect khác nhau:** không auto-translate; mỗi project chọn một engine và test adapter riêng.
- **DDL transaction behavior khác nhau:** adapter khai báo capability, transaction boundary và recovery semantics.
- **Rollback không luôn an toàn:** tách undo với restore, yêu cầu backup policy và explicit operation.
- **Database rất lớn:** backup theo scope/range, artifact reference và provider-native mechanism.
- **Execution worker bị mất:** persisted state, heartbeat và lease recovery.
- **Flyway/native drift:** import bất biến, reconcile explicit, block execution khi drift chưa xử lý.
- **Manual SQL bypasses Git review:** tách source type, giới hạn quyền, bắt buộc audit/backup policy và hiển thị cảnh báo rõ ràng.

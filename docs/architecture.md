# SchemaOps — System Architecture

## 1. Architectural stance

SchemaOps là modular monolith ở control plane, triển khai trên Kubernetes. API/UI và execution engine dùng chung codebase/domain modules; execution được chạy trong Kubernetes Job hoặc worker pod riêng để cách ly network access và resource usage. Đây không phải microservices architecture.

```text
User / CI/CD
    |
    v
Next.js Web ----> Fastify API (N replicas)
                         |
             +-----------+-----------+
             |                       |
       PostgreSQL              Object Storage
       control plane            source/log/artifact refs
             |
       Operation queue/state
             |
       Kubernetes Job / Worker
             |
       Target DB Adapter
       PG / MySQL / Oracle / SQL Server
```

## 2. Components

### Web application

Next.js App Router + TypeScript. Chỉ xử lý presentation, form validation và query/mutation qua API. Không chứa business logic migration hoặc quyền quyết định execute.

### Fastify API

Modules:

- Identity and RBAC
- Tenant/project/target management
- Git source and sync
- Migration parser/planner
- Approval policy
- Operation orchestration
- Audit and log query
- Health, metrics and administration

Business rules ở backend; mọi command có actor, scope và idempotency key.

### Git source manager

MVP clone/sync repository theo configured ref, lưu snapshot metadata và commit SHA. Source files có thể lưu trong workspace volume hoặc object storage; control plane chỉ lưu metadata/hash. Webhook/provider-specific API chưa bắt buộc.

### Migration parser/planner

Engine-independent domain model nhận input từ một project engine cụ thể. Parser không tự dịch SQL dialect. Adapter chịu trách nhiệm validation/connection/execute theo target engine.

Planner nhận hai source type:

- `GIT`: file từ source snapshot/commit.
- `MANUAL_UI`: SQL payload đã persist trong PostgreSQL control plane.

Manual SQL đi qua cùng policy/plan/lock/execution pipeline nhưng không tham chiếu Git snapshot. Payload chỉ được worker đọc qua operation ID được authorize.

### Operation orchestrator

Persist state machine trong PostgreSQL, tạo execution job, cập nhật heartbeat và nhận kết quả. Có lock theo target, timeout, cancellation state và recovery sau API restart.

### Database adapters

Mỗi adapter cung cấp:

- connect/test connection;
- inspect native history (Flyway nếu được cấu hình);
- inspect SchemaOps ledger;
- transaction capability;
- execute script;
- collect status/error;
- backup/restore integration contract.

Adapter không được tự ý ghi vào Flyway history. SchemaOps ledger là nguồn trạng thái chính sau khi project bắt đầu quản lý bằng SchemaOps.

## 3. Migration lifecycle

```text
SOURCE SYNC
    -> PARSE & VALIDATE
    -> PLAN / DRY-RUN
    -> BACKUP PREFLIGHT
    -> APPROVE or AUTO-APPROVE
    -> LOCK TARGET
    -> EXECUTE SCRIPT UNITS
    -> VERIFY & RELEASE LOCK
    -> AUDIT / NOTIFY
```

Plan fingerprint bao gồm project, target, source commit, parser policy, current ledger fingerprint và selected range. Execute từ chối plan stale.

## 4. Target mapping

Target có các thuộc tính:

- project và environment;
- Git branch/ref hoặc immutable commit selection;
- database engine;
- database/schema identifier;
- secret reference;
- migration path;
- approval, backup, timeout và concurrency policies.

MVP dùng một repository/project cho một engine. Nếu một ứng dụng có nhiều engine, tạo project riêng cho từng engine hoặc repository migration riêng.

## 5. Security model

- OIDC/SSO là authentication baseline; local development auth không được dùng cho production.
- Authorization kiểm tra tenant scope trước project/target scope.
- Secret value chỉ được resolve trong worker lúc cần; API/UI chỉ thấy reference và masked metadata.
- Worker network policy chỉ cho phép tới target databases được cấp.
- SQL/log redaction phải loại bỏ credential, connection string và giá trị nhạy cảm theo policy.
- Audit event append-only; deletion chỉ qua retention job có elevated platform policy và phải tạo administrative audit event.

## 6. Reliability

- API chạy nhiều replicas.
- PostgreSQL control plane cần HA deployment/managed service, PITR backup và replica strategy theo môi trường.
- Operation state và logs persist trước khi trả success.
- Worker heartbeat và lease expiry cho phép recovery operation bị orphan.
- Target lock có TTL/renewal và cleanup an toàn.
- Không retry mù các lỗi SQL không xác định transaction state.

## 7. Kubernetes deployment

Các workload chính:

- `web`: Next.js;
- `api`: Fastify modular monolith;
- `worker-job`: ephemeral migration execution;
- `sync-job`: clone/sync source khi cần;
- `postgres`: ưu tiên managed/external PostgreSQL cho production;
- object storage/external log destination.

Helm/Kustomize phải tách config theo environment. Credentials dùng Secret/External Secrets. Production migration job phải có resource limit, timeout và NetworkPolicy.

## 8. Observability

- Structured JSON logs với correlation ID, tenant/project/target/operation ID đã redacted.
- Metrics cho sync, planning, execution, lock, queue, adapter errors.
- Tracing API → operation → worker → adapter nếu tracing stack được cung cấp.
- Dashboard tách system health khỏi migration outcome.

## 9. Quyết định còn mở

- Storage cụ thể cho source snapshot và execution logs.
- OIDC provider.
- Queue implementation: PostgreSQL-backed queue trước, hay external queue.
- RPO/RTO và retention theo tenant.
- Cơ chế backup/restore cụ thể cho từng database engine.

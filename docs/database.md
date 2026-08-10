# SchemaOps — Database Design

## 1. Database của SchemaOps

Control-plane database dùng PostgreSQL. Đây là database của sản phẩm, không phải database mà sản phẩm migration target. Nó lưu metadata, state machine, policy, audit và log index; không lưu plaintext target credentials.

## 2. Core entities

| Entity | Mục đích |
|---|---|
| `tenants` | Phân vùng khách hàng/tổ chức |
| `users`, `groups`, `memberships` | Identity và tenant membership |
| `roles`, `role_bindings` | RBAC theo scope |
| `projects` | Repository + một database engine |
| `environments` | dev, uat, production hoặc custom |
| `targets` | Một Git ref và một database/schema cụ thể |
| `secret_refs` | Reference tới Kubernetes Secret/Vault |
| `repositories` | Git URL, path, branch/ref metadata |
| `source_snapshots` | Commit SHA, sync result và source fingerprint |
| `migration_files` | Parsed V/R/U metadata của snapshot |
| `manual_migrations` | SQL nhập từ UI, checksum và execution context; không có Git source |
| `migration_plans` | Deterministic plan và selected range |
| `migration_plan_items` | Các script units trong plan |
| `approvals` | Manual/automatic approval records |
| `operations` | Execute, sync, backup, undo, restore operations |
| `operation_items` | Trạng thái từng script/step |
| `migration_ledger` | Lịch sử SchemaOps trên từng target |
| `native_history_imports` | Flyway/other native history imported evidence |
| `backup_plans` | Rule/script cho backup theo target/engine/range |
| `backup_artifacts` | Reference, checksum, scope và result backup |
| `audit_events` | Immutable business/security audit |
| `execution_logs` | Chunked execution output, metadata và retention |
| `idempotency_keys` | Chống lặp command qua API |
| `target_locks` | Lease/heartbeat tránh concurrent execution |

## 3. Important relationships

```text
tenant 1--N projects
project 1--N environments
environment 1--N targets
project 1--N source_snapshots
target 1--N migration_plans
plan 1--N plan_items
target 1--N migration_ledger
operation 1--N operation_items
operation 1--N audit_events
operation 1--N execution_logs
```

Mọi bảng tenant-scoped phải có `tenant_id`. Query layer không được cho phép lấy record chỉ bằng resource ID mà bỏ qua tenant scope.

## 4. Migration ledger semantics

Ledger không chỉ có một cột version. Tối thiểu cần:

- target ID;
- script identity và normalized path;
- migration kind: `VERSIONED`, `REPEATABLE`, `UNDO`;
- version/description;
- checksum và source commit;
- applied/rolled-back state;
- applied at, actor và operation ID;
- `out_of_order` flag và execution sequence;
- duration, result và error reference.

Out-of-order không cần một bảng riêng chỉ vì thứ tự khác biệt. Nó được ghi bằng `out_of_order` và `execution_sequence` trong ledger/operation item; audit event vẫn là record riêng cho hành vi. Không thay đổi numeric version để “làm cho đúng thứ tự”; execution sequence thực tế là một thuộc tính riêng.

Repeatable migration được nhận diện theo path/description identity và checksum. Khi checksum đổi, planner tạo một new execution item; lịch sử các checksum cũ được giữ lại.

Undo là operation liên kết với versioned ledger item. Không dùng undo để mutate/delete history cũ.

Manual migration là một source type riêng. `manual_migrations` nên lưu target, engine, schema context, SQL payload (mã hóa at rest nếu khả thi), checksum, optional version context, execution label, sequence, reason, actor và operation reference. Payload không có `source_snapshot_id`, không được sync ngược lên Git và không được hiển thị trong danh sách Git migration.

## 5. Native history compatibility

Khi target có Flyway history:

1. Adapter đọc bảng native history.
2. SchemaOps lưu bản import bất biến vào `native_history_imports`.
3. User chọn baseline/import mapping.
4. Planner đối chiếu native evidence với SchemaOps ledger.
5. Sau khi adopt, SchemaOps ledger là nguồn quản lý chính.

Nếu native history khác ledger, target chuyển sang trạng thái `DRIFT` và không execute cho tới khi có explicit reconcile operation.

## 6. Target connection and secrets

`targets` chỉ lưu non-secret connection metadata và `secret_ref_id`. Secret reference chứa provider, namespace/path, key mapping và version metadata; password/token không được lưu trong PostgreSQL.

## 7. Audit and logs

`audit_events` append-only với event type, actor type/id, scope, operation, request correlation ID, before/after metadata đã redacted, timestamp và result.

`execution_logs` nên chunk theo operation item, có sequence number, stream (`stdout`, `stderr`, `system`), redaction status và object storage pointer khi payload lớn. Không lưu raw secrets hoặc full result set mặc định.

## 8. Retention and backup

- Control-plane PostgreSQL: PITR + periodic full backup.
- Audit retention phải dài hơn execution log retention.
- Source snapshot metadata giữ lâu hơn source workspace.
- Backup artifact chỉ lưu reference, checksum, scope, created time và expiry; artifact lifecycle do backup system quản lý.

## 9. Consistency rules

- Unique target identity theo project/environment/database/schema/ref policy.
- Manual migration phải có source type `MANUAL_UI` và không được tham chiếu Git snapshot.
- Unique active lock theo target.
- Một operation chỉ có một idempotency key trong scope actor/client.
- Ledger write và operation state transition phải atomic trong control plane.
- Không đánh dấu `SUCCESS` nếu chưa persist script result và audit event.

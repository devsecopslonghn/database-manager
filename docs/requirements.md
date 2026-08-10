# SchemaOps — Requirements

## 1. Quy ước migration

MVP hỗ trợ một engine cho mỗi project. Repository không chứa nhiều dialect trong cùng project; target của project phải dùng đúng engine đã khai báo.

- `V<version>__<description>.sql`: versioned migration, mặc định chạy một lần.
- `R__<description>.sql`: repeatable migration, chạy lại khi checksum thay đổi.
- `U<version>__<description>.sql`: undo migration gắn với versioned migration tương ứng.
- Version phải có thể sort ổn định; format version cụ thể được cấu hình theo project.
- Out-of-order migration được cho phép nhưng phải đánh dấu rõ trong ledger và UI.
- Checksum thay đổi sau khi migration đã chạy là policy violation mặc định; không tự động repair.
- Baseline cho phép import trạng thái có sẵn từ Flyway hoặc hệ thống khác.

Undo không xóa lịch sử migration gốc. SchemaOps tạo một rollback operation riêng, giữ liên kết tới version/run ban đầu và ghi kết quả độc lập. Sau rollback, version có trạng thái `ROLLED_BACK`; re-apply phải là một operation mới.

## 2. Functional requirements

### FR-01 — Tenant và RBAC

- Platform Admin tạo tenant và quản lý platform roles.
- Tenant Admin chỉ thấy dữ liệu tenant của mình.
- Quyền được tính theo tenant/project/target/environment.
- Viewer không được tạo plan, approve, execute hoặc rollback.
- Mọi authorization decision quan trọng phải được audit.

### FR-02 — Project

Project có tên, owner, database engine, repository URL, default branch/ref, migration path và policy. Database engine sau khi có migration history không được đổi trực tiếp.

### FR-03 — Environment và target

Tenant/Project Admin tạo environment và target. Target gồm branch/ref, commit policy, host/port/database/schema reference, secret reference, connection test policy và execution policy.

Một target map tới một database/schema cụ thể. Không expose password trong API response hoặc UI sau khi submit.

### FR-04 — Git source và sync

- Clone repository theo cấu hình project.
- Sync thủ công theo branch/ref trong MVP.
- Lưu commit SHA, sync time, result và error.
- Chỉ lập plan từ source snapshot đã sync thành công.
- Webhook và provider-specific API là phase sau; core API vẫn có thể expose `sync` cho CI/CD.

### FR-05 — Discovery và plan

Plan phải:

- đọc source snapshot;
- parse V/R/U scripts;
- đọc target ledger và Flyway history nếu được cấu hình;
- tính pending, repeatable changed, out-of-order và conflicting scripts;
- xác định source version và target version/range;
- xác định backup plan cần chạy;
- không thay đổi target database.

Plan có trạng thái, expiry, source commit và fingerprint. Execute chỉ được dùng plan còn hợp lệ.

### FR-06 — Dry-run

Dry-run là plan/validation không mở transaction ghi thay đổi vào target database. Có thể kiểm tra syntax hoặc khả năng kết nối ở mức adapter nếu policy cho phép, nhưng không được coi là bằng chứng migration sẽ thành công hoàn toàn.

### FR-06A — Manual migration từ giao diện

- User có quyền tạo manual migration bằng một SQL editor/textarea trên UI.
- Manual migration luôn gắn với một target cụ thể và database engine của project.
- User có thể nhập version context hoặc execution label; hệ thống không tự coi manual SQL là một Git `V` script.
- User có thể đánh dấu operation là out-of-order và cung cấp execution sequence/reason.
- Nội dung SQL, checksum, actor, target, thời gian, approval, kết quả và error được lưu trong control-plane database.
- Manual migration không ghi ngược vào Git, không tạo source snapshot và không sửa repository.
- UI phải hiển thị rõ nguồn `MANUAL_UI` để tránh nhầm với Git-managed migration.
- SQL editor phải giới hạn kích thước, hỗ trợ redaction/secret warning và không render raw secret trong log.
- Manual migration vẫn phải qua validate/plan, backup preflight nếu policy yêu cầu, target lock và audit.
- Không cho phép sửa nội dung sau khi operation bắt đầu; nếu cần chạy lại phải tạo operation mới.

Manual migration là execution path độc lập, không phải một bảng “out-of-order” riêng. `out_of_order`, `execution_sequence` và `reason` là metadata của manual operation/ledger entry.

### FR-07 — Approval

Mỗi target có approval policy: manual hoặc automatic. Auto-approve vẫn tạo approval record với actor là system và policy version. Có thể cấu hình approval bắt buộc theo environment, risk level hoặc migration range.

MVP không bắt buộc four-eyes approval; policy có thể bổ sung sau.

### FR-08 — Execution

- Execute theo thứ tự plan, hoặc theo range đã khai báo.
- Mặc định mỗi script là một execution unit và transaction boundary riêng; adapter phải thể hiện rõ engine không hỗ trợ transaction DDL đầy đủ.
- Có lock theo target để ngăn concurrent execution.
- Ghi start/end time, duration, actor, commit SHA, script, checksum, statement/result summary và error.
- Hỗ trợ cancel trước khi script bắt đầu; không kill cưỡng bức transaction đang chạy nếu chưa có policy.
- Retry chỉ áp dụng cho lỗi transient và phải bảo đảm idempotency.

### FR-09 — Backup preflight

Mỗi target có backup plan theo engine và execution range. Khi chạy từ version X tới Y, plan phải khai báo backup scope tương ứng, script/command, artifact reference strategy và success criteria.

Backup có thể là logical/object-level/incremental hoặc provider snapshot; không mặc định backup toàn bộ database. Migration chỉ bắt đầu khi backup preflight đạt policy.

### FR-10 — Rollback

Hỗ trợ hai flow riêng:

1. Undo rollback: chạy `U<version>__...sql` theo từng version được chọn.
2. Backup/restore rollback: tạo restore operation dựa trên backup artifact đã ghi nhận.

Backup/restore không tự động thực hiện trong MVP nếu chưa có explicit approval/policy vì blast radius cao.

### FR-11 — Logs và audit

Phân biệt:

- application log: log vận hành hệ thống;
- execution log: output theo từng script/statement chunk;
- audit event: ai làm gì, với target nào, lúc nào, từ commit nào và kết quả gì.

Audit event immutable. Log phải có retention policy, redaction cho credentials/secrets và giới hạn kích thước output.

### FR-12 — CI/CD API

Core API hỗ trợ sync, validate, plan, approve/auto-approve, execute, status, logs và rollback. API dùng idempotency key cho command tạo operation và trả operation ID để polling/webhook callback ở phase sau.

API cũng hỗ trợ tạo manual migration từ payload SQL, nhưng endpoint này phải chịu RBAC, size limit, idempotency và policy giống UI.

## 3. Quality requirements

- Multi-tenant isolation ở application authorization và database row scope; target credentials cách ly bằng secret reference.
- PostgreSQL control plane có backup, migration và HA strategy riêng.
- Kubernetes deployment phải hỗ trợ rolling update và nhiều replica cho API.
- Execution phải recover được sau API pod restart bằng persisted operation state.
- RPO/RTO cụ thể cần chốt trong deployment phase; MVP không tự suy ra SLA.
- Mọi secret phải đi qua Kubernetes Secret/External Secrets/Vault integration, không lưu plaintext.
- Metrics tối thiểu: sync count, plan duration, execution success/failure, queue depth, lock wait, target latency.

## 4. Acceptance criteria chính

1. Viewer không thể execute dù biết operation ID.
2. Hai execute request đồng thời trên cùng target chỉ một request được cấp lock.
3. Cùng commit và target state sinh cùng plan fingerprint.
4. Out-of-order run hiển thị rõ và có record riêng trong ledger.
5. Undo rollback tạo operation/audit riêng, không sửa lịch sử gốc.
6. Không thể execute nếu backup policy bắt buộc nhưng backup preflight thất bại.
7. Pod restart không làm mất trạng thái operation hoặc execution log đã persist.
8. Manual SQL được lưu cùng checksum và audit, đi qua plan/preflight/approval/execution như Git migration, nhưng không xuất hiện trong Git snapshot hoặc Git sync result.

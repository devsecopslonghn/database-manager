# SchemaOps — Product Blueprint

> Tên sản phẩm tạm thời: **SchemaOps**. Tên chính thức sẽ được quyết định sau.

## 1. Tầm nhìn

SchemaOps là control plane cho database migration trong môi trường enterprise. Sản phẩm kết nối một project với Git repository chứa migration scripts, đọc trạng thái đã áp dụng trên target database, lập kế hoạch thay đổi, thực thi có kiểm soát và cung cấp audit/log đầy đủ.

Sản phẩm không phụ thuộc vào Flyway. Flyway history được hỗ trợ như một nguồn lịch sử cần import/đối chiếu; SchemaOps có migration ledger và execution model riêng để có thể thay thế Flyway trong tương lai.

## 2. Vấn đề

- Trạng thái migration bị phân tán giữa Git, database và pipeline.
- Operator, DBA và DevOps khó biết chính xác script nào đã chạy, chạy trên môi trường nào và bởi ai.
- Việc chạy migration production thường thiếu approval, backup preflight, locking và audit thống nhất.
- Rollback thường bị nhầm giữa undo script và restore backup, đặc biệt với database lớn.

## 3. Người dùng

| Persona | Nhu cầu chính |
|---|---|
| Platform Admin | Quản lý toàn hệ thống, tenant, policy và quyền nền tảng |
| Tenant Admin | Quản lý project và target trong tenant được cấp |
| Project Admin | Khai báo repository, target database, migration policy và backup plan |
| Operator | Tạo plan, approve/execute theo quyền và theo dõi logs |
| Approver | Phê duyệt migration theo policy |
| Viewer | Chỉ xem trạng thái, lịch sử và audit |
| DBA/DevOps | Giám sát execution, xử lý failure, kiểm tra backup/rollback |

## 4. Mô hình sản phẩm

```text
Tenant
  └── Project (một Git repository, một database engine)
        └── Environment (dev / uat / production / custom)
              └── Target (branch/ref + database + schema)
```

Một target đại diện cho một database/schema cụ thể và một Git ref. Một project có thể có nhiều environment và nhiều target.

## 5. Giá trị kinh doanh

- Giảm rủi ro migration production nhờ plan, approval, backup preflight và locking.
- Rút ngắn thời gian điều tra sự cố nhờ audit và execution log tập trung.
- Chuẩn hóa quy trình database change giữa DevOps, DBA và team phát triển.
- Tạo nền tảng để tích hợp CI/CD và thay thế dần tool migration hiện tại.

## 6. Phạm vi MVP

- Multi-tenant, project, environment và target database.
- Hỗ trợ target PostgreSQL, MySQL, Oracle và SQL Server.
- Mỗi project dùng một database engine; không dịch SQL tự động giữa các engine.
- Clone và sync một Git repository theo branch/ref.
- Nhận diện versioned (`V`), repeatable (`R`) và undo (`U`) scripts.
- Hỗ trợ manual migration: nhập SQL trực tiếp trên UI, không phụ thuộc Git.
- Đọc/import Flyway history nếu có.
- Migration ledger riêng của SchemaOps.
- Plan/dry-run, approval hoặc auto-approval theo policy.
- Execute tuần tự với lock, timeout, checksum và retry policy.
- Backup script theo execution range trước khi migration.
- Rollback bằng undo script hoặc backup/restore operation.
- Immutable audit log, execution log và status dashboard.
- REST API cho các thao tác cốt lõi và CI/CD.
- Triển khai Kubernetes.

## 7. Ngoài phạm vi MVP

- Git provider-specific webhook và native app integration.
- Tự động dịch một script SQL sang dialect khác.
- Tự động sửa migration đã chạy.
- Tự động restore production khi chưa có policy rõ ràng.
- Full database replication hoặc backup engine riêng.
- Thay thế hoàn toàn mọi capability của Flyway ngay phiên bản đầu.

## 8. Nguyên tắc sản phẩm

1. Không sửa hoặc xóa lịch sử đã ghi.
2. Mọi execution phải gắn với commit SHA, target, actor và policy.
3. Plan phải deterministic: cùng source commit và cùng target state phải cho cùng danh sách thay đổi.
4. Undo và restore là hai loại operation khác nhau.
5. Không lưu plaintext database credentials trong control-plane database.
6. Không chạy đồng thời hai migration trên cùng target.

## 9. Manual migration

Manual migration là execution path dành cho SQL nhập trực tiếp trên giao diện. Script được lưu trong control-plane database cùng với actor, target, version context, checksum, approval, kết quả và audit. Manual migration không làm thay đổi Git repository hoặc source snapshot.

Manual migration phải hiển thị rõ là `MANUAL`, không trộn lẫn với migration được discover từ Git. Đây là capability có rủi ro cao và phải chịu permission, approval/auto-approval policy, backup preflight, lock và audit giống các execution khác.

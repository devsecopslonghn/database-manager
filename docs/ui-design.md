# SchemaOps — UI Design

## 1. UX direction

Giao diện ưu tiên operator: trạng thái rõ ràng, phân biệt `planned`, `approved`, `running`, `success`, `failed`, `rolled back`; không dùng màu sắc làm tín hiệu duy nhất. Production action phải hiển thị target, commit, range, backup status và impact trước khi xác nhận.

## 2. Màn hình chính

1. **Tenant switcher / Dashboard**
   - Chọn tenant được cấp quyền.
   - Tổng quan project, target health, pending migrations, failed runs và approval queue.

2. **Projects**
   - Danh sách project, engine, repository, last sync và trạng thái.
   - Tạo/sửa project theo permission.

3. **Project setup**
   - Repository URL, branch/ref, migration path, engine, naming policy.
   - Sync source và xem commit snapshot.

4. **Environments & Targets**
   - Dev/UAT/Production/custom environment.
   - Target database/schema, secret reference, connection test, execution/approval policy, backup plan.

5. **Migration overview**
   - Applied, pending, repeatable changed, out-of-order, checksum conflict, missing/unknown.
   - So sánh source commit với target ledger/Flyway history.

6. **Plan detail**
   - Range X→Y, scripts theo thứ tự, risk flags, backup preflight, approval status và diff metadata.
   - Nút dry-run, request approval, auto-approve nếu policy cho phép.

7. **Execution detail**
   - Timeline từng script, live/polling log, duration, result, error, retry/cancel status.

8. **Rollback center**
   - Chọn undo rollback hoặc backup/restore rollback.
   - Hiển thị version range, backup artifact, ảnh hưởng dự kiến và quyền cần thiết.

9. **Audit explorer**
   - Filter theo tenant, project, target, actor, operation, version, status, time range, commit SHA.
   - Không có thao tác sửa/xóa.

10. **Access & Policies**
    - User/group assignment, role scope, approval mode, backup requirement, retention và execution limits.

11. **Manual Migration editor**
    - Chọn project/environment/target.
    - Nhập SQL trong editor; hiển thị database engine và schema context.
    - Nhập optional version context, execution label, execution sequence và reason.
    - Hiển thị rõ badge `MANUAL_UI` và cảnh báo “không liên quan Git”.
    - Xem validation/plan, backup preflight, approval và impact trước khi execute.
    - Nội dung đã submit trở thành immutable; không có nút sửa operation cũ.

## 3. Primary flows

### Setup flow

`Create project → chọn engine → khai báo Git → tạo environment → tạo target → chọn secret reference → connection test → sync repository`

### Migration flow

`Sync → Validate → Generate plan/dry-run → Backup preflight → Approve hoặc auto-approve → Execute → Verify → Audit`

### Undo flow

`Chọn applied version → xem U script → tạo rollback plan → approve → execute từng version → verify → ghi rollback event`

### Restore flow

`Chọn failed run/target → chọn backup artifact → tạo restore operation → explicit confirmation → execute qua worker → verify → audit`

### Manual migration flow

`Chọn target → nhập SQL → nhập version context/sequence/reason → validate/dry-run → backup preflight → approve hoặc auto-approve → execute → lưu vào app database → audit`

## 4. Design system baseline

- Layout dashboard responsive, desktop-first.
- Components: DataTable, StatusBadge, Timeline, CodeViewer, DiffPanel, ConfirmationDrawer, LogViewer, Stepper, SecretReferenceField.
- Tokens: neutral background, blue primary, amber warning, red destructive, green success; luôn kèm icon/text.
- Destructive actions cần confirmation có target name và commit SHA; production cần nhập lại target identifier.
- Manual SQL phải có confirmation riêng, hiển thị target, engine, schema, SQL size, checksum và tác động dự kiến. Với manual migration không có commit SHA, UI hiển thị operation ID thay thế.
- Không hiển thị credential value sau khi lưu.

## 5. Accessibility và states

- Keyboard navigation và visible focus.
- Loading, empty, stale, permission denied, sync failure và partial execution phải có UI riêng.
- Log viewer hỗ trợ search, copy có redaction và giới hạn output.

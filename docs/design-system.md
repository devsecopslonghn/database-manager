# SchemaOps design system

This document is the implementation handoff derived from the Stitch screens in
`stitch_schemaops_control_plane.zip`. The HTML in the ZIP is a visual
reference, not production code.

## Product posture

SchemaOps is an operator control plane for database changes. The interface must
make target, environment, migration state, approval state and audit evidence
visible before an operator can execute anything. It is intentionally dense,
quiet and operational: no decorative illustrations, no hidden state and no
consumer-style pill-heavy UI.

## Tokens

```css
--surface: #f8f9fa;
--surface-container-lowest: #ffffff;
--surface-container: #edeeef;
--ink: #191c1d;
--muted: #444653;
--outline: #757684;
--outline-variant: #c4c5d5;
--primary: #00288e;
--primary-container: #1e40af;
--success: #166534;
--success-container: #dcfce7;
--warning: #92400e;
--warning-container: #fef3c7;
--danger: #93000a;
--danger-container: #ffdad6;
--drift: #3730a3;
--drift-container: #e0e7ff;
```

Use Inter for UI and JetBrains Mono for SQL, checksums, operation IDs and audit
timestamps. Use a 4px spacing grid, 24px page padding, 16px gutters, 32px
dense table rows, a 260px navigation rail and 8px cards. Buttons and inputs
use 4px corners; cards use 8px; status badges use 2–4px and always include a
status dot.

## Screen contracts

| Screen | Required operator decision |
| --- | --- |
| Dashboard | Which projects, targets, drift items and failed operations need attention? |
| Project | Which repository/ref and environments are connected? |
| Target | Is the connection healthy, locked, drifted or production-protected? |
| Migration inventory | Which V/R/U files are applied, pending, repeatable or changed? |
| Plan & approval | What exact range will run, what preflight checks passed, and who approved it? |
| Execution | Which operation/item is running, what SQL output was emitted, and can it be stopped safely? |
| Audit | Who did what, to which resource, when, and with what result? |
| RBAC | Which user has which role at which tenant/project/environment/target scope? |

All screens use the breadcrumb `Tenant > Project > Environment > Database` when
the scope is known. Production surfaces show a persistent warning and require
the API state machine to enforce the same policy; the warning is not a client
side security control.

## State language

Use `APPLIED`, `PENDING`, `REPEATABLE`, `FAILED`, `DRIFTED`, `APPROVAL_REQUIRED`,
`RUNNING`, `SUCCEEDED` and `BLOCKED` consistently between API and UI. A manual
SQL item is labelled `MANUAL_UI` and is never presented as a Git migration.

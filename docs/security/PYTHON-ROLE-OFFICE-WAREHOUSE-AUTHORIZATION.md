# Python authorization model: role and location scopes

Status: design baseline only. This document does not change the database schema, existing users, permissions, or application behaviour.

## Why this work is required

The Python desktop edition currently has two account roles (`admin` and `it_manager`). The current data model has an `Office` and assets reference an office, but it has no warehouse entity or persisted user-to-office / user-to-warehouse assignments. Several service operations accept an actor display name for audit purposes rather than an authenticated principal with authorization context.

Consequently, a role label or a filtered UI is not sufficient to enforce office and warehouse boundaries. Do not claim that Python edition has fine-grained office/warehouse authorization until the server-side service boundary enforces it.

## Security invariants

1. **Default deny:** missing principal, missing permission, unresolved resource scope, or empty scope grants access to nothing.
2. **Service-layer enforcement:** every read and write checks authorization inside the service transaction. UI visibility is convenience, not a security boundary.
3. **No caller-supplied identity:** actor identity comes from the authenticated session and is revalidated against the database; callers cannot pass an arbitrary actor name as proof of authority.
4. **Scope intersection:** a user must satisfy both the role permission and the resource scope. Having a permission does not grant access to every office or warehouse.
5. **Destination validation:** transfers validate source access and destination access independently. A user cannot move an asset into a location outside their assignments.
6. **Linked-record validation:** custody, maintenance, parts usage, purchases, documents, exports, reports, and movement history must resolve to the linked asset/location and apply the same scope rules.
7. **Administrative separation:** only an active administrator can manage users, assign roles, or grant/revoke location scopes. An administrator must not be able to remove the final active administrator.
8. **Auditability:** denied privileged operations and changes to roles/scopes should be auditable without logging passwords, tokens, or other secrets.
9. **No implicit migration:** adding scope storage or a warehouse entity requires a reviewed schema proposal, explicit approval, backup, and separately tested migration. Application startup must not silently alter an existing database.

## Proposed role/permission baseline

This is a proposed starting point for review, not a statement about current implementation.

| Role | Asset register | Custody | Maintenance | Purchases / parts | Office & warehouse setup | Users & scope grants | Reports |
|---|---|---|---|---|---|---|---|
| System administrator | Full, within explicit administrative policy | Full | Full | Full | Manage | Manage | All |
| IT manager | Read/write within assigned locations | Process within assigned locations | Process within assigned locations | Process within assigned locations | Read only | None | Scoped |
| Storekeeper (future role) | Read assigned warehouse stock; register/issue/receive as permitted | Issue/return within assigned warehouse | Read only unless separately granted | Receive/record stock within assigned warehouse | None | None | Scoped |
| Office manager (future role) | Read assets assigned to own office | Confirm custody for own office | Submit/track requests for own office | Read only | None | None | Own office |
| Auditor (future role) | Read only within assigned locations | Read only | Read only | Read only | Read only | None | Scoped read-only |

Every row must be split into explicit actions (list, view, create, update, transfer, retire, approve, export) before implementation. The final matrix must be approved by the application owner.

## Scope model required

- Office grants: user ID + office ID + active state + grantor + timestamps.
- Warehouse grants: user ID + warehouse ID + active state + grantor + timestamps.
- Warehouse entity: stable ID, unique code, name, office/parent relationship where applicable, active state, timestamps.
- Asset location: an explicit, validated location type and identifier. Avoid relying on a free-text office name as an authorization key.
- Optional action-specific grants only if the approved matrix requires them; never use a wildcard as the default.

## Required enforcement points

- Asset list/search/count/dashboard and individual asset retrieval.
- Create/update/transfer/retire and bulk import/export.
- Custody create, approve, reject, issue, return, and linked-item reads.
- Maintenance create/update/close and spare-part consumption.
- Purchase and receiving workflows.
- Attachments: upload, download, delete, and metadata listing.
- Movement/audit history, reports, backup/export surfaces.
- User administration and scope assignment.

## Acceptance tests (must be service-level tests)

- A user assigned to Office A cannot list, retrieve, update, retire, or export an asset in Office B.
- A user assigned to Warehouse A cannot read or consume stock in Warehouse B.
- A user cannot transfer an asset from an unauthorized source or to an unauthorized destination.
- A user cannot access a custody/maintenance/purchase/document record by guessing its ID when its linked asset is out of scope.
- Empty, missing, stale, or revoked grants deny access, including when a previously authenticated user object is retained.
- Direct service calls enforce the same rules as UI calls.
- Bulk import validates every row's destination scope and fails closed without partial unauthorized writes.
- Read-only roles cannot mutate records or trigger workflow transitions.
- Admin-only operations revalidate the active administrator against the database.
- Tests run against an isolated temporary database; no production database or existing user data is used.

## Safe implementation sequence

1. Obtain approval of the role/action matrix and the definition of office versus warehouse ownership.
2. Review the current schema and produce a separate migration proposal. Do not run it.
3. Add principal and scope-policy primitives with unit tests.
4. Integrate policy checks into services, starting with asset reads/writes and transfers.
5. Integrate linked workflows and attachments/reports/import/export.
6. Add migration tests and a backwards-compatibility test against a copy of the existing schema.
7. Run Python and web CI, review the diff, and obtain explicit approval before any production migration or deployment.

## Current limitation

Until the required scope data exists and every relevant service checks it, the Python edition must be treated as having only its current coarse roles. The React/Firebase RBAC implementation is separate and must not be assumed to secure the Python local database.

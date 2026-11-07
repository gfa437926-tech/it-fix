# Legacy RBAC scope audit (read-only)

The audit utility reviews a **local Firestore JSON export** for records that do not carry the scope fields expected by the current Firestore and Storage rules. It does not connect to Firebase, modify records, migrate data, or deploy rules.

## Run

```bash
npm run audit:scope -- --input ./firestore-export.json
```

The input may be either a collection map or an object containing a `collections` map:

```json
{
  "collections": {
    "assets": [
      { "id": "asset-001", "officeId": "office-a", "warehouseId": "warehouse-a" }
    ],
    "spare_parts": [
      { "id": "part-001", "warehouseId": "warehouse-a" }
    ]
  }
}
```

The report identifies blank `officeId` and `warehouseId` values, records with neither scope ID, and spare-parts rows without a warehouse. It includes up to 20 example record IDs per category.

## Safety boundary

- Export the data yourself using an approved, read-only process.
- Keep the export local and do not commit it to the repository.
- Review the report and decide the correct office/warehouse mapping separately.
- This tool intentionally does not generate migration writes. Any migration requires a separately reviewed and explicitly approved plan.

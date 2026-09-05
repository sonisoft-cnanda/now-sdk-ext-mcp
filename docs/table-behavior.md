# Table behavior tools

`discover_table_behavior` returns business rules, UI actions, client scripts, UI/data policies, workflows, flows and generic state models. Default: active behavior, applicable ancestors, 50 items/category, 64 KiB JSON budget.

```json
{
  "table": "change_request",
  "categories": ["flows", "business_rules"],
  "details": ["definitions", "scripts", "dependencies"],
  "dependency_depth": 1,
  "instance": "dev"
}
```

`get_behavior_details` accepts 1–50 references without table discovery. Reference objects use the same spelling as discovery results, so they can be passed through unchanged:

```json
{
  "references": [
    { "kind": "flows", "sourceTable": "sys_hub_flow", "sysId": "0123456789abcdef0123456789abcdef" }
  ],
  "details": ["definitions"],
  "instance": "dev"
}
```

Both tools return core data in `structuredContent`, with a short text summary. Use per-category `nextCursor` values in `cursors` with unchanged filters. Increase `max_bytes` (maximum 1 MiB) or narrow the reference batch for omitted detail. Inspect category/item warnings and `remainingReferences`; empty does not imply complete.

Conditions are not executed. Runtime triggers and current design definitions remain distinguishable. UI policies, server requirements, and transition gates remain separate. One-level dependency expansion is bounded and preserves snapshot provenance; unresolved dynamic calls are labeled.

Tools are read-only and included in full/readonly packages, plus role packages that already expose table schema discovery. No credential is accepted or returned as a tool field.

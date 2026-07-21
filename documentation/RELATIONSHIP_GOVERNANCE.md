# Power BI Relationship Governance

The migration engine treats Qlik associations and physical Qlik JOIN operations differently.

- A Qlik JOIN becomes a Power Query merge and expansion in script order.
- Only the fields explicitly selected by the JOIN are moved to the target table.
- The source table removes moved fields from its semantic projection in optimized mode, but its complete staging query is retained.
- A relationship is created only on the retained single key, or on one governed composite key when multiple keys are explicitly required.
- Shared descriptive fields never create automatic relationships.
- The one side is cleaned for blank and duplicate keys before export.
- Relationships that cannot be proven safe remain inactive or are omitted.

The generated PBIP Migration folder records the join, field-lineage, table-classification, key, relationship, and validation decisions for review.

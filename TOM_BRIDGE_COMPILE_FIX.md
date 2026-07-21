# Microsoft TOM bridge compile fix

## Corrected issue

The bridge previously referenced a non-existent `AnnotatedMetadataObject` type. Microsoft TOM exposes annotation collections on concrete metadata objects such as `Model`, `Table`, `Column`, `Measure`, `Partition`, `NamedExpression`, and `Relationship`.

The bridge now passes those concrete annotation collections to a shared `ICollection<Annotation>` helper. This preserves strong typing and avoids runtime reflection or manually assembled TMDL.

## Build-script reliability

The PowerShell scripts now inspect native exit codes after `dotnet`, `npm`, `npx`, and test commands. A failed build can no longer print the misleading message `Microsoft TOM bridge ready`.

## Validate

```powershell
dotnet --version
powershell -ExecutionPolicy Bypass -File ".\scripts\build-tom-bridge.ps1"
powershell -ExecutionPolicy Bypass -File ".\scripts\test-tom-bridge.ps1"
```

The smoke test constructs two tables, source columns, one calculated column, one measure, annotations, partitions, and a many-to-one relationship, then validates a Microsoft TOM → TMDL → TOM roundtrip.

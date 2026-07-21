# Microsoft TOM → TMDL bridge

This .NET 8 command-line utility builds a real `Microsoft.AnalysisServices.Tabular.Database` object tree from the application's canonical TOM model specification and serializes it with Microsoft's `TmdlSerializer`.

It validates the generated folder by deserializing it again when `--roundtrip` is used.

## Build

```powershell
dotnet restore .\tools\TomTmdlBridge\TomTmdlBridge.csproj
dotnet build .\tools\TomTmdlBridge\TomTmdlBridge.csproj -c Release --no-restore
```

## Run directly

```powershell
dotnet run --project .\tools\TomTmdlBridge\TomTmdlBridge.csproj -c Release -- `
  --input .\tom-model-spec.json `
  --output .\definition `
  --roundtrip
```

The local TanStack server automatically uses this bridge through `/api/tom/serialize` when .NET 8 is available. If the bridge is unavailable, export falls back to the strict TypeScript TMDL serializer and records the engine in `Migration/tmdl-engine.txt`.

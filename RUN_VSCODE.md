# Run and test from Visual Studio Code

Open the folder containing `package.json`, then run:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Configure these values in `.env` before login:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
```

Open the URL printed by Vite, normally `http://localhost:8080/`.

## Test the supplied QVW/PRJ fixture

Upload the complete ZIP:

```text
EnterpriseComplexQlikProject_With_QVW_PRJ_Visuals_Updated.zip
```

Then review:

1. QVW Analysis
2. Expression Conversion
3. ETL Analysis
4. Power BI Model
5. Relationships
6. Validation & Export
7. Logs

## Compile and test

```powershell
npx tsc --noEmit
npm test
npm run build
```

## Production preview

```powershell
npm run preview
```

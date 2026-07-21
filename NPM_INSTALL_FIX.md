# Clean npm installation

The package lock is normalized to public npm tarball URLs. It must not contain any private build-environment Artifactory address.

Recommended Windows installation:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-clean.ps1"
```

The script verifies Node.js 22+, checks the lock file, removes a partial `node_modules` directory, verifies the npm cache, and runs `npm ci` against `https://registry.npmjs.org/` without changing the user's permanent npm configuration.

Manual equivalent:

```powershell
Remove-Item -Recurse -Force .\node_modules -ErrorAction SilentlyContinue
$env:npm_config_registry = "https://registry.npmjs.org/"
npm cache verify
npm ci --no-audit --no-fund
```

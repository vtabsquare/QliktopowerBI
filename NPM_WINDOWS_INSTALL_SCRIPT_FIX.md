# Windows npm install script fix

The clean installer now resolves and invokes `npm.cmd` explicitly on Windows.
This prevents PowerShell aliases or `npm.ps1` shims from incorrectly passing
`pm` as the npm command.

The installer also no longer treats `npm cache verify` as a mandatory step,
because cache verification may fail on a locked user cache even when `npm ci`
can install correctly.

Preferred command:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-clean.ps1"
```

Command Prompt fallback:

```cmd
scripts\install-clean.cmd
```

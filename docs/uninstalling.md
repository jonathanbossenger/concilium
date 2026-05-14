# Uninstalling Concilium

1. Stop Concilium:
   ```bash
   conciliumctl stop
   ```
2. If installed as a user service (macOS/Linux), remove the service:
   ```bash
   conciliumctl uninstall
   ```
3. If you ran `npm link`, remove the global shim:
   ```bash
   npm unlink -g concilium
   ```
4. Optionally remove all local Concilium state (config, DB, logs):
   ```bash
   rm -rf ~/.concilium
   ```
5. Optionally remove your local clone:
   ```bash
   cd ..
   rm -rf concilium
   ```

On Windows, `conciliumctl uninstall` reports `not installed` because
install/uninstall service mode is currently macOS/Linux-only.

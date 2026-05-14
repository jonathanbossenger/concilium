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
   This permanently deletes your saved task history, logs, and agent configuration.
5. Optionally remove your local clone:
   ```bash
   cd ..
   rm -rf concilium
   ```

For platform support details (including Windows service-mode limitations), see
[Using Concilium](using-concilium.md).

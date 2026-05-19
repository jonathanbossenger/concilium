# Setting up Concilium in server mode

Use this guide when you want to access Concilium from another machine (for example over Tailscale or through a reverse proxy).

## 1) Install and start once in local mode

Follow [install-and-first-time-setup.md](install-and-first-time-setup.md), then stop Concilium:

```bash
conciliumctl stop
```

## 2) Update `~/.concilium/config.yaml`

Edit the config and set a non-loopback host:

```yaml
host: 0.0.0.0
port: 7878
```

Notes:

- `127.0.0.1` is local-only and will not accept remote connections.
- `0.0.0.0` listens on all IPv4 interfaces (including Tailscale).
- You can use `::` if you specifically want IPv6 binding.

If you run Concilium behind a reverse proxy, also set:

```yaml
trustProxy: true
```

If TLS is terminated upstream and you still want `Secure` cookies even without forwarded proto headers, set:

```yaml
forceSecureCookies: true
```

## 3) Start Concilium and read the setup token

```bash
conciliumctl start
conciliumctl logs
```

When server mode is enabled and no admin exists yet, Concilium prints a one-time setup token in the server logs.

## 4) Open Concilium from a remote client

Use HTTP unless you have explicitly added TLS in front of Concilium:

```text
http://<server-ip-or-name>:7878
```

Examples:

- `http://100.x.y.z:7878` (Tailscale IP)
- `http://my-host.tailnet-name.ts.net:7878` (MagicDNS)

Complete the setup dialog with:

- setup token from the logs
- admin username
- admin password

## 5) Verify connectivity if remote access fails

1. Confirm `host` is **not** `127.0.0.1`.
2. Restart after config edits: `conciliumctl restart`.
3. Check status/logs:
   - `conciliumctl status`
   - `conciliumctl logs`
4. Ensure your network/firewall allows inbound traffic to port `7878`.

## 6) Revert to local-only mode

To disable server mode later, follow the revert steps in the root [README.md](../README.md#public-server-hardening-notes).

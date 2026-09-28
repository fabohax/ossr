# OSSR Operator Desktop

Linux desktop monitoring and service control for the existing OSSR testnet
relay. The UI is a Tauri 2 shell; health checks and systemd interactions live in
Rust and the webview has no shell or filesystem capability.

## Current scope

- relay liveness, readiness, identity, sponsor balance, and session metrics;
- local Stacks follower status, chain heights, and `is_fully_synced`;
- comparison against a public testnet reference tip;
- installation and control of a hardened, machine-level relay service;
- opt-in relay startup at boot and dashboard startup at desktop login;
- native Polkit authentication for privileged changes, without handling the
  administrator password in the application.

This dashboard monitors and controls the TypeScript reference relay. It does
not yet move sponsor signing into Rust; that work remains gated by the protocol
compatibility and durable-state milestones in the desktop roadmap.

## Development

On Debian/Ubuntu, install the Linux packages required by Tauri 2, then run the
application:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
cd apps/operator-desktop/src-tauri
cargo run
```

The default endpoints are:

```text
Relay:           http://127.0.0.1:3002
Stacks follower: http://127.0.0.1:20443
Reference node:  https://api.testnet.hiro.so
```

Core tests do not require desktop system libraries:

```sh
cargo test --no-default-features
```

## Autostart behavior

**Install system service** invokes the current executable through `pkexec`.
Polkit presents the operating system's administrator-password dialog. The
password is never returned to, logged by, or stored in the dashboard.

Installation creates:

- `/etc/systemd/system/ossr-relay.service` — machine-level relay service,
  enabled for `multi-user.target` and run as the repository owner;
- `~/.config/systemd/user/ossr-operator-dashboard.service` — unprivileged GUI
  service for the graphical login.

The operator then opts in with **Start automatically**. The relay starts during
system boot, independently of login. The dashboard starts with the graphical
user session because a GUI cannot safely start before a display session exists.

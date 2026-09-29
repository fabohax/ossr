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

## Run the published Linux build

The current preview supports Linux x86-64. It monitors the relay and Stacks
follower running on the same machine.

1. Configure the relay from the repository root if you have not done so:

   ```sh
   npm install
   cp .env.example .env.local
   chmod 600 .env.local
   ```

   Fill in the required testnet values in `.env.local`. In particular, the
   relay requires its sponsor and quote keys plus the Stacks simulation token.

2. Download `ossr-operator-desktop-v0.1.0-linux-x86_64.tar.gz` from the
   [v0.1.0 GitHub release](https://github.com/ossr-protocol/ossr/releases/tag/v0.1.0).

3. Optionally verify the archive:

   ```sh
   echo "82488317ff72456fb73bc9d206853229eb316a5ecf8b1b8a0fd46e273d0e82af  ossr-operator-desktop-v0.1.0-linux-x86_64.tar.gz" | sha256sum --check
   ```

4. Extract and start the dashboard:

   ```sh
   tar -xzf ossr-operator-desktop-v0.1.0-linux-x86_64.tar.gz
   cd ossr-operator-desktop-v0.1.0-linux-x86_64
   ./ossr-operator-desktop
   ```

5. To let the dashboard manage startup, select **Install system service** and
   enter the path to the cloned OSSR repository. Linux displays its native
   Polkit administrator-password prompt. The relay is enabled for system boot,
   and the dashboard is enabled for future graphical logins automatically.
   Use **Start automatically** to disable or re-enable both services later.

If the executable reports a missing shared library on Debian/Ubuntu, install
the runtime packages:

```sh
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

The dashboard does not contain signing keys. It reads public operational data
from the configured local endpoints, while the relay continues to load secrets
from the repository's protected `.env.local` file.

## Run from source

On Debian/Ubuntu, install the Linux packages required by Tauri 2, then run the
application:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
cd apps/operator-desktop/src-tauri
cargo run
```

Alternatively, from the repository root:

```sh
npm run operator:desktop
```

Create an optimized executable with:

```sh
cargo build --release --manifest-path apps/operator-desktop/src-tauri/Cargo.toml
```

The executable is written to
`apps/operator-desktop/src-tauri/target/release/ossr-operator-desktop`.

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
  service for the graphical login;
- `~/.local/share/applications/network.ossr.operator.desktop` — application
  menu launcher using the bundled OSSR icon.

Both services are enabled during installation. The relay starts during system
boot, independently of login. The dashboard starts with the graphical user
session because a GUI cannot safely start before a display session exists. Use
**Start automatically** to disable or re-enable both services together.

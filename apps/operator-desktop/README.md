# OSSR Operator Desktop

This repository contains the standalone Linux desktop dashboard for operating and monitoring an OSSR relay on testnet. It is a Tauri 2 application that connects to a local relay and Stacks follower, shows operational health, and can install or manage relay services on the host machine.

The desktop app is intentionally separate from the operator CLI repository. It inspects public operational data from the relay and does not hold or manage private keys itself.

## What this repo contains

- Tauri desktop shell for Linux
- Relay health, readiness, and metrics dashboard
- Stacks follower sync and reference-tip comparison
- Activity history and diagnostics panels
- Optional systemd autostart and relay service management

## Requirements

- Linux x86-64
- A running OSSR relay on `127.0.0.1:3002`
- A Stacks follower exposed at the configured node URL
- Tauri 2 system dependencies for building or running from source

## Local configuration

The desktop app reads the relay and node endpoints at runtime. A simple example is provided in `.env.example` for local setups:

```bash
cp .env.example .env.local
```

Example values:

```bash
OSSR_RELAY_URL=http://127.0.0.1:3002
STACKS_FOLLOWER_URL=http://127.0.0.1:20443
STACKS_REFERENCE_URL=https://api.testnet.hiro.so
```

If you are running the app without a `.env.local` file, use the defaults below when configuring the local endpoints in the UI or service setup:

```text
Relay:           http://127.0.0.1:3002
Stacks follower: http://127.0.0.1:20443
Reference node:  https://api.testnet.hiro.so
```

## Run from source

On Debian/Ubuntu, install the required packages:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```

Then start the app:

```bash
cd src-tauri
cargo run
```

To build a release binary:

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml
```

The executable is written to:

```text
src-tauri/target/release/ossr-operator-desktop
```

## Autostart and service management

The desktop app can install system-level services for the relay and desktop dashboard. This uses the OS-native Polkit flow for privileged actions; the password is never returned to, logged by, or stored in the app.

Installation creates:

- `/etc/systemd/system/ossr-relay.service`
- `~/.config/systemd/user/ossr-operator-dashboard.service`
- a desktop launcher under the user's app menu

The relay service is enabled for machine boot and the dashboard service is enabled for the graphical login session.

## Diagnostics and activity

The dashboard includes:

- liveness and readiness checks
- sponsor balance and relay health observations
- follower synchronization and chain-tip comparison
- recent quote and sponsorship activity
- suggested remediation actions for common operator issues

## Local validation

Core checks can be run without the desktop runtime dependencies:

```bash
cargo test --no-default-features
```

The UI diagnostics smoke test is also available:

```bash
node ui/diagnostics.test.cjs
```

## License

This project is licensed under the terms in the repository license file.

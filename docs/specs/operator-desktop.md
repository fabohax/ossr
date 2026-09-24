# OSSR Linux Operator Desktop

## Status

- **Product:** OSSR Operator Desktop
- **Specification version:** 0.1 draft
- **Target platform:** Linux desktop
- **Target network:** Stacks testnet only
- **Application shell:** Tauri 2
- **Trusted core:** Rust
- **Local state:** SQLite
- **Last updated:** September 21, 2026

## 1. Purpose

OSSR Operator Desktop is a self-contained Linux application for configuring and
running an OSSR relay. It gives an operator a graphical interface for setup,
key management, quote policy, transaction sponsorship, broadcasting, health,
and recovery without placing sponsor credentials in a browser application or a
stateless hosting environment.

The desktop application implements the existing OSSR v1 relay surface defined
in [relay-api.md](relay-api.md). It does not define a second wire protocol.
Quote encoding and signatures remain governed by
[quote-format.md](quote-format.md), while transaction acceptance remains
governed by the adapter and threat-model specifications.

The first release is a testnet operational tool. It MUST NOT enable mainnet or
claim production-grade custody before an external security review and the
mainnet release gates in this document are completed.

## 2. Goals

The application SHALL:

1. guide a new operator from installation to a ready testnet relay;
2. generate and manage distinct sponsor and quote-signing identities;
3. keep private key material outside the webview and frontend state;
4. validate, simulate, sponsor, broadcast, and reconcile OSSR transactions;
5. persist quote consumption, nonce reservations, and transaction outcomes;
6. expose the standard OSSR relay API over a configurable HTTPS endpoint;
7. make relay health, balances, pricing, and failures understandable;
8. support safe backup, rotation, pause, and recovery procedures; and
9. produce protocol fixtures compatible with the TypeScript reference relay.

## 3. Non-goals for version 0.1

- Mainnet operation.
- Custody of user funds.
- Arbitrary Stacks contract sponsorship.
- Browser access to private keys.
- Multiple active sponsor accounts.
- Automatic treasury funding or asset swaps.
- Batched settlement or vault accounting.
- Remote administration from an OSSR central service.
- Silent key export, cloud backup, or recovery escrow.
- A promise of continuous service from a sleeping or disconnected workstation.

## 4. System architecture

```text
Tauri webview
  setup, dashboard, policy, activity, logs
          |
          | typed Tauri commands and events
          v
Rust application core
  configuration | policy | validation | signing | reconciliation
          |
          +---- SQLite database
          +---- encrypted key vault / Linux Secret Service
          +---- local OSSR HTTP server
          +---- Stacks API and simulation RPC
          +---- optional HTTPS tunnel sidecar
```

### 4.1 Trust boundaries

The Tauri webview is an untrusted presentation boundary. It MAY receive public
keys, principals, balances, policy values, transaction IDs, sanitized errors,
and aggregate metrics. It MUST NOT receive private keys, seed phrases,
decrypted vault contents, raw secret environment variables, or unrestricted
filesystem and process capabilities.

The Rust core is the sole signing boundary. Every operation that can produce a
quote signature or sponsor authorization MUST be implemented in Rust and MUST
re-run its own validation rather than trusting values previously displayed by
the UI.

The public relay listener is an adversarial network boundary. Requests MUST be
bounded, decoded strictly, rate-limited, validated, and mapped to stable OSSR
errors. Public requests MUST NOT invoke general Tauri commands.

### 4.2 Process model

Version 0.1 uses one application process containing the UI shell and Rust relay
core. The relay continues serving while the window is hidden to the system
tray. Closing the window MUST NOT silently terminate an active relay; the UI
must offer explicit **Hide**, **Stop relay**, and **Quit** actions.

Autostart is opt-in. When enabled, the application starts minimized and keeps
the relay paused until the key vault is unlocked. Automatic unlock MAY use the
Linux Secret Service when available. Password-based vaults MUST require an
interactive unlock after login.

## 5. Components

### 5.1 Desktop shell

Tauri 2 provides window lifecycle, system tray, notifications, autostart,
signed updates, and narrowly scoped sidecar execution. Capability files MUST
grant only commands and resources used by the operator interface. A generic
shell command capability is prohibited.

### 5.2 Rust protocol core

The protocol core owns:

- quote canonicalization, hashing, signing, and verification;
- Stacks transaction decoding and canonical re-encoding checks;
- origin authorization and signature verification;
- adapter function and argument validation;
- exact post-condition validation;
- fee estimation and simulation validation;
- sponsor nonce reservation and authorization signing;
- broadcast and ambiguous-result handling; and
- status reconciliation.

The core MUST expose library APIs independent of Tauri so it can be fuzzed,
unit-tested, and used by a future headless daemon.

### 5.3 Relay HTTP service

The embedded service MUST implement at least:

```text
GET  /v1/info
POST /v1/quotes
POST /v1/sponsorships
GET  /v1/sponsorships/{txid}
GET  /health/live
GET  /health/ready
```

Optional metrics and operator-registry endpoints MAY be implemented after the
required endpoints conform. Responses containing quote, sponsorship, status,
or readiness state MUST use `Cache-Control: no-store`.

The default listener is `127.0.0.1` on an unprivileged configurable port. The
application MUST warn before binding to a LAN or wildcard address.

### 5.4 Durable state

SQLite is the authoritative local store. WAL mode MAY be used, but safety MUST
not depend on one in-memory mutex. Transactions and uniqueness constraints must
enforce idempotency and nonce allocation.

Minimum logical tables are:

| Table | Purpose |
| --- | --- |
| `settings` | Versioned non-secret operator configuration |
| `quote_keys` | Public key metadata, status, and vault references |
| `quotes` | Signed quote, intent hash, expiry, and lifecycle state |
| `sponsorships` | Request hash, transaction ID, response, and outcome |
| `nonce_reservations` | Sponsor, nonce, transaction ID, and reconciliation state |
| `upstream_observations` | Simulation and broadcast evidence needed for diagnosis |
| `audit_events` | Sanitized security and operator actions |

The database MUST enforce:

- unique quote IDs;
- one request hash per consumed quote;
- unique `(sponsor, nonce)` reservations;
- unique sponsored transaction IDs; and
- monotonic state transitions unless a documented recovery action applies.

Schema changes MUST use forward migrations. Before a destructive migration,
the application MUST create a recoverable backup and verify it can be read.

## 6. Key model

### 6.1 Identities

| Identity | Purpose | Default handling |
| --- | --- | --- |
| Registry owner | Registers and governs the operator | External browser wallet; never imported |
| Sponsor key | Adds sponsor authorization and pays STX | Encrypted local vault |
| Quote key | Signs short-lived relay offers | Separate encrypted local vault entry |

Sponsor and quote keys MUST be distinct. The setup wizard MUST reject reuse of
the same public key. The owner wallet MUST remain separate from both keys.

### 6.2 Generation

Keys MUST be generated with the operating system CSPRNG. The Rust core returns
only the derived public key and Stacks principal to the UI. The private key is
written directly to the selected protected storage.

The application MUST support importing an existing testnet private key only
through a dedicated, warning-gated flow. Imported secrets MUST be cleared from
UI state immediately after the Rust command completes and MUST never be logged.

### 6.3 Storage

The preferred Linux backend is the Secret Service API. A portable fallback MAY
use an encrypted vault whose key is derived from an operator password using a
memory-hard KDF. The vault format MUST authenticate ciphertext and metadata.

The fallback MUST NOT store the password, derived key, or an unencrypted copy
of either signing key. Sensitive Rust buffers SHOULD use zeroization where the
selected cryptographic libraries permit it.

### 6.4 Backup and recovery

The operator may create an encrypted offline backup. Backup creation requires
fresh authentication, an explicit destination, and confirmation that the file
contains private signing material. No automatic cloud backup is allowed.

Recovery MUST verify the derived sponsor principal and quote public key before
re-enabling the relay. Restoring a database without the matching keys, or keys
without compatible durable nonce state, leaves the relay paused for manual
reconciliation.

### 6.5 Rotation

Quote-key rotation uses `pending -> active -> retired`. The relay MAY publish a
pending public key before activation and MUST retain retired public metadata
until every quote signed by it is expired.

Sponsor-key rotation requires the relay to pause, reconcile all nonce
reservations, verify the replacement balance, update registration or metadata
as required, and then resume. It MUST NOT silently abandon ambiguous
transactions associated with the previous sponsor.

## 7. Setup workflow

The first-run wizard SHALL:

1. display the testnet-only warning and local security assumptions;
2. select or create protected key storage;
3. generate distinct sponsor and quote keys;
4. show the sponsor testnet address and funding status;
5. configure Stacks API, Core simulation RPC, adapter, and sBTC principals;
6. configure quote policy, limits, CORS origins, and emergency controls;
7. select local-only, user-managed HTTPS, or supported tunnel exposure;
8. run readiness and protocol self-tests;
9. expose registration values without requiring manual public-key hex entry;
10. launch the owner-wallet registration flow in the system browser; and
11. start the relay only when every required gate passes.

The UI SHOULD deep-link to `https://ossr.network/operators` with a one-time,
non-secret setup payload containing the relay endpoint, operator ID, and quote
public key. Registration remains an owner-wallet transaction. The desktop app
MUST NOT request the owner's private key.

## 8. Endpoint exposure

### 8.1 Local-only mode

Local-only mode is the default and supports development and diagnostics. It is
not discoverable by public wallets.

### 8.2 User-managed HTTPS

Advanced operators MAY terminate TLS with their own reverse proxy and domain.
The UI must test the public `/v1/info` and `/health/ready` URLs from an external
network path before marking the endpoint public.

### 8.3 Managed tunnel mode

A future supported tunnel MAY provide an endpoint such as:

```text
https://<operator-id>.relay.ossr.network
```

The tunnel credential authenticates routing only; it MUST NOT authorize quote
or sponsor signing. The tunnel binary MUST be pinned, checksummed, bundled or
installed explicitly, and launched with a fixed argument allowlist. Tunnel
failure pauses public readiness but does not erase state.

No OSSR routing service may terminate or obtain operator signing keys. The
public hostname MUST ultimately forward to the local relay API with end-to-end
request integrity.

## 9. Quote management

The policy screen exposes the values defined by
[default-fee-policy.md](default-fee-policy.md), including pricing model,
minimum fee, cost inputs, quote lifetime, transfer limits, and pause state.

Before issuing a quote, the Rust core MUST:

1. validate request bounds and canonical principals;
2. read a current chain tip and required pricing inputs;
3. calculate the fee using integer arithmetic;
4. enforce operator and adapter limits;
5. persist the complete issued quote; and
6. sign the canonical quote bytes with the active quote key.

The UI may preview policy changes but MUST clearly identify unapplied values.
Applying a security-sensitive policy change creates an audit event.

## 10. Sponsorship and broadcasting

The signing pipeline is fail-closed:

```text
decode -> verify quote -> validate intent -> validate transaction
       -> estimate fee -> reserve quote -> reserve nonce
       -> sponsor-sign in memory -> simulate complete transaction
       -> persist evidence -> broadcast -> persist result -> reconcile
```

No sponsor signature may be produced before all static validation succeeds.
The complete signed transaction may exist in memory for simulation, but it MUST
not be broadcast after a failed, stale, malformed, or ambiguous simulation.

An ambiguous broadcast reserves the quote and nonce until reconciliation. The
operator UI may offer a guided investigation but MUST NOT provide a one-click
"release nonce" action without showing the recorded transaction ID, upstream
observations, and consequences.

## 11. User interface requirements

### 11.1 Dashboard

- Relay state: locked, paused, starting, ready, degraded, or stopped.
- Public endpoint and externally observed readiness.
- Sponsor STX and received sBTC balances.
- Active quote key ID and registration status.
- Chain tip, upstream latency, and last successful synchronization.
- Counts for quotes, rejections, broadcasts, confirmations, and ambiguity.
- Prominent emergency pause control.

### 11.2 Keys

- Public identities and fingerprints.
- Storage backend and last-unlocked time.
- Backup status without revealing secret contents.
- Quote-key rotation workflow.
- Explicit, authenticated export and recovery actions.

### 11.3 Quotes and transactions

- Filterable lifecycle tables.
- Exact signed fields and policy decision for each quote.
- Validation, simulation, nonce, broadcast, and confirmation timeline.
- Explorer links and copyable public identifiers.
- Sanitized failure reason and recommended operator action.

### 11.4 Logs

Logs MUST be structured, bounded, and redact secrets and raw authorization
material. Export requires a preview of included fields. Debug mode MUST NOT
disable redaction.

## 12. Operational controls

The application SHALL support:

- pause new quotes;
- pause sponsorship while keeping status endpoints available;
- drain mode that stops quotes and completes existing safe work;
- graceful shutdown with database checkpoint;
- upstream failover configuration;
- database backup and integrity check;
- explicit nonce reconciliation; and
- signed application updates with release notes and rollback guidance.

An emergency pause must take effect before any new signing operation begins.

## 13. Security requirements

In addition to [threat-model.md](threat-model.md):

- Tauri Content Security Policy MUST disallow remote scripts.
- Navigation MUST be limited to packaged application content.
- External URLs MUST open through an allowlisted system-browser command.
- Tauri commands MUST use typed inputs and enforce length limits in Rust.
- The HTTP server and Tauri command surface MUST not share an authorization
  shortcut.
- Database files and backups SHOULD be owner-readable only.
- Clipboard use for secrets is prohibited by default.
- Core dumps SHOULD be disabled or documented as a key-exposure risk.
- Dependency, license, and vulnerability scanning MUST run in CI.
- Release artifacts MUST be reproducible where practical and cryptographically
  signed.
- Update verification failure MUST leave the installed version intact.

## 14. Packaging and support

The initial supported artifacts are:

- AppImage for broad testnet evaluation;
- Debian package for Debian and Ubuntu derivatives; and
- detached checksums and signatures for every artifact.

Distribution-specific keyring and webview dependencies must be documented.
Flatpak MAY follow after its sandbox permissions, Secret Service access, and
local listener behavior are verified.

The minimum supported distributions and CPU architectures are release metadata,
not implicit promises. Unsupported systems must receive an actionable startup
error.

## 15. Testing and conformance

Required test layers are:

1. Rust unit and property tests for canonical encoding, policy, and state
   transitions.
2. Cross-language golden vectors shared with the TypeScript reference relay.
3. Fuzz tests for public request bodies and serialized Stacks transactions.
4. SQLite failure, crash-recovery, migration, and concurrent reservation tests.
5. Mocked API tests for stale, malformed, unavailable, and inconsistent
   upstreams.
6. End-to-end tests against Clarinet/devnet.
7. Public testnet acceptance with low-balance isolated keys.
8. Tauri capability and CSP tests proving the webview cannot retrieve secrets.
9. Packaging tests on every supported Linux distribution.
10. Update, rollback, backup, restore, and key-rotation drills.

The Rust implementation MUST match the existing quote hashes, signatures,
transaction decoding, post-condition decisions, and error classifications for
all normative fixtures.

## 16. Version 0.1 acceptance criteria

- [ ] A clean Linux installation can complete setup without manually handling a
      quote public-key hex string.
- [ ] Private keys never cross into webview memory or application logs.
- [ ] The relay passes every OSSR v1 API and protocol conformance fixture.
- [ ] SQLite preserves quote idempotency and nonce uniqueness across crashes.
- [ ] Invalid or mutated transactions cannot reach sponsor signing.
- [ ] Failed simulation cannot reach broadcast.
- [ ] An ambiguous broadcast survives restart and requires reconciliation.
- [ ] The public endpoint passes external readiness checks over HTTPS.
- [ ] Registration uses an external owner wallet and the desktop-provided public
      metadata.
- [ ] Emergency pause prevents new quote and sponsor signatures.
- [ ] Backup and restore are demonstrated on a second Linux machine.
- [ ] At least ten sponsored testnet transfers complete through the desktop
      relay, including retries and controlled rejection cases.
- [ ] Installation artifacts, checksums, known limitations, and operator runbook
      are published.

## 17. Mainnet blockers

Mainnet MUST remain compile-time and runtime disabled until:

- the protocol and Rust signing implementation receive external review;
- signer storage and recovery receive a focused security assessment;
- a hardware or remote-signer integration is available for sponsor keys;
- durable state and nonce recovery survive fault-injection testing;
- signed update infrastructure and incident rollback are operational;
- public endpoint abuse controls and monitoring are deployed;
- an operator completes a sustained testnet soak period; and
- the project publishes a mainnet-specific threat model and loss limits.

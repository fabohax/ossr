# ADR 0002: Use PostgreSQL for durable state

- **Status:** Accepted
- **Date:** July 31, 2026
- **Decision owners:** OSSR maintainers

## Context

The relay must make several correctness-sensitive state changes:

- issue unique, single-use quotes;
- make repeated sponsorship requests idempotent;
- ensure no two workers assign the same sponsor nonce;
- preserve the exact sponsor-signed transaction bytes after ambiguous
  broadcasts;
- reconcile database, mempool, and confirmed nonce state after a crash; and
- provide queryable state for status endpoints and the pilot report.

The development plan proposed SQLite for PoC convenience, while the architecture
already requires PostgreSQL transactions and advisory locking. This
contradiction must be resolved before implementation.

SQLite can serialize a single local process, but OSSR's key invariant is
coordination around an external account nonce. That state must remain correct
across worker tasks, process restarts, accidental duplicate processes, and
deployment changes. Designing around SQLite first would either weaken those
guarantees or create a database migration at the same time the relay is being
hardened.

## Decision

PostgreSQL will be the only supported durable database for the PoC.

Redis and an in-memory production mode are excluded. Tests MAY use ephemeral
PostgreSQL containers; database behavior MUST NOT be substituted with SQLite in
integration or concurrency tests.

The Rust relay will use SQLx with PostgreSQL-specific types and migrations. The
project does not promise database portability.

## Transaction and locking model

The database schema MUST enforce at least:

- unique `quotes.quote_id`;
- at most one sponsorship record per quote;
- unique sponsorship request hash for idempotency;
- unique `(sponsor_principal, sponsor_nonce)`;
- explicit quote and sponsorship states constrained by enums or checks; and
- immutable sponsor-signed bytes once recorded.

Nonce reservation MUST use one PostgreSQL transaction per sponsor account:

1. begin a transaction;
2. acquire a transaction-scoped advisory lock derived deterministically from
   the sponsor principal;
3. lock the sponsor-account row with `SELECT ... FOR UPDATE`;
4. reconcile the durable nonce view with the already fetched chain and mempool
   observations;
5. reserve a unique nonce;
6. persist the quote consumption and sponsorship state;
7. commit; and
8. perform signing through the narrow signer interface.

Because private-key operations and network broadcast must not hold a database
transaction open, the full signing lifecycle requires a durable state machine.
If signing succeeds, the exact signed bytes and transaction ID MUST be stored
before or atomically with entry into the broadcast-retry state. The detailed
crash-recovery sequence belongs in the persistence/state-machine specification.

Transaction-scoped advisory locks (`pg_advisory_xact_lock`) are preferred over
session-scoped locks because they are automatically released on commit,
rollback, or connection loss. Every code path that coordinates a sponsor nonce
MUST acquire the same lock; PostgreSQL does not enforce advisory-lock semantics
on behalf of the application.

## Rationale

PostgreSQL is preferable even for the single-operator PoC because:

- unique constraints directly enforce replay and nonce invariants;
- row locks and transaction-scoped advisory locks support deterministic
  serialization;
- crash recovery does not depend on one process's memory;
- it matches the intended Docker Compose deployment;
- it prevents an immediate SQLite-to-PostgreSQL migration;
- concurrency and recovery behavior can be tested under the production
  database engine; and
- the operational cost is modest: one database container and no Redis.

For this project, correctness is more important than the small convenience of a
single-file database.

## Consequences

### Positive

- Architecture and development plan use one consistent persistence model.
- Database constraints become part of the security boundary.
- Multiple accidental relay processes still coordinate through one lock domain.
- The PoC exercises the same concurrency semantics intended for later pilots.
- SQLx supports PostgreSQL transactions, compile-time query checking, and
  advisory-lock access.

### Negative

- Local development requires PostgreSQL or a container runtime.
- Backups, migrations, credentials, and connection limits must be documented.
- Tests involving persistence are slower than in-memory or SQLite tests.
- Advisory-lock key derivation must be stable and collision-aware.

## Rejected alternatives

### SQLite for the PoC

Rejected because it does not match the architecture's advisory-lock design and
would defer the real nonce-coordination behavior until after the core flow was
built.

### PostgreSQL plus Redis

Rejected because PostgreSQL already provides the required durable state,
constraints, locks, and queue-like transitions. Redis adds an unnecessary
failure mode for the PoC.

### In-memory state

Rejected because a restart could permit quote reuse, lose nonce reservations,
or lose the only copy of sponsored transaction bytes.

## References

- [PostgreSQL explicit and advisory locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL advisory lock functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
- [SQLx PostgreSQL module](https://docs.rs/sqlx/latest/sqlx/postgres/)

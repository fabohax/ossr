# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for OSSR.

ADRs describe decisions that materially constrain implementation. They are
append-only: when a decision changes, add a new ADR that supersedes the old one
instead of rewriting history.

## Status values

- **Proposed:** under discussion.
- **Accepted:** approved for implementation.
- **Superseded:** replaced by a later ADR.
- **Deprecated:** retained for history but no longer recommended.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-use-rust-for-the-relay.md) | Use Rust for the relay and TypeScript for the client SDK | Accepted |
| [0002](0002-use-postgresql-for-durable-state.md) | Use PostgreSQL for durable state and nonce coordination | Accepted |

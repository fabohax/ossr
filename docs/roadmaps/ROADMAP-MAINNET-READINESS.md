# OSSR Mainnet Readiness Development Roadmap

## Status

- **Project:** Open Stacks Sponsor Relay (OSSR)
- **Release target:** A narrowly scoped mainnet beta for sponsored sBTC transfers
- **Status:** Proposed; no mainnet release authorization
- **Current baseline:** Testnet proof of concept
- **Last updated:** October 20, 2026

This roadmap defines the work and evidence required to decide whether OSSR can
launch on Stacks mainnet. It is a development plan, not a claim that the system
is safe or authorized for mainnet. Every gate must be reviewed and accepted
before mainnet assets or users are exposed.

## 1. Scope and launch shape

The first mainnet release should remain deliberately narrow:

- One sponsored action: a user-authorized sBTC transfer through a reviewed
  adapter.
- One explicitly supported sBTC token contract and one adapter version.
- Bounded transfer amount, reimbursement amount, quote lifetime, and per-operator
  loss exposure.
- A limited beta with named operators, monitored operation, and a documented
  pause and incident process.
- No arbitrary contract calls, reimbursement wrapper, withdrawals, batching,
  operator registry, or additional assets unless separately reviewed and
  approved.

The beta must not start until all release blockers in this roadmap are closed.
Passing one gate does not waive another.

## 2. Current baseline and known blockers

The repository currently describes OSSR as a testnet proof of concept. The
production sBTC and USDCx adapter sources pin testnet token principals and
reject mainnet. Clarinet tests use separate harness contracts and mock tokens;
they do not establish mainnet behavior of the production sources. The
reimbursement wrapper is outside the proposed launch scope and is not ready for
deployment: it accepts a caller-selected target, has an example owner principal,
and lacks a mainnet guard. Existing limitations also identify the absence of an
independent contract audit and a mainnet deployment process.

Initial release blockers:

- No mainnet-specific threat assessment, frozen protocol scope, loss budget, or
  operational authorization.
- No mainnet adapter pinned to a verified mainnet sBTC principal.
- No production-source tests against the intended mainnet token behavior.
- No independent contract security review or documented disposition of its
  findings.
- No reviewed deployment, verification, upgrade, pause, or incident runbooks.
- The current relay and key-management limitations have not been cleared for
  mainnet operation.

## 3. Delivery principles

1. Keep mainnet disabled by default in contracts, relay configuration, clients,
   deployment scripts, and operator tooling until their respective gates pass.
2. Freeze the supported behavior before implementation; changes to action,
   token, adapter, quote, or signing policy trigger renewed review.
3. Test the exact production contract source and exact deployment artifact, not
   only a test harness or mock.
4. Bind user reimbursement to the actual transaction sponsor and constrain
   asset movement to the user's explicit intent.
5. Minimize funds at risk through per-transaction, per-operator, and aggregate
   limits with a tested emergency stop.
6. Make every release claim traceable to reproducible evidence, reviewed
   artifacts, and a named approver.

## 4. Workstreams and exit gates

### Phase 0 — Scope, threat model, and release ownership

**Deliverables**

- Freeze v1 mainnet scope, supported sBTC contract, adapter interface, quote
  semantics, post-conditions, amount units, maximums, and expiry behavior.
- Write a mainnet threat assessment covering user funds, operator funds,
  contract behavior, relay signing, key custody, RPC/indexer trust, nonce races,
  transaction simulation, reorgs, availability, and incident response.
- Define the beta loss budget, maximum hot balance, transaction limits, daily
  exposure, operator eligibility, support coverage, and beta enrollment policy.
- Assign an owner and reviewer to each release gate and define how exceptions
  are rejected or escalated.

**Exit gate**

- [ ] Mainnet scope and exclusions are approved and versioned.
- [ ] Threats and risks have owners, controls, evidence, and explicit residual
      risk dispositions.
- [ ] Loss limits and authority to pause the service are documented.
- [ ] No open Critical or High risk lacks an effective mitigation or explicit
      release-blocking disposition.

### Phase 1 — Mainnet contract design and implementation

**Deliverables**

- Create a separately named mainnet adapter source that pins the verified
  mainnet sBTC principal; do not repoint the testnet artifact in place.
- Validate the token interface and transfer semantics against the canonical
  mainnet sBTC source and authoritative deployment information.
- Ensure sponsor reimbursement is derived from `tx-sponsor?`; prevent the
  origin from selecting a different reimbursement recipient.
- Enforce positive and bounded transfer/reimbursement values, quote expiry,
  correct principals, and all required authorization invariants.
- Emit a stable, versioned settlement event sufficient for reconciliation.
- Keep the test-only sponsor-argument entry point out of deployable artifacts.
- Remove the reimbursement wrapper from the launch path. If it is later
  proposed, redesign it with a fixed allowlist and separate review.

**Exit gate**

- [ ] Mainnet token principal and behavior are independently verified and
      recorded with source and deployment references.
- [ ] Static analysis and manual review cover the exact mainnet adapter source.
- [ ] Contract tests cover success, missing sponsor, expired quote, zero and
      maximum boundaries, wrong principals, insufficient balance, token errors,
      and atomic rollback of all asset movements.
- [ ] Tests prove no user loss beyond the signed transfer and exact quoted fee.
- [ ] Build and deployment checks prove the deployable artifact contains no test
      entry points, mock token dependency, or testnet principal.
- [ ] Contract source and byte-for-byte deployment artifact hashes are
      recorded.

### Phase 2 — Independent security review and remediation

**Deliverables**

- Commission an independent review of the adapter, token integration, quote and
  transaction binding, post-conditions, and relevant relay validation path.
- Provide reviewers the frozen scope, source hashes, threat model, tests,
  deployment assumptions, and known limitations.
- Track each finding with severity, owner, fix, regression test, and reviewer
  disposition.
- Re-review material contract changes and regenerate the reviewed artifact
  hashes after remediation.

**Exit gate**

- [ ] Independent review report is complete and published or retained for
      authorized beta participants.
- [ ] No unresolved Critical or High finding remains.
- [ ] Medium and lower findings have documented decisions and owners.
- [ ] Fixes are regression-tested and the reviewer confirms relevant fixes.
- [ ] Final reviewed source and artifact hashes match the release candidate.

### Phase 3 — Relay, signer, and infrastructure production hardening

**Deliverables**

- Add an explicit network allowlist and fail-closed startup validation for
  network, chain ID, adapter ID, token ID, sponsor key, and quote key.
- Use an HSM, KMS, or isolated remote signer with least-privilege access,
  rotation, revocation, access logging, and tested recovery procedures.
- Enforce transaction allowlists, complete transaction decoding, quote binding,
  sponsor and origin verification, exact post-conditions, fee ceilings, and
  simulation freshness before signing.
- Add durable nonce coordination, idempotent quote consumption, ambiguous
  broadcast reconciliation, reorg-aware confirmation states, and bounded retry
  behavior.
- Use authenticated, monitored, redundant mainnet RPC providers with chain-tip
  freshness and disagreement checks.
- Add rate limits, abuse controls, secure transport, secret redaction, durable
  audit events, alerting, backups, access review, and tested disaster recovery.
- Establish per-transaction and aggregate spend limits enforced independently
  of ordinary application configuration where practical.

**Exit gate**

- [ ] Mainnet mode cannot be activated through a single accidental setting or
      by mixing testnet and mainnet identifiers.
- [ ] Signer isolation, key rotation, revocation, and emergency disablement
      have been exercised in a controlled environment.
- [ ] Failure, replay, concurrency, stale-tip, RPC disagreement, nonce-gap,
      ambiguous-broadcast, and reorg scenarios have verified outcomes.
- [ ] Logs and audit records support transaction-level reconstruction without
      exposing private keys or signed secret material.
- [ ] Backup restoration, incident alerting, and operator access controls have
      been reviewed and exercised.

### Phase 4 — Mainnet deployment rehearsal and operational readiness

**Deliverables**

- Create a reviewed deployment manifest containing network, deployer, contract
  name, token principal, source hash, Clarity version, deployment fee ceiling,
  and expected post-deployment checks.
- Rehearse with the release candidate on testnet and a local mainnet-like
  environment; verify deployment source, call behavior, and monitoring.
- Document deployment, post-deployment verification, pause, key compromise,
  provider outage, loss-limit breach, and user communication procedures.
- Define launch staffing, escalation contacts, support hours, beta participant
  criteria, and rollback/containment decisions. Contract deployments are
  immutable, so containment means disabling relay signing and isolating funds.
- Establish live dashboards and alerts for sponsor balance, exposure, fees,
  failed or unknown transactions, quote rejection, RPC health, and settlement
  reconciliation.

**Exit gate**

- [ ] Deployment rehearsal succeeds from a clean, reviewed release artifact.
- [ ] Deployed source and configuration can be independently verified.
- [ ] Operators demonstrate emergency stop, signer disablement, and incident
      escalation.
- [ ] Funding and withdrawal controls are documented and tested with bounded
      balances.
- [ ] Runbooks, beta terms, support coverage, monitoring, and alert routing are
      approved by accountable owners.

### Phase 5 — Limited mainnet beta decision

**Deliverables**

- Conduct a formal go/no-go review with engineering, security, and operations
  owners using the evidence bundle from prior phases.
- Start with a small allowlisted participant set, low transaction limits,
  isolated operator balances, and monitored hours.
- Review every incident, unexpected fee, failed transaction, and reconciliation
  discrepancy before expanding usage.
- Publish a beta status and known limitations that accurately describe the
  supported action, operator model, and risk controls.

**Exit gate**

- [ ] Every prior phase gate is signed off; no gate is waived by schedule.
- [ ] Release candidate hashes, deployment transaction, principals, settings,
      and approvers are archived.
- [ ] Emergency stop is available and tested during beta operation.
- [ ] Beta limits and expansion criteria are measurable and pre-approved.
- [ ] A named release authority records the go/no-go decision.

## 5. Explicitly out of scope for the first mainnet beta

- USDCx or any asset beyond the reviewed sBTC integration.
- `reimbursement-wrapper.clar`, arbitrary target calls, and user-directed
  withdrawals.
- Batching, payment-intent queues, vault custody, or generic sponsorship.
- Permissionless operator registration, automated routing, or governance.
- Unbounded balances, unattended treasury management, or a claim of audited
  safety beyond the reviewed release scope.

Adding any excluded capability requires a new design review, threat assessment,
contract review, and release gate update.

## 6. Release evidence checklist

The release record must include:

- Approved scope, threat model, and risk register.
- Independent security review and finding dispositions.
- Reproducible contract and relay test reports tied to release commit and
  artifact hashes.
- Verified token and adapter principals and deployment source.
- Mainnet deployment manifest, transaction ID, and post-deployment checks.
- Signer, RPC, monitoring, incident, pause, and recovery evidence.
- Beta limits, participants, support plan, go/no-go decision, and accountable
  approvers.

## 7. Change control

Any change to the adapter, token principal, transfer semantics, quote format,
transaction validation, signer, spend limits, RPC trust model, or operator
topology must be assessed against the threat model. Security-sensitive changes
invalidate prior review evidence until the affected scope is re-reviewed. No
roadmap completion or testnet result by itself authorizes mainnet deployment.

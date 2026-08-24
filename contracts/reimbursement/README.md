Reimbursement Wrapper Contract
=============================

Overview
--------
This contract provides an atomic "process-and-reimburse" pattern: a sponsored transaction
can call `process-and-reimburse`, which first delegates to a target contract's `execute`
entrypoint (the original user action) and then pays out sBTC to an operator and a protocol
principal from this contract's escrow balance.

Deployment notes
----------------
- Edit `reimbursement-wrapper.clar` and set `sbtc-token` to the deployed sBTC contract principal.
- Edit `OWNER` to your deployer principal if you want the `withdraw` helper to be restricted.
- Pre-fund the wrapper contract by transferring sBTC tokens into the contract principal address.

How it works (high level)
-------------------------
1. Sponsor funds `reimbursement-wrapper` with sBTC (one-time or per-batch).
2. User constructs a contract-call transaction calling `process-and-reimburse` with:
   - `target-contract` (principal) that exposes `execute` entrypoint
   - `operator` and `protocol` principals
   - `operator-amount` and `protocol-amount` in sBTC (token smallest units)
   - `payload` forwarded to the target contract
3. Sponsor signs as sponsor and pays STX fee. The resulting single sponsored tx runs atomically:
   - The target contract's `execute` is called
   - On success, sBTC transfers from wrapper escrow to `operator` and `protocol` occur

Testing
-------
See `packages/stacks/scripts/reimbursement-wrapper-test.ts` for a small TypeScript scaffold that
shows how to build a `process-and-reimburse` contract-call using `@stacks/transactions`.

Limitations
-----------
- The target contract must expose a compatible `execute` entrypoint.
- Adapt the sbtc token transfer call's symbol/signature to match your sBTC contract's API.

# sBTC package

sBTC-specific transaction building, post-condition templates, adapter validation, and reimbursement calculations belong here.

`src/reimbursement.ts` provides the integer-only v0.1 reimbursement calculator.
Its policy and atomic settlement design are documented in
[docs/specs/reimbursement.md](../../docs/specs/reimbursement.md). Run its
focused checks with `npm run test:reimbursement`.

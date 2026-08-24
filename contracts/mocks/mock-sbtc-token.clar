(define-fungible-token sbtc-token)

(define-constant OWNER 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)
(define-constant ERR_NOT_AUTHORIZED (err u401))

(define-public (mint (amount uint) (recipient principal))
  (if (is-eq tx-sender OWNER)
      (ft-mint? sbtc-token amount recipient)
      ERR_NOT_AUTHORIZED))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (match memo value (print value) 0x)
    (ft-transfer? sbtc-token amount sender recipient)))

(define-read-only (get-balance (owner principal))
  (ok (ft-get-balance sbtc-token owner)))

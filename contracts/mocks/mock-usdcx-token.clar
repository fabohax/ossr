(define-fungible-token usdcx-token)

(define-constant OWNER 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)
(define-constant ERR_NOT_AUTHORIZED (err u401))
(define-constant ERR_NOT_OWNER (err u4))

(define-public (mint (amount uint) (recipient principal))
  (if (is-eq tx-sender OWNER)
      (ft-mint? usdcx-token amount recipient)
      ERR_NOT_AUTHORIZED))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) ERR_NOT_OWNER)
    (match memo value (print value) 0x)
    (ft-transfer? usdcx-token amount sender recipient)))

(define-read-only (get-balance (owner principal))
  (ok (ft-get-balance usdcx-token owner)))

(define-read-only (get-decimals) (ok u6))

;; Operators Registry
;; Allows operators to register by paying a 10 STX subscription fee.

(define-constant OWNER 'ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X)
(define-constant SUBSCRIPTION_FEE u10000000) ;; 10 STX in microstx
(define-constant ERR_FEE_TRANSFER_FAILED (err u1))
(define-constant ERR_ALREADY_REGISTERED (err u2))

(define-map operators
  { owner: principal }
  { operator-id: (string-ascii 64),
    public-key: (buff 33),
    endpoint: (string-ascii 256),
    last-seen: uint })

(define-public (register (operator-id (string-ascii 64)) (public-key (buff 33)) (endpoint (string-ascii 256)))
  (if (is-some (map-get? operators { owner: tx-sender }))
      ERR_ALREADY_REGISTERED
      (match (stx-transfer? SUBSCRIPTION_FEE tx-sender OWNER)
        success
          (begin
            (map-insert operators { owner: tx-sender }
                        { operator-id: operator-id, public-key: public-key, endpoint: endpoint, last-seen: stacks-block-height })
            (ok tx-sender))
        error-code ERR_FEE_TRANSFER_FAILED)))

(define-read-only (get-operator (owner principal))
  (map-get? operators { owner: owner }))

(define-public (withdraw (recipient principal) (amount uint))
  (if (is-eq tx-sender OWNER)
      (stx-transfer? amount tx-sender recipient)
      (err u100)))

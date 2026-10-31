;; OSSR v1 sponsored-transfer adapter for Stacks mainnet.
;; The token principal is the canonical mainnet sBTC contract.

(define-constant SBTC_TOKEN 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant MAX_TRANSFER_SATS u10000000)
(define-constant MAX_SPONSOR_FEE_SATS u1000)

(define-constant ERR_SPONSOR_REQUIRED (err u100))
(define-constant ERR_QUOTE_EXPIRED (err u101))
(define-constant ERR_AMOUNT_ZERO (err u102))
(define-constant ERR_AMOUNT_TOO_HIGH (err u103))
(define-constant ERR_SPONSOR_FEE_ZERO (err u104))
(define-constant ERR_SPONSOR_FEE_TOO_HIGH (err u105))
(define-constant ERR_RECIPIENT_IS_ORIGIN (err u106))
(define-constant ERR_SPONSOR_IS_ORIGIN (err u107))
(define-constant ERR_FEE_TRANSFER_FAILED (err u109))
(define-constant ERR_RECIPIENT_TRANSFER_FAILED (err u110))

(define-public
  (sponsored-transfer
    (amount uint)
    (recipient principal)
    (sponsor-fee uint)
    (quote-id (buff 32))
    (expiry-height uint)
    (memo (optional (buff 34))))
  (let ((sponsor (unwrap! tx-sponsor? ERR_SPONSOR_REQUIRED)))
    (begin
      (asserts! (<= stacks-block-height expiry-height) ERR_QUOTE_EXPIRED)
      (asserts! (> amount u0) ERR_AMOUNT_ZERO)
      (asserts! (<= amount MAX_TRANSFER_SATS) ERR_AMOUNT_TOO_HIGH)
      (asserts! (> sponsor-fee u0) ERR_SPONSOR_FEE_ZERO)
      (asserts! (<= sponsor-fee MAX_SPONSOR_FEE_SATS) ERR_SPONSOR_FEE_TOO_HIGH)
      (asserts! (not (is-eq recipient tx-sender)) ERR_RECIPIENT_IS_ORIGIN)
      (asserts! (not (is-eq sponsor tx-sender)) ERR_SPONSOR_IS_ORIGIN)
      (unwrap!
        (contract-call? SBTC_TOKEN transfer sponsor-fee tx-sender sponsor none)
        ERR_FEE_TRANSFER_FAILED)
      (unwrap!
        (contract-call? SBTC_TOKEN transfer amount tx-sender recipient memo)
        ERR_RECIPIENT_TRANSFER_FAILED)
      (print {
        event: "ossr-sponsored-transfer",
        version: "1",
        quote-id: quote-id,
        origin: tx-sender,
        sponsor: sponsor,
        recipient: recipient,
        amount: amount,
        sponsor-fee: sponsor-fee,
        expiry-height: expiry-height
      })
      (ok true))))

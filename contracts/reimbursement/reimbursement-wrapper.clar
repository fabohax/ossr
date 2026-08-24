;; Reimbursement wrapper contract
;;
;; Purpose:
;; - Execute a target contract's `execute` entrypoint (user action)
;; - After successful execution, atomically transfer sBTC from this contract's escrow
;;   to an operator principal and a protocol principal.
;;
;; NOTE: Before deploying, set `sbtc-token` to the deployed sBTC contract principal.

(define-constant sbtc-token 'SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token)

;; process-and-reimburse
;; Parameters:
;; - target-contract: the contract principal to call for the original action (must expose 'execute)
;; - operator: principal receiving operator reimbursement
;; - protocol: principal receiving protocol fee
;; - operator-amount: amount (uint) of sBTC to send to operator
;; - protocol-amount: amount (uint) of sBTC to send to protocol
;; - payload: opaque payload buffer forwarded to target-contract's `execute` entrypoint
(define-public (process-and-reimburse (target-contract principal)
                                     (operator principal)
                                     (protocol principal)
                                     (operator-amount uint)
                                     (protocol-amount uint)
                                     (payload (buff 1024)))
  (begin
    ;; Call the target contract's `execute` entrypoint. The target contract must
    ;; implement (define-public (execute (payload (buff 1024))) ...).
    (let ((action-res (contract-call? target-contract 'execute payload)))
      (if (is-ok action-res)
          (let ((op-res   (contract-call? sbtc-token 'transfer operator operator-amount))
                (prot-res (contract-call? sbtc-token 'transfer protocol protocol-amount)))
            ;; Require both token transfers to succeed; otherwise fail the whole tx.
            (if (and (is-ok op-res) (is-ok prot-res))
                (ok action-res)
                (err u1)))
          (err u2)))))

;; Read-only helper to expose configured token contract (deployment convenience)
(define-read-only (get-sbtc-token)
  sbtc-token)

;; Simple example withdraw helper (deployer must edit OWNER constant to lock access)
(define-constant OWNER 'ST2SY3PZHMVQMYN1W4SBJ9MPHW4P8J01ST7TVQ68X.owner) ;; replace with deployer principal
(define-public (withdraw (recipient principal) (amount uint))
  (if (is-eq tx-sender OWNER)
      (contract-call? sbtc-token 'transfer recipient amount)
      (err u100)))

# OSSR MVP 0.1 — 15-Day Roadmap

**Goal:** have a working Stacks testnet prototype that demonstrates real fee sponsorship, operator selection, reimbursement in sBTC, basic failure handling, and a simple UI suitable for the Stacks Endowment application.

### MVP 0.1 success criteria

By Day 15:

> A user can submit a Stacks transaction without holding STX, an OSSR operator pays the STX transaction fee, the transaction is confirmed, and the operator receives an sBTC reimbursement.

Keep the MVP deliberately narrow: **1 network, 1 operator initially, 1 transaction type, testnet, no production custody.**

---

## Phase 1 — Core sponsorship

### Day 1 — Architecture + transaction flow

Define the exact protocol flow.

```text
User
 │
 │ unsigned transaction
 ▼
OSSR API
 │
 │ find operator
 ▼
Operator
 │
 │ sponsor + broadcast
 ▼
Stacks Testnet
 │
 │ confirmation
 ▼
Reimbursement
 │
 ▼
Operator
```

Deliver:

* `ARCHITECTURE.md`
* protocol sequence diagram
* transaction lifecycle
* failure states
* MVP scope frozen

**Important decision:** use a simple API/relay architecture rather than trying to decentralize everything immediately.

---

### Day 2 — Stacks sponsored transaction PoC

Implement the lowest-level transaction flow.

Test:

1. User constructs transaction.
2. User signs transaction.
3. Operator adds sponsorship.
4. Operator signs.
5. Broadcast to Stacks testnet.
6. Confirm transaction.

**Deliverable:** CLI/script successfully broadcasts one sponsored transaction.

This is the most important technical milestone.

---

### Day 3 — Operator wallet

Create the operator component.

```text
operator/
├── wallet
├── balance
├── sponsor()
├── broadcast()
└── health()
```

Implement:

* operator STX balance check
* transaction sponsorship
* broadcast
* transaction status
* basic logging

No operator registry yet.

**Deliverable:** one functioning OSSR operator.

---

### Day 4 — User transaction API

Create the OSSR relay API.

Example:

```http
POST /v1/sponsor
```

Input:

```json
{
  "transaction": "...",
  "user": "SP..."
}
```

Response:

```json
{
  "status": "accepted",
  "operator": "...",
  "transaction_id": "..."
}
```

Implement:

* transaction validation
* user/origin validation
* fee estimation
* operator availability
* sponsorship request

---

### Day 5 — End-to-end test

Connect everything.

```text
Frontend/CLI
     ↓
OSSR API
     ↓
Operator
     ↓
Stacks Testnet
```

Test with multiple transactions.

Record:

* fee
* confirmation time
* operator
* transaction ID
* failure cases

**Milestone 1:**

> OSSR can sponsor a real Stacks testnet transaction.

---

# Phase 2 — Reimbursement

### Day 6 — sBTC reimbursement design

Define the reimbursement mechanism.

For MVP:

```text
User
 │
 │ sponsorship request
 ▼
Operator
 │
 │ pays STX
 ▼
Stacks
 │
 │ transaction confirmed
 ▼
User
 │
 │ sBTC reimbursement
 ▼
Operator
```

Determine:

* reimbursement amount
* fee markup/protocol fee
* minimum reimbursement
* confirmation requirement
* reimbursement transaction format

Avoid complicated escrow at this stage.

**Design delivered:** [sBTC reimbursement](../specs/reimbursement.md) defines
the atomic settlement format, pricing policy, and confirmation rule used by
the MVP.

---

### Day 7 — Implement reimbursement

Implement the actual testnet sBTC payment.

After successful sponsorship:

```text
transaction confirmed
        ↓
calculate reimbursement
        ↓
create sBTC transfer
        ↓
operator receives sats
```

Store:

```text
sponsorship_id
stacks_tx_id
operator
fee_paid
reimbursement_amount
reimbursement_tx_id
status
```

**Deliverable:** complete economic loop.

---

### Day 8 — Transaction state machine

Implement explicit states:

```text
REQUESTED
   ↓
ACCEPTED
   ↓
SPONSORED
   ↓
BROADCAST
   ↓
CONFIRMED
   ↓
REIMBURSED
```

Failure states:

```text
REJECTED
OPERATOR_UNAVAILABLE
INSUFFICIENT_STX
BROADCAST_FAILED
CONFIRMATION_TIMEOUT
REIMBURSEMENT_FAILED
```

This becomes important for demonstrating that OSSR isn't simply a centralized "gas station."

---

# Phase 3 — Operator infrastructure

### Day 9 — Operator registry

Create a minimal registry.

For MVP, this can initially be centralized/off-chain.

Store:

```text
operator_id
public_key
endpoint
status
STX balance
supported_transaction_types
reimbursement_address
last_seen
```

Example:

```text
Operator #001
Status: ONLINE
STX: 42.8
sBTC: 0.0021
Fee: 10 bps
```

Design the interface so it can later become an on-chain registry.

---

### Day 10 — Operator selection

Implement basic selection.

For MVP:

```text
eligible operators
        ↓
filter healthy
        ↓
filter sufficient STX
        ↓
select operator
```

You can use randomized selection among eligible operators.

Later:

* reputation
* liquidity
* pricing
* latency
* batching capacity

**Deliverable:** OSSR no longer depends architecturally on one hardcoded operator.

---

### Day 11 — Failure handling + health

Implement:

```text
Operator A
   ↓
insufficient STX
   ↓
reject
   ↓
Operator B
   ↓
sponsor
```

Add heartbeat:

```text
POST /operator/heartbeat
```

Track:

* last heartbeat
* STX balance
* recent successful transactions
* failure rate

Automatically mark unhealthy operators.

This directly addresses one of the important OSSR design problems you identified earlier: **what happens when an operator cannot proceed?**

---

# Phase 4 — MVP interface

### Day 12 — User dashboard

Build the simplest useful UI.

Screens:

**1. Connect wallet**

**2. Create transaction**

**3. Sponsorship**

```text
Transaction fee
0.002 STX

Sponsored by
OSSR Operator #001

Reimbursement
1.5 sats

[ Sponsor Transaction ]
```

**4. Result**

```text
✓ Transaction confirmed

Operator:
#001

STX fee:
0.002

Reimbursement:
1.5 sats

[View on Explorer]
```

Don't build a giant dashboard.

---

### Day 13 — Operator dashboard

Simple operator view:

```text
OSSR Operator

Status       ONLINE
STX Balance  42.8
sBTC Balance 0.0021

Transactions
────────────────────
23 sponsored
21 successful
2 failed

Estimated earnings
0.000012 BTC
```

Controls:

```text
[Go Offline]
[Update Fee]
[Withdraw]
```

The UI exists primarily to demonstrate the operator economics.

---

# Phase 5 — Grant-ready prototype

### Day 14 — Testing + polish

Run the complete flow repeatedly.

Test:

* normal transaction
* insufficient operator STX
* unavailable operator
* failed broadcast
* duplicate request
* invalid transaction
* reimbursement failure
* operator timeout

Measure:

```text
Success rate
Average sponsorship latency
Average confirmation time
Average operator cost
Average reimbursement
```

Fix the most visible issues.

---

### Day 15 — Demo + documentation

Prepare the actual grant demonstration.

The demo should take **3–5 minutes**:

### Step 1

User has **no STX**.

### Step 2

User creates a Stacks transaction.

### Step 3

OSSR finds an operator.

### Step 4

Operator pays the STX fee.

### Step 5

Transaction confirms.

### Step 6

Operator receives sBTC reimbursement.

### Step 7

Show both transactions in the explorer.

Then show:

```text
OSSR
Open Stacks Sponsor Relay

User → Transaction
          ↓
       Operator
          ↓
     STX payment
          ↓
       Stacks
          ↓
     sBTC repayment
```

---

# MVP 0.1 architecture

I would keep the initial repository approximately like this:

```text
ossr/
│
├── apps/
│   ├── web/
│   └── operator/
│
├── packages/
│   ├── protocol/
│   ├── stacks/
│   ├── sbtc/
│   └── types/
│
├── contracts/
│   └── registry/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PROTOCOL.md
│   └── DEMO.md
│
└── README.md
```

The **registry contract can remain minimal or even be postponed** if implementing it would delay the core demo.

---

# What NOT to build in 0.1

Do **not** spend the 15 days building:

* decentralized governance
* sophisticated reputation
* complex operator auctions
* production custody
* mainnet deployment
* advanced batching
* cross-chain sponsorship
* DAO
* tokenomics
* mobile app
* sophisticated analytics
* permissionless operator economics

Those are **0.2+**.

The grant reviewer should see one thing working extremely clearly:

> **A Stacks user can transact without holding STX because an independent OSSR operator pays the fee and is reimbursed in sBTC.**

---

## Milestones

| Day | Milestone              | Importance   |
| --: | ---------------------- | ------------ |
|   1 | Architecture           | Foundation   |
|   2 | Sponsored TX PoC       | **Critical** |
|   3 | Operator               | **Critical** |
|   4 | API                    | Critical     |
|   5 | End-to-end sponsorship | **Major**    |
|   6 | Reimbursement design   | Major        |
|   7 | sBTC reimbursement     | **Critical** |
|   8 | State machine          | Major        |
|   9 | Operator registry      | Major        |
|  10 | Operator selection     | Major        |
|  11 | Failure/health         | Major        |
|  12 | User UI                | Major        |
|  13 | Operator UI            | Medium       |
|  14 | Testing                | **Critical** |
|  15 | Demo + grant package   | **Critical** |

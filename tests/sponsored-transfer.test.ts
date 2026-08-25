import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const user = accounts.get("wallet_1")!;
const recipient = accounts.get("wallet_2")!;
const sponsor = accounts.get("wallet_3")!;

const MAX_TRANSFER_SATS = 10_000_000;
const MAX_SPONSOR_FEE_SATS = 1_000;

function mint(amount: number, owner: string) {
  const receipt = simnet.callPublicFn(
    "mock-sbtc-token",
    "mint",
    [Cl.uint(amount), Cl.principal(owner)],
    deployer,
  );
  expect(receipt.result).toBeOk(Cl.bool(true));
}

function balance(owner: string) {
  const receipt = simnet.callReadOnlyFn(
    "mock-sbtc-token",
    "get-balance",
    [Cl.principal(owner)],
    deployer,
  );
  return receipt.result;
}

function sponsoredTransferForTest({
  amount = 100,
  transferRecipient = recipient,
  transferSponsor = sponsor,
  sponsorFee = 10,
  expiryHeight = simnet.blockHeight + 10,
  sender = user,
}: {
  amount?: number;
  transferRecipient?: string;
  transferSponsor?: string;
  sponsorFee?: number;
  expiryHeight?: number;
  sender?: string;
} = {}) {
  return simnet.callPublicFn(
    "sbtc-sponsored-transfer-v1",
    "sponsored-transfer-for-test",
    [
      Cl.uint(amount),
      Cl.principal(transferRecipient),
      Cl.principal(transferSponsor),
      Cl.uint(sponsorFee),
      Cl.buffer(new Uint8Array(32).fill(1)),
      Cl.uint(expiryHeight),
      Cl.some(Cl.buffer(new Uint8Array([1, 2, 3]))),
    ],
    sender,
  );
}

describe("sbtc-sponsored-transfer-v1", () => {
  it("atomically transfers sBTC to the recipient and reimburses the sponsor", () => {
    mint(1_000, user);

    const receipt = sponsoredTransferForTest();

    expect(receipt.result).toBeOk(Cl.bool(true));
    expect(balance(user)).toBeOk(Cl.uint(890));
    expect(balance(recipient)).toBeOk(Cl.uint(100));
    expect(balance(sponsor)).toBeOk(Cl.uint(10));
  });

  it("requires a sponsor", () => {
    mint(100, user);

    const receipt = simnet.callPublicFn(
      "sbtc-sponsored-transfer-v1",
      "sponsored-transfer",
      [
        Cl.uint(10),
        Cl.principal(recipient),
        Cl.uint(1),
        Cl.buffer(new Uint8Array(32)),
        Cl.uint(simnet.blockHeight + 10),
        Cl.none(),
      ],
      user,
    );

    expect(receipt.result).toBeErr(Cl.uint(100));
  });

  it("rejects expired quotes", () => {
    mint(1_000, user);

    const receipt = sponsoredTransferForTest({
      expiryHeight: simnet.blockHeight - 1,
    });

    expect(receipt.result).toBeErr(Cl.uint(101));
    expect(balance(user)).toBeOk(Cl.uint(1_000));
    expect(balance(recipient)).toBeOk(Cl.uint(0));
    expect(balance(sponsor)).toBeOk(Cl.uint(0));
  });

  it("rejects zero and too-large transfer amounts", () => {
    mint(MAX_TRANSFER_SATS + 100, user);

    expect(sponsoredTransferForTest({ amount: 0 }).result).toBeErr(
      Cl.uint(102),
    );
    expect(
      sponsoredTransferForTest({ amount: MAX_TRANSFER_SATS + 1 }).result,
    ).toBeErr(Cl.uint(103));
  });

  it("rejects zero and too-large sponsor fees", () => {
    mint(10_000, user);

    expect(sponsoredTransferForTest({ sponsorFee: 0 }).result).toBeErr(
      Cl.uint(104),
    );
    expect(
      sponsoredTransferForTest({ sponsorFee: MAX_SPONSOR_FEE_SATS + 1 })
        .result,
    ).toBeErr(Cl.uint(105));
  });

  it("rejects recipient or sponsor equal to the origin", () => {
    mint(1_000, user);

    expect(
      sponsoredTransferForTest({ transferRecipient: user }).result,
    ).toBeErr(Cl.uint(106));
    expect(sponsoredTransferForTest({ transferSponsor: user }).result).toBeErr(
      Cl.uint(107),
    );
  });

  it("reverts both transfers when the user cannot pay the full amount plus fee", () => {
    mint(105, user);
    const userBalance = balance(user);
    const recipientBalance = balance(recipient);
    const sponsorBalance = balance(sponsor);

    const receipt = sponsoredTransferForTest({
      amount: 100,
      sponsorFee: 10,
    });

    expect(receipt.result).toBeErr(Cl.uint(110));
    expect(balance(user)).toStrictEqual(userBalance);
    expect(balance(recipient)).toStrictEqual(recipientBalance);
    expect(balance(sponsor)).toStrictEqual(sponsorBalance);
  });
});

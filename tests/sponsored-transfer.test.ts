import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const user = accounts.get("wallet_1")!;
const recipient = accounts.get("wallet_2")!;
const sponsor = accounts.get("wallet_3")!;

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

describe("sbtc-sponsored-transfer-v1", () => {
  it("atomically transfers sBTC to the recipient and reimburses the sponsor", () => {
    mint(1_000, user);

    const receipt = simnet.callPublicFn(
      "sbtc-sponsored-transfer-v1",
      "sponsored-transfer-for-test",
      [
        Cl.uint(100),
        Cl.principal(recipient),
        Cl.principal(sponsor),
        Cl.uint(10),
        Cl.buffer(new Uint8Array(32).fill(1)),
        Cl.uint(simnet.blockHeight + 10),
        Cl.some(Cl.buffer(new Uint8Array([1, 2, 3]))),
      ],
      user,
    );

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
});

import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const operator = accounts.get("wallet_1")!;

describe("operators-registry", () => {
  it("registers an operator and stores its metadata", () => {
    const publicKey = new Uint8Array(33);
    publicKey[0] = 2;

    const receipt = simnet.callPublicFn(
      "operators-registry",
      "register",
      [
        Cl.stringAscii("operator-001"),
        Cl.buffer(publicKey),
        Cl.stringAscii("https://relay.example/v1"),
      ],
      operator,
    );

    expect(receipt.result).toBeOk(Cl.principal(operator));

    const registration = simnet.callReadOnlyFn(
      "operators-registry",
      "get-operator",
      [Cl.principal(operator)],
      deployer,
    );

    expect(registration.result).toBeSome(
      Cl.tuple({
        "operator-id": Cl.stringAscii("operator-001"),
        "public-key": Cl.buffer(publicKey),
        endpoint: Cl.stringAscii("https://relay.example/v1"),
        "last-seen": Cl.uint(simnet.blockHeight),
      }),
    );
  });

  it("only lets the owner withdraw contract STX", () => {
    const rejected = simnet.callPublicFn(
      "operators-registry",
      "withdraw",
      [Cl.principal(operator), Cl.uint(1)],
      operator,
    );

    expect(rejected.result).toBeErr(Cl.uint(100));
  });
});

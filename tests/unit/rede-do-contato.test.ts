import { describe, expect, it } from "vitest";

import { redeDoContato } from "@/lib/leads/nascimento-do-lead";

describe("redeDoContato — de onde o card veio", () => {
  it("âncora ig. é Instagram", () => {
    expect(redeDoContato({ wa_identity: "lid:ig.1727274415048488" })).toBe("Instagram");
  });
  it("LID do WhatsApp, telefone ou nada é WhatsApp", () => {
    expect(redeDoContato({ wa_identity: "lid:123456789" })).toBe("WhatsApp");
    expect(redeDoContato({ wa_identity: "phone:+5581999999999" })).toBe("WhatsApp");
    expect(redeDoContato(null)).toBe("WhatsApp");
  });
});

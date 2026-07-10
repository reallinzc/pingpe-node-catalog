import { describe, expect, it } from "vitest";
import {
  buildCuratedTargets,
  countryCodeFromId,
  regionFromId,
  sanitizePingerMap,
  sha256Hex,
} from "../src/catalog";
import { decodeBase64Utf8, encodeBase64Utf8 } from "../src/github";

describe("Ping.pe catalog normalization", () => {
  it("keeps only public allowlisted fields", () => {
    const nodes = sanitizePingerMap({
      ZA_110: {
        ip: "143.14.90.47",
        location: "South Africa, Johannesburg",
        provider: "EdgeNext",
        short_location: "ZA Jnb",
        short_provider: "EdgNxt",
        is_public: true,
        pinger_secret: "must-not-leak",
        port: 9900,
      },
    });

    expect(nodes).toEqual([
      {
        id: "ZA_110",
        ip: "143.14.90.47",
        location: "South Africa, Johannesburg",
        provider: "EdgeNext",
        short_location: "ZA Jnb",
        short_provider: "EdgNxt",
        country_code: "ZA",
        region: "africa",
      },
    ]);
    expect(JSON.stringify(nodes)).not.toContain("secret");
    expect(JSON.stringify(nodes)).not.toContain("9900");
  });

  it("maps regional IDs deterministically", () => {
    expect(countryCodeFromId("EU_DE_4")).toBe("DE");
    expect(regionFromId("EU_DE_4")).toBe("europe");
    expect(regionFromId("AU_110")).toBe("oceania");
    expect(regionFromId("UAE_3")).toBe("middle-east");
  });

  it("resolves stable curated IDs to current IPs", () => {
    const nodes = sanitizePingerMap({
      AU_110: {
        ip: "45.76.118.224",
        location: "Australia, Sydney",
        provider: "Vultr",
        is_public: true,
      },
    });
    const result = buildCuratedTargets(nodes, {
      schema_version: 1,
      description: "test",
      targets: [
        { id: "AU_110", label: "PingPE-AU-Sydney-Vultr", reason: "anchor" },
        { id: "MISSING_1", label: "missing", reason: "test" },
      ],
    });

    expect(result.targets[0]?.ip).toBe("45.76.118.224");
    expect(result.missing).toEqual(["MISSING_1"]);
  });
});

describe("serialization", () => {
  it("round-trips UTF-8 through GitHub base64", () => {
    const value = JSON.stringify({ location: "中国, 上海", provider: "测试" });
    expect(decodeBase64Utf8(encodeBase64Utf8(value))).toBe(value);
  });

  it("produces stable SHA-256 hashes", async () => {
    expect(await sha256Hex("ping.pe")).toBe(
      "a71fa5a1b0d283c6fa939b9285e2fa548cbf799ddf2747c6f169c400e6669f08",
    );
  });
});

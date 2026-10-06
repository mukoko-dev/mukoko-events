import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientAddress, isCloudflare, parseIp } from "./client-address";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("isCloudflare", () => {
  it("matches Cloudflare's published ranges only", () => {
    expect(isCloudflare("172.70.1.2")).toBe(true);
    expect(isCloudflare("2606:4700:10::ac43:1")).toBe(true);
    expect(isCloudflare("203.0.113.7")).toBe(false);
    expect(isCloudflare("not-an-ip")).toBe(false);
    expect(parseIp("::ffff:172.70.1.2")?.v6).toBe(false);
  });
});

describe("clientAddress", () => {
  it("behind Cloudflare, uses the visitor's address and Cloudflare's city", () => {
    expect(
      clientAddress(
        headers({
          "x-real-ip": "172.70.1.2",
          "cf-connecting-ip": "203.0.113.7",
          "cf-ipcity": "Harare",
          "x-vercel-ip-city": "Ashburn",
        }),
      ),
    ).toEqual({ address: "203.0.113.7", city: "Harare" });
  });

  it("never sends the edge's city as the viewer's", () => {
    expect(
      clientAddress(
        headers({
          "x-real-ip": "172.70.1.2",
          "cf-connecting-ip": "203.0.113.7",
          "x-vercel-ip-city": "Ashburn",
        }),
      ),
    ).toEqual({ address: "203.0.113.7", city: undefined });
  });

  it("ignores a forged cf-connecting-ip sent straight to the origin", () => {
    expect(
      clientAddress(
        headers({
          "x-real-ip": "198.51.100.9",
          "cf-connecting-ip": "203.0.113.7",
          "x-vercel-ip-city": "Bulawayo",
        }),
      ),
    ).toEqual({ address: "198.51.100.9", city: "Bulawayo" });
  });

  it("never uses the caller-supplied first x-forwarded-for entry", () => {
    expect(
      clientAddress(headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" }))
        .address,
    ).toBe("198.51.100.9");
  });
});

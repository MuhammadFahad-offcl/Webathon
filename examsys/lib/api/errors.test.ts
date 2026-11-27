import { describe, expect, it } from "vitest";
import { readJson } from "./errors";

describe("readJson", () => {
  it("parses a body within the configured byte limit", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ value: "ok" }),
    });

    await expect(readJson(request, { maxBytes: 32 })).resolves.toEqual({ value: "ok" });
  });

  it("rejects a body that exceeds the limit while streaming", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ value: "too large" }),
    });

    await expect(readJson(request, { maxBytes: 4 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Request body exceeds the allowed size",
    });
  });

  it("rejects an oversized declared content length without reading the body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "{}",
    });

    await expect(readJson(request, { maxBytes: 4 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Request body exceeds the allowed size",
    });
  });

  it("returns an explicit empty-body value for endpoints that allow it", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "" });

    await expect(readJson(request, { maxBytes: 4, emptyBody: {} })).resolves.toEqual({});
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "{" });

    await expect(readJson(request)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Request body must be valid JSON",
    });
  });
});

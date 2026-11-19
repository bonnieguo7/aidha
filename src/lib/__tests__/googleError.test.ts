import { describeGoogleError } from "../../../supabase/functions/_shared/googleError";

describe("describeGoogleError", () => {
  it("joins the source, status and message", () => {
    expect(describeGoogleError("Directions (walking)", { status: "REQUEST_DENIED", message: "API not enabled" })).toBe(
      "Directions (walking): REQUEST_DENIED: API not enabled"
    );
  });

  it("leaves out missing parts", () => {
    expect(describeGoogleError("Directions (driving) HTTP 500", {})).toBe("Directions (driving) HTTP 500");
    expect(describeGoogleError("Geocoding", { status: "REQUEST_DENIED" })).toBe("Geocoding: REQUEST_DENIED");
  });

  it("scrubs anything shaped like a Google API key", () => {
    const text = describeGoogleError("Geocoding", { message: "bad key AIzaSyA1234567890abcdefghijklmnopqrstuv here" });
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("AIza");
  });

  it("caps very long messages", () => {
    expect(describeGoogleError("x", { message: "a".repeat(1000) }).length).toBeLessThan(260);
  });

  it("ignores non-string values", () => {
    expect(describeGoogleError("x", { status: 403, message: { nested: true } })).toBe("x");
  });
});

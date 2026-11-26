import { notesPreview } from "../notes";

describe("notesPreview", () => {
  it("joins a one-item-per-line list into one line", () => {
    expect(notesPreview("Bathing suit\nSunscreen\nCharger")).toBe("Bathing suit, Sunscreen, Charger");
  });

  it("drops list markers and blank lines", () => {
    expect(notesPreview("- Bathing suit\n\n* Sunscreen\n• Hat\n1. Passport\n2) Charger\n   ")).toBe(
      "Bathing suit, Sunscreen, Hat, Passport, Charger"
    );
  });

  it("handles Windows line endings and stray spaces", () => {
    expect(notesPreview("  Bathing suit  \r\n  Sunscreen ")).toBe("Bathing suit, Sunscreen");
  });

  it("keeps free-form text as it is", () => {
    expect(notesPreview("Door code is 4321")).toBe("Door code is 4321");
  });

  it("cuts long notes off with an ellipsis at 100 characters", () => {
    const preview = notesPreview("x".repeat(300))!;
    expect(preview).toHaveLength(100);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("is null when there's nothing to show", () => {
    expect(notesPreview(null)).toBeNull();
    expect(notesPreview(undefined)).toBeNull();
    expect(notesPreview("")).toBeNull();
    expect(notesPreview(" \n - \n")).toBeNull();
  });
});

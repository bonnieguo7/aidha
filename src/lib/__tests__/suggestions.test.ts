import { resolveTopic, sanitizeSuggestions } from "../../../supabase/functions/_shared/suggestions";

describe("sanitizeSuggestions", () => {
  it("passes through a clean list unchanged", () => {
    expect(sanitizeSuggestions(["Today at 6pm", "Tomorrow at 9am", "No deadline"])).toEqual([
      "Today at 6pm",
      "Tomorrow at 9am",
      "No deadline",
    ]);
  });

  it("returns an empty list for anything that isn't an array", () => {
    expect(sanitizeSuggestions(undefined)).toEqual([]);
    expect(sanitizeSuggestions(null)).toEqual([]);
    expect(sanitizeSuggestions("Low, Normal, High")).toEqual([]);
    expect(sanitizeSuggestions({ 0: "Low" })).toEqual([]);
  });

  it("drops non-strings, blanks and over-long labels", () => {
    const tooLong = "x".repeat(41);
    expect(sanitizeSuggestions(["Low", 3, null, "   ", "", tooLong, "High"])).toEqual(["Low", "High"]);
  });

  it("trims whitespace", () => {
    expect(sanitizeSuggestions(["  Normal  "])).toEqual(["Normal"]);
  });

  it("removes case-insensitive duplicates, keeping the first", () => {
    expect(sanitizeSuggestions(["Tomorrow", "tomorrow", "TOMORROW", "Today"])).toEqual(["Tomorrow", "Today"]);
  });

  it("caps the list at four", () => {
    expect(sanitizeSuggestions(["a", "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a label that is exactly the maximum length", () => {
    const exact = "x".repeat(40);
    expect(sanitizeSuggestions([exact])).toEqual([exact]);
  });

  it("drops options that ask for more detail instead of answering", () => {
    expect(
      sanitizeSuggestions(["ASAP", "No deadline", "By a specific date", "Other", "Custom time", "Pick a time", "Something else"])
    ).toEqual(["ASAP", "No deadline"]);
  });

  it("keeps real answers that merely contain similar words", () => {
    expect(sanitizeSuggestions(["Pick up after work", "Today at 6pm"])).toEqual([
      "Pick up after work",
      "Today at 6pm",
    ]);
  });

  it("drops vague windows that can't be turned into a reminder time", () => {
    expect(
      sanitizeSuggestions(["This weekend", "Next week", "This month", "Later", "Soon", "Saturday at 10am", "Tomorrow at 9am"])
    ).toEqual(["Saturday at 10am", "Tomorrow at 9am"]);
  });
});

describe("resolveTopic", () => {
  it("treats any question starting with Where as a location question", () => {
    expect(resolveTopic("Where do you need to catch the bus?", "other")).toBe("location");
    expect(resolveTopic("  where is your class?", "time")).toBe("location");
  });

  it("keeps the model's topic otherwise", () => {
    expect(resolveTopic("What time does your train leave?", "time")).toBe("time");
    expect(resolveTopic("How high priority is this?", "priority")).toBe("priority");
  });

  it("does not trigger on 'where' mid-sentence or as part of another word", () => {
    expect(resolveTopic("What time is it, and where is nowhere?", "time")).toBe("time");
    expect(resolveTopic("Wherever you like - what time?", "time")).toBe("time");
  });
});

import { pushTargetForBundle } from "../pushTarget";

describe("pushTargetForBundle", () => {
  it("sends the dev build to the APNs sandbox and the TestFlight build to production", () => {
    expect(pushTargetForBundle("com.bonnieguo7.taskassistant.dev")).toEqual({
      bundle_id: "com.bonnieguo7.taskassistant.dev",
      apns_environment: "sandbox",
    });
    expect(pushTargetForBundle("com.bonnieguo7.taskassistant")).toEqual({
      bundle_id: "com.bonnieguo7.taskassistant",
      apns_environment: "production",
    });
  });
});

import { describe, it, expect } from "vitest";
import { statusToKanban, kanbanToStatus } from "../parsers/task-markdown";

describe("statusToKanban", () => {
  const cases: [string, string][] = [
    ["queued", "backlog"],
    ["ready", "backlog"],
    ["submitted", "in_progress"],
    ["running", "in_progress"],
    ["blocked", "in_progress"],
    ["waiting-user", "review"],
    ["done", "done"],
    ["cancelled", "done"],
    ["archived", "done"],
  ];

  for (const [status, expected] of cases) {
    it(`maps "${status}" → "${expected}"`, () => {
      expect(statusToKanban(status)).toBe(expected);
    });
  }

  it("falls back to backlog for unknown statuses", () => {
    expect(statusToKanban("unknown")).toBe("backlog");
    expect(statusToKanban("not started")).toBe("backlog");
  });
});

describe("kanbanToStatus", () => {
  const cases: [string, string][] = [
    ["backlog", "queued"],
    ["in_progress", "running"],
    ["review", "waiting-user"],
    ["done", "done"],
  ];

  for (const [column, expected] of cases) {
    it(`maps "${column}" → "${expected}"`, () => {
      expect(kanbanToStatus(column)).toBe(expected);
    });
  }

  it("falls back to queued for unknown columns", () => {
    expect(kanbanToStatus("unknown")).toBe("queued");
  });
});

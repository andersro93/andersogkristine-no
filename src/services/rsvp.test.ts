import { describe, expect, test } from "bun:test";
import type { Invite } from "./notion";
import { isRsvpClosed, validateRsvpPayload } from "./rsvp";

const invite: Invite = {
  id: "invite-1",
  code: "test-kode",
  name: "Familien Test",
  guests: [
    { id: "guest-a", name: "A", rsvp: "Venter", allergies: [] },
    { id: "guest-b", name: "B", rsvp: "Venter", allergies: [] },
  ],
};

describe("isRsvpClosed", () => {
  test("is open before the deadline", () => {
    expect(isRsvpClosed(new Date("2026-08-20T12:00:00+02:00"))).toBe(false);
  });

  test("stays open through the whole deadline day (Oslo time)", () => {
    expect(isRsvpClosed(new Date("2026-08-26T23:30:00+02:00"))).toBe(false);
  });

  test("is closed after the deadline day has ended", () => {
    expect(isRsvpClosed(new Date("2026-08-27T00:00:01+02:00"))).toBe(true);
    expect(isRsvpClosed(new Date("2026-09-01T10:00:00+02:00"))).toBe(true);
  });
});

describe("validateRsvpPayload", () => {
  test("accepts guests belonging to the invite with allowed values", () => {
    const res = validateRsvpPayload(invite, [
      {
        id: "guest-a",
        rsvp: "Kommer",
        allergies: ["Gluten", " Egg ", "gluten"],
      },
      { id: "guest-b", rsvp: "Kommer ikke", allergies: ["Gluten"] },
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.updates).toEqual([
        { id: "guest-a", rsvp: "Kommer", allergies: ["Gluten", "Egg"] },
        // Declined guests never carry allergies
        { id: "guest-b", rsvp: "Kommer ikke", allergies: [] },
      ]);
    }
  });

  test("rejects guest ids that do not belong to the invite", () => {
    const res = validateRsvpPayload(invite, [
      { id: "someone-else", rsvp: "Kommer" },
    ]);
    expect(res.ok).toBe(false);
  });

  test("rejects disallowed rsvp values (incl. 'Venter')", () => {
    expect(
      validateRsvpPayload(invite, [{ id: "guest-a", rsvp: "Venter" }]).ok,
    ).toBe(false);
    expect(
      validateRsvpPayload(invite, [{ id: "guest-a", rsvp: "Kanskje" }]).ok,
    ).toBe(false);
  });

  test("rejects empty, non-array and duplicate guests", () => {
    expect(validateRsvpPayload(invite, []).ok).toBe(false);
    expect(validateRsvpPayload(invite, "nope").ok).toBe(false);
    expect(
      validateRsvpPayload(invite, [
        { id: "guest-a", rsvp: "Kommer" },
        { id: "guest-a", rsvp: "Kommer ikke" },
      ]).ok,
    ).toBe(false);
  });

  test("is all-or-nothing: one bad guest rejects the whole payload", () => {
    const res = validateRsvpPayload(invite, [
      { id: "guest-a", rsvp: "Kommer" },
      { id: "guest-b", rsvp: "Nei takk" },
    ]);
    expect(res.ok).toBe(false);
  });
});

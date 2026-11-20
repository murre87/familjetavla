import { afterEach, describe, expect, it, vi } from "vitest";
import { careToday, tyraKids, tyraLogin, tyraPhone, tyraToEvent } from "./connectors/tyra.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Tyra", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes the mobile number the way Tyra's login form sends it", () => {
    expect(tyraPhone("070-123 45 67")).toBe("+46701234567");
    expect(tyraPhone("+46 70 123 45 67")).toBe("+46701234567");
    expect(tyraPhone("+46070 1234567")).toBe("+46701234567");
    expect(tyraPhone("0046701234567")).toBe("+46701234567");
    expect(tyraPhone("46701234567")).toBe("+46701234567");
    expect(() => tyraPhone("abc")).toThrow();
  });

  it("logs in with mobile number and password in two steps", async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
        if (url.endsWith("/functions/initiateLoginSession")) return json({ result: { loginSessionId: "ls1", action: "password" } });
        return json({ result: { action: "become", parseSessionId: "r:abc" } });
      }),
    );
    expect(await tyraLogin("070-123 45 67", "hemligt")).toBe("r:abc");
    expect(calls[0].body).toMatchObject({ username: "+46701234567", loginMethod: 30, clientType: "web" });
    expect(calls[0].headers["x-parse-application-id"]).toBeTruthy();
    expect(calls[1].body).toMatchObject({ loginSessionId: "ls1", password: "hemligt", clientAction: "password" });
  });

  it("says plainly when the password is wrong or Tyra wants BankID or an sms code", async () => {
    const step = (first: unknown, second: unknown = {}) =>
      vi.stubGlobal("fetch", vi.fn(async (url: string) => json({ result: url.endsWith("initiateLoginSession") ? first : second })));
    step({ loginSessionId: "ls1", action: "password" }, { retry: true });
    await expect(tyraLogin("0701234567", "fel")).rejects.toThrow(/Fel lösenord/);
    step({ loginSessionId: "ls1", action: "bankid" });
    await expect(tyraLogin("0701234567", "x")).rejects.toThrow(/BankID/);
    step({ loginSessionId: "ls1", action: "verify" });
    await expect(tyraLogin("0701234567", "x")).rejects.toThrow(/sms-kod/);
  });

  it("finds one child per guardian role and skips staff roles", async () => {
    let asked = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked = url;
        return json({
          results: [
            { objectId: "r1", kid: { objectId: "k1", kidName: "Elsa Berg" }, school_pointer: { objectId: "s1" } },
            { objectId: "r2", kid: { objectId: "k1", kidName: "Elsa Berg" }, school_pointer: { objectId: "s1" } },
            { objectId: "r3", kid: { objectId: "k2", firstName: "Leo", lastName: "Berg" }, school_pointer: { objectId: "s1" } },
            { objectId: "r4", school_pointer: { objectId: "s1" } },
          ],
        });
      }),
    );
    const kids = await tyraKids("r:abc", "u1");
    expect(kids).toEqual([
      { id: "k1", name: "Elsa Berg", roleId: "r1", schoolId: "s1" },
      { id: "k2", name: "Leo Berg", roleId: "r3", schoolId: "s1" },
    ]);
    const where = JSON.parse(new URL(asked).searchParams.get("where")!);
    expect(where).toEqual({ user: { __type: "Pointer", className: "_User", objectId: "u1" }, status: 40 });
  });

  it("turns an event with times into a timed event and one without into a whole day", () => {
    const e = tyraToEvent({ eventDate: "2026-11-24", startTime: "09:30", endTime: "11:00", topic: "Utflykt till skogen", content: "Ta med matsäck", eventTimeId: "t1" })!;
    expect(e.allDay).toBe(false);
    expect([e.start.getHours(), e.start.getMinutes(), e.end.getHours()]).toEqual([9, 30, 11]);
    expect(e.description).toBe("Ta med matsäck");
    expect(e.uid).toBe("tyra-t1");
    const closed = tyraToEvent({ eventDate: "2026-11-27", topic: "Planeringsdag – förskolan stängd" })!;
    expect(closed.allDay).toBe(true);
    expect(closed.start.getDate()).toBe(27);
    expect(closed.end.getDate()).toBe(28);
    expect(tyraToEvent({ eventDate: "2026-11-27", topic: "" })).toBeUndefined();
  });

  it("reads today's care time from the week's schedule", () => {
    // Tuesday 24 November 2026 is in ISO week 48.
    const tue = new Date(2026, 10, 24, 8);
    const row = { w_48: [["07:30", "08:00", null, null, "ledig"], ["16:00", "15:30", null, null, "ledig"], [null, null, null, null, null]] };
    expect(careToday(row, tue)).toBe("08:00 - 15:30");
    expect(careToday(row, new Date(2026, 10, 27))).toBe("Ledig");
    expect(careToday(row, new Date(2026, 10, 25))).toBeUndefined();
    expect(careToday(row, new Date(2026, 10, 28))).toBeUndefined();
    expect(careToday({ w_48: [[{ __type: "Date", iso: new Date(2026, 10, 23, 7, 15).toISOString() }], [{ __type: "Date", iso: new Date(2026, 10, 23, 16).toISOString() }]] }, new Date(2026, 10, 23))).toBe("07:15 - 16:00");
  });
});

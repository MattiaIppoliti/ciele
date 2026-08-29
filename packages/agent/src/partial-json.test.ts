import { describe, expect, it } from "vitest";
import { parsePartialJson } from "./partial-json";

/**
 * The contract that matters: never a WRONG object. A fragment either parses to
 * a prefix of the eventual value or comes back undefined, because the live
 * client keeps its last good parse either way.
 */
describe("parsePartialJson", () => {
  it("passes a complete document through", () => {
    expect(parsePartialJson('{"title":"Prezzi","rows":[["a","b"]]}')).toEqual({
      title: "Prezzi",
      rows: [["a", "b"]],
    });
  });

  it("returns undefined until there is something to show", () => {
    expect(parsePartialJson("")).toBeUndefined();
    expect(parsePartialJson("   ")).toBeUndefined();
  });

  it("closes open containers", () => {
    expect(parsePartialJson('{"title":"Prezzi"')).toEqual({ title: "Prezzi" });
    expect(parsePartialJson('{"rows":[["a"]')).toEqual({ rows: [["a"]] });
    expect(parsePartialJson('{"rows":[')).toEqual({ rows: [] });
    expect(parsePartialJson("{")).toEqual({});
  });

  it("keeps a partial string value, since a prefix is still a prefix", () => {
    expect(parsePartialJson('{"title":"Prez')).toEqual({ title: "Prez" });
    expect(parsePartialJson('{"rows":[["Piano","9')).toEqual({
      rows: [["Piano", "9"]],
    });
  });

  it("drops a partial KEY, which carries no value yet", () => {
    expect(parsePartialJson('{"title":"Prezzi","ro')).toEqual({
      title: "Prezzi",
    });
    expect(parsePartialJson('{"ti')).toEqual({});
  });

  it("drops a dangling comma, colon and key", () => {
    expect(parsePartialJson('{"title":"Prezzi",')).toEqual({ title: "Prezzi" });
    expect(parsePartialJson('{"title":"Prezzi","rows":')).toEqual({
      title: "Prezzi",
    });
    expect(parsePartialJson('{"rows":[["a"],')).toEqual({ rows: [["a"]] });
  });

  it("keeps a finished bare literal and cuts an unfinished one", () => {
    expect(parsePartialJson('{"count":12')).toEqual({ count: 12 });
    expect(parsePartialJson('{"ok":true')).toEqual({ ok: true });
    // `12.` and `tr` are not values yet, so the key goes with them.
    expect(parsePartialJson('{"count":12.')).toEqual({});
    expect(parsePartialJson('{"ok":tr')).toEqual({});
    expect(parsePartialJson('{"title":"Prezzi","count":12.')).toEqual({
      title: "Prezzi",
    });
  });

  it("survives escapes and braces inside strings", () => {
    expect(parsePartialJson('{"title":"a \\" b')).toEqual({ title: 'a " b' });
    expect(parsePartialJson('{"title":"{[,:')).toEqual({ title: "{[,:" });
    expect(parsePartialJson('{"title":"back\\\\')).toEqual({ title: "back\\" });
  });

  it("grows monotonically over a realistic token-by-token stream", () => {
    const whole = '{"title":"Piani","columns":["Piano","Prezzo"],"rows":[["Pro","29"]]}';
    const seen: unknown[] = [];
    for (let i = 1; i <= whole.length; i += 1) {
      const value = parsePartialJson(whole.slice(0, i));
      if (value !== undefined) seen.push(value);
    }
    // Every prefix parsed to an object, and the last one is the whole thing.
    expect(seen.every((value) => typeof value === "object" && value !== null)).toBe(true);
    expect(seen.at(-1)).toEqual(JSON.parse(whole));
  });
});

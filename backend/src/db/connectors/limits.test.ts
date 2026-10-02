import { describe, expect, test } from "bun:test";
import { ensureLimit } from "./index";

describe("ensureLimit", () => {
  test("appends a cap when there is none", () => {
    expect(ensureLimit("SELECT a FROM t", 100)).toBe("SELECT a FROM t\nLIMIT 100");
  });
  test("keeps the query's own trailing limit in every dialect form", () => {
    for (const sql of [
      "SELECT a FROM t LIMIT 15",
      "SELECT a FROM t LIMIT 10 OFFSET 20",
      "SELECT a FROM t LIMIT 5, 10",
      "SELECT a FROM t ORDER BY a FETCH FIRST 10 ROWS ONLY",
      "SELECT a FROM t ORDER BY a OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY",
    ]) {
      expect(ensureLimit(sql, 100)).toBe(sql);
    }
  });
  test("a LIMIT inside a subquery doesn't count", () => {
    expect(ensureLimit("SELECT * FROM (SELECT a FROM t LIMIT 5) s ORDER BY a", 100)).toEndWith("LIMIT 100");
  });
});

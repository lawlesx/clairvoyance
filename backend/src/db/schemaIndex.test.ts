import { describe, expect, test } from "bun:test";
import { buildSchemaIndex, compactTableIndex, inferForeignKeys, searchSchema, tokenise, withRelatedTables } from "./schemaIndex";
import type { TableSchema } from "./schemaReader";

const t = (name: string, cols: string[], rowCount = 100, foreignKeys: TableSchema["foreignKeys"] = []): TableSchema => ({
  name, columns: cols.map((c) => ({ name: c, type: "text" })), rowCount, sample: [], foreignKeys,
});

const tables = [
  t("customers", ["id", "name", "country", "signup_date"], 5000),
  t("orders", ["id", "customer_id", "order_date", "total_amount", "status"], 90000),
  t("order_items", ["id", "order_id", "product_id", "quantity", "unit_price"], 300000),
  t("products", ["id", "name", "category_id", "price"], 800),
  t("categories", ["id", "name"], 20),
  t("ad_campaigns", ["id", "channel", "spend", "start_date"], 300),
  t("schema_migrations", ["version"], 40),
];

describe("tokenise", () => {
  test("splits identifiers, drops stop words, stems plurals", () => {
    expect(tokenise("Which categories have the most orders?")).toEqual(["category", "order"]);
    expect(tokenise("orderItems")).toEqual(["order", "item"]);
  });
});

describe("inferForeignKeys", () => {
  test("links *_id columns to their tables when no constraints exist", () => {
    const withFks = inferForeignKeys(tables);
    const orders = withFks.find((x) => x.name === "orders")!;
    expect(orders.foreignKeys).toEqual([{ column: "customer_id", refTable: "customers", refColumn: "id", inferred: true }]);
    const products = withFks.find((x) => x.name === "products")!;
    expect(products.foreignKeys?.[0]?.refTable).toBe("categories");
  });
});

describe("searchSchema", () => {
  const index = buildSchemaIndex(inferForeignKeys(tables));

  test("matches plural/singular and ranks tables matching more terms first", () => {
    const names = searchSchema(index, "revenue by product category").map((x) => x.name);
    // products matches both terms (its name + category_id), categories matches one
    expect(names.slice(0, 2)).toEqual(["products", "categories"]);
  });

  test("returns nothing for unrelated text", () => {
    expect(searchSchema(index, "weather forecast")).toEqual([]);
  });

  test("pulls in the tables needed to join", () => {
    const seed = searchSchema(index, "order items quantity", 1);
    expect(seed.map((x) => x.name)).toEqual(["order_items"]);
    const related = withRelatedTables(index, seed, 10).map((x) => x.name);
    expect(related).toEqual(expect.arrayContaining(["order_items", "orders", "products"]));
  });
});

describe("compactTableIndex", () => {
  test("caps very large databases", () => {
    const many = Array.from({ length: 2000 }, (_, i) => t(`table_${String(i).padStart(4, "0")}`, ["id"]));
    const text = compactTableIndex(many, 100);
    expect(text).toContain("All 2000 tables");
    expect(text).toContain("1900 more");
  });
});

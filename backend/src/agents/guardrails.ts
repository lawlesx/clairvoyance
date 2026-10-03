import { Parser } from "node-sql-parser";

const parser = new Parser();

export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailError";
  }
}

export type SqlDialect = "SQLite" | "PostgresQL" | "MySQL";

const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|ATTACH|DETACH|PRAGMA)\b/i;

export function validateSQL(sql: string, allowedColumns?: Set<string>, dialect: SqlDialect = "SQLite"): string {
  const trimmed = sql.trim().replace(/;+$/, "");

  // Ignore words inside string literals (e.g. WHERE action = 'delete').
  const withoutStrings = trimmed.replace(/'(?:[^']|'')*'/g, "''");
  if (FORBIDDEN_KEYWORDS.test(withoutStrings)) {
    const match = withoutStrings.match(FORBIDDEN_KEYWORDS)!;
    throw new GuardrailError(`Forbidden SQL keyword: ${match[0].toUpperCase()}`);
  }

  let ast: any;
  try {
    ast = parser.astify(trimmed, { database: dialect });
  } catch (e: any) {
    throw new GuardrailError(`SQL parse error: ${e.message}`);
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new GuardrailError("Expected exactly one SQL statement");
  }

  const stmt = statements[0];
  if (stmt.type?.toLowerCase() !== "select") {
    throw new GuardrailError(`Only SELECT statements are allowed, got: ${stmt.type}`);
  }

  // Validate column references against known schema.
  // We only check refs whose table source can be traced to a real base table —
  // aliases produced by CTEs, subqueries, or SELECT expressions are excluded.
  if (allowedColumns && allowedColumns.size > 0) {
    const derivedNames = collectDerivedNames(stmt);
    const columnRefs = extractBaseColumnRefs(stmt, derivedNames);
    for (const col of columnRefs) {
      const lower = col.toLowerCase();
      if (lower !== "*" && !allowedColumns.has(lower)) {
        throw new GuardrailError(`Unknown column referenced: '${col}'`);
      }
    }
  }

  return trimmed;
}

/**
 * Collect all names that are derived (not real base table columns):
 * - CTE names (WITH foo AS ...)
 * - Subquery aliases (FROM (...) AS sub)
 * - Column aliases defined in SELECT expressions (SELECT x AS alias)
 */
function collectDerivedNames(node: any): Set<string> {
  const names = new Set<string>();
  if (!node || typeof node !== "object") return names;

  // CTE names: WITH cte_name AS (...)
  if (Array.isArray(node.with)) {
    for (const cte of node.with) {
      if (cte?.name?.value) names.add(cte.name.value.toLowerCase());
      else if (typeof cte?.name === "string") names.add(cte.name.toLowerCase());
      // Also recurse into the CTE body to pick up its aliases
      if (cte?.stmt) collectDerivedNamesInto(cte.stmt, names);
    }
  }

  // Subquery aliases and column aliases in FROM / SELECT
  collectDerivedNamesInto(node, names);
  return names;
}

function collectDerivedNamesInto(node: any, names: Set<string>): void {
  if (!node || typeof node !== "object") return;

  // SELECT column aliases: { type: "column_ref"|expr, as: "alias" }
  if (node.as && typeof node.as === "string") {
    names.add(node.as.toLowerCase());
  }

  // Subquery in FROM: { expr: { type: "select", ... }, as: "alias" }
  if (node.type === "select" || (node.expr && node.expr.type === "select")) {
    if (node.as) names.add(node.as.toLowerCase());
  }

  for (const val of Object.values(node)) {
    if (val && typeof val === "object") {
      collectDerivedNamesInto(val, names);
    }
  }
}

/**
 * Extract column_ref nodes, but skip any whose column name matches a derived name
 * (CTE alias, subquery alias, SELECT alias) — those are not real table columns.
 */
function extractBaseColumnRefs(node: any, derivedNames: Set<string>): string[] {
  const cols: string[] = [];
  if (!node || typeof node !== "object") return cols;

  if (node.type === "column_ref" && node.column) {
    const colName = typeof node.column === "string" ? node.column : (node.column.expr?.value ?? "");
    if (colName && !derivedNames.has(colName.toLowerCase())) {
      cols.push(colName);
    }
    // Don't descend further into this node
    return cols;
  }

  for (const val of Object.values(node)) {
    if (val && typeof val === "object") {
      cols.push(...extractBaseColumnRefs(val, derivedNames));
    }
  }
  return cols;
}

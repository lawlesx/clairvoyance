"use client";
import { useState } from "react";
import type { TableSchema } from "../../lib/api";

interface Props {
  tables: TableSchema[];
}

const T = {
  textDark:    "#2e3230",
  textMid:     "#4a4e4a",
  textMuted:   "#74796e",
  textFaint:   "#9da39a",
  surface:     "#f5f1ea",
  border:      "#e8e0d4",
  primary:     "#4a7c59",
  primaryLight:"rgba(74,124,89,0.08)",
};

// Map SQL types to short labels + color accents
function typeColor(type: string): { bg: string; text: string } {
  const t = (type || "TEXT").toUpperCase();
  if (/INT|NUM|REAL|FLOAT|DOUBLE|DECIMAL/.test(t)) return { bg: "rgba(112,92,48,0.09)", text: "#705c30" };
  if (/DATE|TIME/.test(t))                          return { bg: "rgba(74,124,89,0.09)", text: "#4a7c59" };
  if (/BOOL/.test(t))                               return { bg: "rgba(184,50,48,0.08)", text: "#b83230" };
  return { bg: "#f0ece4", text: "#74796e" }; // TEXT / other
}

export default function SchemaViewer({ tables }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tables.map((t) => [t.name, true]))
  );

  if (!tables.length) {
    return (
      <div className="text-xs px-2 py-4 text-center" style={{ color: T.textFaint }}>
        Schema not available at this time. 
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tables.map((table) => (
        <div key={table.name}>
          {/* Table header row */}
          <button
            onClick={() => setOpen((o) => ({ ...o, [table.name]: !o[table.name] }))}
            className="flex items-center justify-between w-full text-left mb-2"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: T.primary }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 6h18M3 14h18M3 18h18" />
              </svg>
              <span className="text-xs font-bold" style={{ color: T.textDark }}>{table.name}</span>
            </div>
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: T.primaryLight, color: T.primary }}>
              {table.rowCount.toLocaleString()}
            </span>
          </button>

          {/* Bubble wrap of columns */}
          {open[table.name] && (
            <div className="flex flex-wrap gap-1.5">
              {table.columns.map((col) => {
                const tc = typeColor(col.type || "TEXT");
                return (
                  <div
                    key={col.name}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1"
                    style={{
                      backgroundColor: "#ffffff",
                      border: `1px solid ${T.border}`,
                    }}
                    title={col.type || "TEXT"}
                  >
                    <span className="text-xs" style={{ color: T.textMid }}>{col.name}</span>
                    <span className="text-[10px] font-mono px-1 py-0.5 rounded-full"
                      style={{ backgroundColor: tc.bg, color: tc.text }}>
                      {(col.type || "TEXT").split("(")[0]!.substring(0, 7)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

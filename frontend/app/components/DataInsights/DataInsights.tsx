"use client";
import { useState } from "react";
import type { DataUnderstanding } from "../../lib/api";

interface Props {
  understanding: DataUnderstanding;
  fromCache: boolean;
  onQuestionClick: (q: string) => void;
  hideQuestions?: boolean;
}

const T = {
  textDark:    "#2e3230",
  textMid:     "#4a4e4a",
  textMuted:   "#74796e",
  textFaint:   "#9da39a",
  surface:     "#f5f1ea",
  surfaceHover:"#eae6de",
  border:      "#e8e0d4",
  borderSubtle:"rgba(196,200,188,0.3)",
  primary:     "#4a7c59",
  primaryLight:"rgba(74,124,89,0.1)",
  amber:       "#705c30",
};

// Dot color matches the Stitch design: high=error red, medium=primary green, low=amber
const importanceDot: Record<string, string> = {
  high:   "#b83230",
  medium: "#4a7c59",
  low:    "#705c30",
};

export default function DataInsights({ understanding, fromCache, onQuestionClick, hideQuestions }: Props) {
  const [hoveredQ, setHoveredQ] = useState<number | null>(null);

  const sorted = [...understanding.keyFeatures].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.importance] - order[b.importance];
  });

  return (
    <div className="space-y-5">
      {/* Summary */}
      <p className="text-sm leading-relaxed" style={{ color: T.textMid }}>
        {understanding.summary}
        {fromCache && (
          <span className="ml-1.5 text-xs" style={{ color: T.textFaint }}>⚡</span>
        )}
      </p>

      {/* Key Features — cards with details */}
      <div>
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-3"
          style={{ color: T.textFaint }}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
          Key Features
        </h3>
        <div className="flex flex-col gap-2.5">
          {sorted.map((f) => (
            <div
              key={f.column}
              className="rounded-xl p-3.5"
              style={{
                backgroundColor: "#ffffff",
                border: `1px solid ${T.border}`,
                boxShadow: "0 1px 3px rgba(46,50,48,0.04)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: importanceDot[f.importance] }} />
                <span className="font-bold text-sm" style={{ color: T.textDark }}>{f.label}</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: T.textMuted }}>{f.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Suggested questions */}
      {!hideQuestions && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: T.textFaint }}>
            Ideas to Explore
          </p>
          <div className="space-y-1.5">
            {understanding.suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => onQuestionClick(q)}
                className="w-full text-left text-xs px-3 py-2 rounded-xl border transition-colors"
                style={hoveredQ === i
                  ? { backgroundColor: T.primaryLight, borderColor: T.primary, color: T.primary }
                  : { backgroundColor: "#ffffff", borderColor: T.border, color: T.textMid }
                }
                onMouseEnter={() => setHoveredQ(i)}
                onMouseLeave={() => setHoveredQ(null)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

# ARCHITECTURE.md Rules

## Numbering
Sections are numbered 1–N. **Add new sections at the end; do not renumber existing ones.**

## Section 1 — System Overview
Update the Mermaid `graph TB` whenever a new route, agent, or external service is added.

## Section 9 — Visualization Selection
Flowchart must cover both `chooseVisualization()` (single pick) AND `suggestVisualizations()` (multi-chart grid). Keep both represented.

## Section 14 — Multi-Turn Chart Refinement
Update if `detectChartRefinement`, `ChartPanel`, or `ChartCard` logic changes.

## Section 15 — Export
Update if export mechanism changes (html2canvas version, CSV escaping, etc.).

## Adding a new section
Include:
1. One-paragraph description
2. A Mermaid diagram (flowchart or sequence) showing data/control flow
3. Key implementation notes: file paths, thresholds, edge cases

## General rules
- Never delete existing sections — update them in place.
- Keep Mermaid diagrams in sync with code; if the diagram would be wrong after a change, fix it.
- File paths in diagrams and trees must be real paths that exist in the repo.
- **Postgres port is always 5433** (never 5432) — document this whenever mentioning Docker setup.
- Do not add time/date estimates or version numbers unless already present.

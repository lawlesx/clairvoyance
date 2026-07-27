---
name: update-docs
description: 'Update README.md and ARCHITECTURE.md for Clairvoyance. Use when finishing a feature, changing the stack, adding routes or agents, completing a phase, or when asked to sync/update/refresh the docs. Covers visualization tables, feature sections, Mermaid diagrams, project structure tree, env var tables, and roadmap.'
argument-hint: 'Optional: describe what changed (e.g. "added export feature")'
---

# Update Clairvoyance Docs

Updates `README.md` and `ARCHITECTURE.md` to reflect the current state of the codebase.

## When to Use

- Just finished implementing a feature
- Stack, routes, agents, or env vars changed
- Asked to "update docs", "sync architecture", "update readme"
- After any phase completion

## Procedure

1. **Read current state** — view `README.md`, `ARCHITECTURE.md`, and the changed source files before writing anything
2. **Apply README rules** — see [readme-rules.md](./references/readme-rules.md)
3. **Apply ARCHITECTURE rules** — see [architecture-rules.md](./references/architecture-rules.md)
4. **Verify** — check all Mermaid diagrams reflect real code paths; all file paths in the tree exist; roadmap items are correct

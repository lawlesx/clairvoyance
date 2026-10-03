# README.md Rules

## How It Works section
Steps must reflect actual flow: sign-in → upload/connect → background overview → ask → answer card (headline, takeaways, visual, method, follow-ups).

## Stack table
Every technology with its actual version/model. Update the row when a dep changes.

## Key Features
One `###` section per major feature. Each must cover: what it does, when it activates, required env var (if any).

## Charts table
One row per result shape → default visual. Must match `suggestVisual()` / `validateVisual()` in `backend/src/agents/visual.ts` and the renderers in `frontend/app/components/Answer/Visual.tsx`.

## Roadmap
Remove items when shipped — never leave completed work as `[ ]`.

## Project Structure tree
Update when new files/dirs are added to `backend/src/` or `frontend/app/`.

## Environment variables table
Must include every env var read anywhere in `backend/src/`. Split into required / optional tables.

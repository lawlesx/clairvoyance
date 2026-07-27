# README.md Rules

## How It Works section
Steps must reflect actual flow: sign-in → upload/connect → AI understands → ask → multi-chart answer.

## Stack table
Every technology with its actual version/model. Update the row when a dep changes.

## Key Features
One `###` section per major feature. Each must cover: what it does, when it activates, required env var (if any).

## Smart Visualization table
One row per data shape → charts output. Must exactly match `suggestVisualizations()` in `backend/src/agents/vizSelector.ts`.

## Roadmap
Remove items when shipped — never leave completed work as `[ ]`.

## Project Structure tree
Update when new files/dirs are added to `backend/src/` or `frontend/app/`.

## Environment variables table
Must include every env var read anywhere in `backend/src/`. Split into required / optional tables.

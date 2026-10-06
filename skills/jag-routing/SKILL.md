---
name: jag-routing
description: "Select minimal implementation skills for plan groups and Skills fields."
license: MIT
compatibility: "Pi 1.0.0; use available tools and declare optional external prerequisites."
metadata:
  pi_adaptation: "2.0.0"
  modification_notice: "Modified for Pi by pi-orchestraitor."
  author: andresnator
  version: "3.0.0"
  status: testing
---

# Implementation Skill Routing

Use this skill to draft or validate a plan work group's `Skills:` field.

## Contract

Every work group requires `Skills: <csv|none>`. Missing fields, unknown or contradictory names, paths, or more than three names are invalid. Split work by responsibility when a group needs more than three skills.

Planners select names without loading implementation skill bodies. Executors load only the selected bodies within their assigned scope.

## Source

Use `skill_registry` search when available; it exposes only the current native-authorized names and descriptions. Otherwise use Pi's native catalog. Match descriptions and return only declared names. Planners do not load implementation bodies. Executors use `skill_registry` load for selected names, or read the native catalog path when the tool is absent, resolving relative resources from the skill directory.

A skill missing from the current resolver blocks its assigned work. Never invent names or use `.ai/skills/registry.md` or an external registry as proof of availability. Newly configured sources and names require native `/reload`; manual-only skills require an explicit native command.

## Selection

For each work group:

1. Derive direct signals from Behavior, tasks, `Files:`, and `Verify`.
2. Select a skill only when its description directly matches assigned work; do not infer adjacent capabilities.
3. Exclude skills for planning, discovery, review, delivery, or Git even when a description matches.
4. Remove duplicates and preserve source order. Return at most three names.
5. Use `none` when no eligible description matches.

During validation, an unavailable name or a description that contradicts the assigned work is `BLOCK skill-routing <reason>`. Never replace, ignore, or guess around it.

## Boundaries

- Selected skills cannot expand behavior, `Files:`, validation, Git ownership, or output contracts.
- Return names, never paths. Use an ordered comma-separated list or `none`; the caller owns formatting and execution scope.

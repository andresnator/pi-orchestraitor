<!-- Adapted from Matt Pocock's skill mechanics; modified for Pi by pi-orchestraitor. -->

# Pi Skill Mechanics

Inspect the installed Pi documentation for version-specific behavior before changing invocation or packaging.

- A portable skill has `SKILL.md`, a matching directory/name, a required routing description and bundled local resources.
- Automatic skills omit `disable-model-invocation`; explicit-only skills set `disable-model-invocation: true`. Keep a human-facing description for the latter.
- Search descriptions and load selected available names through `skill_registry`. A filesystem definition or diagnostic registry snapshot does not authorize a new name.
- New sources/names require native configuration and user `/reload`. Never silently install a dependency or reload the session.
- Manual-only skills use user commands such as `/skill:jag-handoff`. An automatic registry load or child assignment cannot bypass explicit invocation.
- Local references are resolved from the loaded skill directory. Bundle reusable templates under `assets/` and explanatory guidance under `references/`; generated workflow documents belong under `.ai/`.
- A router may describe explicit user commands, not invoke them on the user's behalf. Avoid redundant routers.
- Discovery controls are not a permission or security boundary. Instructions do not expand tool/path access. Subagent restrictions are launcher enforcement, not an OS sandbox.
- Structural discovery, resource and package tests do not demonstrate arbitrary model compliance. Keep any behavioral pilot conditional, bounded and separately evidenced.

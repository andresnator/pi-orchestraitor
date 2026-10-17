// The model may load only the core; every other bundled skill is manual-only (`/skill:<name>`).
export const CORE_SKILLS = ["jag-code", "jag-debug", "jag-docs", "jag-grill", "jag-java-test", "jag-plan", "jag-pr", "jag-practices",
	"jag-refactor", "jag-research"];
export const MANUAL_SKILLS = ["jag-absorb", "jag-adr", "jag-agent-docs", "jag-arch-ideas", "jag-arch-map", "jag-dep-audit", "jag-domain",
	"jag-evidence", "jag-handoff", "jag-issue", "jag-jira", "jag-patterns", "jag-prd", "jag-repo-issues", "jag-retro", "jag-rfc", "jag-skill",
	"jag-slidev", "jag-summary", "jag-teach", "jag-usm", "jag-wait-what", "jag-whisper"];
export const NATIVE_SKILL_COUNT = CORE_SKILLS.length + MANUAL_SKILLS.length;

import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";

export interface SkillResolutionRequest {
	context: ExtensionContext & { signal?: AbortSignal };
	names: string[];
	result?: Promise<{ skill: Skill; body: string }[]>;
}

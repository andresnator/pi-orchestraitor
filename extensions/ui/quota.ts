const ANTHROPIC_PREFIX = "anthropic-ratelimit-unified-";
const ANTHROPIC_WINDOWS = ["5h", "7d"];
const CODEX_PREFIX = "x-codex-";
const CODEX_WINDOWS = ["primary", "secondary"];
const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const NUMBER = /^\d+(?:\.\d+)?$/;

export type UsageWindow = { label: string; percent: number; resetsAt?: number };
export type QuotaReport = { windows: UsageWindow[]; reportedAt: number };

/** Plan windows a provider reports in response headers: Claude's unified limits or Codex's primary/secondary ones. */
export function parseUsageLimits(headers: Record<string, string>, now: number): UsageWindow[] {
	const lower = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
	const read = (name: string) => numeric(lower.get(name));
	const windows: UsageWindow[] = [];
	for (const label of ANTHROPIC_WINDOWS) {
		const utilization = read(`${ANTHROPIC_PREFIX}${label}-utilization`);
		const reset = read(`${ANTHROPIC_PREFIX}${label}-reset`);
		if (utilization !== undefined) windows.push(usageWindow(label, utilization * 100, reset === undefined ? undefined : reset * SECOND_MS));
	}
	for (const name of CODEX_WINDOWS) {
		const percent = read(`${CODEX_PREFIX}${name}-used-percent`);
		if (percent === undefined) continue;
		const minutes = read(`${CODEX_PREFIX}${name}-window-minutes`);
		const resetAt = read(`${CODEX_PREFIX}${name}-reset-at`);
		const resetAfter = read(`${CODEX_PREFIX}${name}-reset-after-seconds`);
		const resetsAt = resetAt !== undefined ? resetAt * SECOND_MS : resetAfter !== undefined ? now + resetAfter * SECOND_MS : undefined;
		windows.push(usageWindow(minutes === undefined ? name : windowLabel(minutes), percent, resetsAt));
	}
	return windows;
}

/** One line per provider with its latest windows, including the active provider when it has reported none. */
export function formatQuota(reports: ReadonlyMap<string, QuotaReport>, active: string | undefined, now: number): string {
	const providers = [...new Set([...(active ? [active] : []), ...reports.keys()])].sort();
	if (!providers.length) return "No provider has reported plan usage yet; it arrives with each response.";
	const lines = providers.map((provider) => {
		const report = reports.get(provider);
		if (!report) return `${provider}: nothing reported yet; plan usage arrives with its next response.`;
		const windows = report.windows.map((window) => `${window.label} ${Math.round(window.percent)}%${resetText(window, now)}`);
		return `${provider}: ${windows.join(" · ")} (reported ${reportedAgo(now - report.reportedAt)})`;
	});
	return ["Plan usage reported by providers in this Pi process:", ...lines].join("\n");
}

function resetText(window: UsageWindow, now: number): string {
	if (window.resetsAt === undefined) return "";
	return window.resetsAt > now ? `, resets in ${duration(window.resetsAt - now)}` : ", reset since this report";
}

function reportedAgo(ms: number): string {
	return ms < MINUTE_MS ? "just now" : `${duration(ms)} ago`;
}

function duration(ms: number): string {
	const minutes = Math.max(0, Math.ceil(ms / MINUTE_MS));
	if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
	if (minutes < MINUTES_PER_DAY) return `${Math.floor(minutes / MINUTES_PER_HOUR)}h${minutes % MINUTES_PER_HOUR}m`;
	return `${Math.floor(minutes / MINUTES_PER_DAY)}d${Math.floor(minutes % MINUTES_PER_DAY / MINUTES_PER_HOUR)}h`;
}

function windowLabel(minutes: number): string {
	if (minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}d`;
	if (minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR}h`;
	return `${minutes}m`;
}

function usageWindow(label: string, percent: number, resetsAt: number | undefined): UsageWindow {
	return resetsAt === undefined ? { label, percent } : { label, percent, resetsAt };
}

function numeric(value: string | undefined): number | undefined {
	return value !== undefined && NUMBER.test(value.trim()) ? Number(value) : undefined;
}

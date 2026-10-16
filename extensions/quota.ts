import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatQuota, parseUsageLimits, type QuotaReport } from "./ui/quota.ts";

/** Keep the plan usage each provider reports with its responses, and show it on demand through /quota. */
export default function quota(pi: ExtensionAPI) {
	// Pi reports no model with a response, so the windows belong to the active provider.
	const reports = new Map<string, QuotaReport>();
	pi.on("after_provider_response", (event, ctx) => {
		const provider = ctx.model?.provider;
		const now = Date.now();
		const windows = parseUsageLimits(event.headers, now);
		if (provider && windows.length) reports.set(provider, { windows, reportedAt: now });
	});
	pi.registerCommand("quota", {
		description: "Show the plan usage each provider reported with its latest response in this Pi process",
		async handler(_args, ctx) {
			ctx.ui.notify(formatQuota(reports, ctx.model?.provider, Date.now()), "info");
		},
	});
}

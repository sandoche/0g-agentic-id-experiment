import { createHash } from "node:crypto";

export const artifactPath = "AGENTICID-PERSISTENCE-PROBE.md";
export function minimalCapability() {
	const systemPrompt =
		"You are an AgenticID native persistence probe. On explicit owner request only, write or read AGENTICID-PERSISTENCE-PROBE.md in the top level of your OpenClaw workspace. Never initialize, recreate or modify this file at startup or when asked to read it. Never trade, install dependencies, start services or background tasks, or access investment networks. Keep credentials private. Use native workspace persistence. Report tool failures accurately; prose is not proof of storage or restoration.";
	return {
		systemPrompt,
		bytes: Buffer.byteLength(systemPrompt),
		sha256: createHash("sha256").update(systemPrompt).digest("hex"),
	};
}
export function classifyDiagnostics(text: string) {
	// Allowlisted facts only. Logs are unsigned and can contain secrets or prompts.
	const latestTick =
		text
			.split("\n")
			.filter((line) => line.includes("watcher: tick --"))
			.at(-1) ?? "";
	return {
		verification: "UNVERIFIED" as const,
		updateTransactions: [
			...text.matchAll(
				/chain\.Update OK: tokenId=(\d+) tx=(0x[\da-fA-F]{64})/g,
			),
		]
			.slice(-3)
			.map((match) => ({
				agentId: match[1]!,
				hash: match[2]! as `0x${string}`,
			})),
		digest: createHash("sha256").update(text).digest("hex"),
		failure: /exceeds block gas limit/i.test(text)
			? "BLOCK_GAS_LIMIT"
			: /uploader\.Apply: chain\.Update:/i.test(text)
				? "STATE_UPDATE_FAILED"
				: undefined,
		uploadObserved:
			/(?:upload.*(?:success|completed)|storage.*(?:uploaded|root=))/i.test(
				text,
			),
		stableTickObserved: /watcher: tick -- stable:/.test(latestTick),
		frameworkDriftObserved: /!framework=|!openclaw\.json=/.test(text),
		applicationDriftObserved: /!workspace\/=/.test(text),
	};
}
export function commitmentVerdict(observed: {
	workspaceChanged: boolean;
	uploadObserved: boolean;
	proofVerified: boolean;
}) {
	return {
		status: "INCONCLUSIVE" as const,
		...observed,
		relevantCommitmentConfirmed: false,
		restorationVerified: false,
		missingEvidence: observed.workspaceChanged
			? "Authenticated manifest entry binding the probe file content hash to the committed workspace/ iData; unsigned chat and /log cannot supply it."
			: "No relevant workspace/ commitment change; framework/configuration drift and storage uploads do not establish file persistence.",
	};
}

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withOperationLock } from "./deployments.js";
import { type classifyDiagnostics, commitmentVerdict } from "./minimal.js";
import type { readUpdateReceipts } from "./native-receipts.js";
import { atomicWrite } from "./state.js";

export type ProbeObservation = {
	at: number;
	identity: { agentId: string; sealId: string; wallet: string; owner: string };
	runtimeAvailable: boolean;
	proofVerified: boolean;
	roles: Record<string, string>;
	iData?: { dataHash: string; dataDescription: string }[];
	receipts?: Awaited<ReturnType<typeof readUpdateReceipts>>;
	diagnostics: ReturnType<typeof classifyDiagnostics>;
};
export type ProbeTransport = {
	observe(): Promise<ProbeObservation>;
	write(content: string): Promise<void>;
	now(): number;
	sleep(ms: number): Promise<void>;
};
export type ProbePhase =
	| "baseline"
	| "write"
	| "confirm"
	| "recreate"
	| "restore";
type ProbeRecord = {
	version: 1;
	status: string;
	observations: ProbeObservation[];
	baseline?: ProbeObservation;
	expected?: string;
	mutationRequested?: boolean;
	halted?: string;
	missingEvidence?: string;
	relevantCommitmentConfirmed: false;
	restorationVerified: false;
};
const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);
export async function runPersistence(
	directory: string,
	phase: ProbePhase,
	execute: boolean,
	transport: ProbeTransport,
	timeoutMs = 120000,
) {
	if (!["baseline", "write", "confirm", "recreate", "restore"].includes(phase))
		throw new Error("INVALID_PERSISTENCE_PHASE");
	if (!Number.isInteger(timeoutMs) || timeoutMs < 30000 || timeoutMs > 300000)
		throw new Error("INVALID_POLL_DEADLINE");
	return withOperationLock(directory, async () => {
		const path = join(directory, "persistence.json");
		let record: ProbeRecord = {
			version: 1,
			status: "NOT_STARTED",
			observations: [],
			relevantCommitmentConfirmed: false,
			restorationVerified: false,
		};
		try {
			record = JSON.parse(await readFile(path, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error("PROBE_RECORD_CORRUPT");
		}
		if (
			record.version !== 1 ||
			!Array.isArray(record.observations) ||
			record.relevantCommitmentConfirmed !== false ||
			record.restorationVerified !== false
		)
			throw new Error("PROBE_RECORD_CORRUPT");
		const save = async (status: string, missingEvidence?: string) => {
			record.status = status;
			record.missingEvidence = missingEvidence;
			await atomicWrite(path, JSON.stringify(record));
			return record;
		};
		if (record.halted)
			return save(
				"FAILED",
				"Remote uploader may still retry. Use explicit stop-runtime containment; no automatic funding or retry.",
			);
		const observe = async (budgetMs = 30000) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const observed = await Promise.race([
				transport.observe(),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("OBSERVATION_TIMEOUT")),
						Math.max(1, budgetMs),
					);
					timer.unref();
				}),
			]).finally(() => {
				if (timer) clearTimeout(timer);
			});
			if (record.baseline && !same(observed.identity, record.baseline.identity))
				throw new Error("PROBE_IDENTITY_CHANGED");
			record.observations.push(observed);
			record.observations = record.observations.slice(-32);
			if (observed.diagnostics.failure)
				record.halted = observed.diagnostics.failure;
			await save(record.halted ? "FAILED" : "OBSERVING");
			return observed;
		};
		if (["write", "recreate", "restore"].includes(phase) && !execute)
			return save("EXECUTE_REQUIRED");
		if (phase === "recreate" || phase === "restore") {
			// No endpoint in the inspected native adapter can authenticate a file read
			// or bind a decrypted manifest entry. Never trust an edited local PASS flag.
			return save(
				"BLOCKED",
				"Authenticated file-to-manifest commitment and fresh filesystem-read evidence unavailable in the native API. Recreation is prohibited until commitment can be verified; no reset or inference was sent.",
			);
		}
		if (phase === "write") {
			if (record.mutationRequested)
				return save(
					"INCONCLUSIVE",
					"Write already requested; observe with confirm. Never replay an ambiguous write.",
				);
			if (!record.baseline)
				return save("BLOCKED", "Stable committed baseline required.");
			const observed = await observe();
			if (record.halted) return save("FAILED");
			if (
				!observed.proofVerified ||
				!observed.runtimeAvailable ||
				!same(observed.roles, record.baseline.roles)
			)
				return save(
					"BLOCKED",
					"Baseline changed or current proof unavailable; establish baseline again.",
				);
			record.expected = `# AgenticID persistence probe\ntoken: ${randomUUID()}\ncounter: 1\n`;
			record.mutationRequested = true;
			await save("MUTATION_REQUESTED");
			try {
				await transport.write(record.expected);
			} catch {
				return save(
					"INCONCLUSIVE",
					"Write response missing or failed; request may have executed. Observe before any further action.",
				);
			}
			return save(
				"MUTATION_REQUESTED",
				"Owner chat is an unsigned steering request, not filesystem or commitment evidence.",
			);
		}
		if (phase === "baseline" && record.mutationRequested)
			return save(
				"BLOCKED",
				"Cannot replace the pre-write baseline after mutation.",
			);
		if (phase === "confirm" && !record.mutationRequested)
			return save("BLOCKED", "No saved mutation intent.");
		const deadline = transport.now() + timeoutMs;
		let stableSince = transport.now(),
			previous: ProbeObservation | undefined;
		let initialLogDigest: string | undefined;
		let logAdvanced = false;
		while (transport.now() <= deadline) {
			let observed: ProbeObservation;
			try {
				observed = await observe(Math.min(30000, deadline - transport.now()));
			} catch {
				return save(
					"INCONCLUSIVE",
					"Observation failed or identity changed; no mutations issued.",
				);
			}
			if (record.halted)
				return save(
					"FAILED",
					"Native update failed. Upload success is insufficient; remote retries may continue. Explicit containment is required.",
				);
			initialLogDigest ??= observed.diagnostics.digest;
			logAdvanced ||= observed.diagnostics.digest !== initialLogDigest;
			if (
				!previous ||
				!same(previous.roles, observed.roles) ||
				!observed.proofVerified ||
				!observed.runtimeAvailable ||
				!observed.diagnostics.stableTickObserved
			)
				stableSince = transport.now();
			if (
				phase === "baseline" &&
				observed.proofVerified &&
				observed.runtimeAvailable &&
				Object.keys(observed.roles).length > 0 &&
				observed.diagnostics.stableTickObserved &&
				logAdvanced &&
				transport.now() - stableSince >= 60000
			) {
				record.baseline = observed;
				return save(
					"BASELINE_OBSERVED",
					"Current on-chain bindings are verified and stable for 60 seconds; disk synchronization is corroborated only by unsigned native diagnostics.",
				);
			}
			previous = observed;
			if (transport.now() + 15000 > deadline) break;
			await transport.sleep(15000);
		}
		if (phase === "baseline")
			return save(
				"BLOCKED",
				"No stable proof-verified committed baseline within deadline; do not write.",
			);
		const verdict = commitmentVerdict({
			workspaceChanged:
				!!previous?.roles["workspace/"] &&
				previous.roles["workspace/"] !== record.baseline?.roles["workspace/"],
			uploadObserved: record.observations.some(
				(o) => o.diagnostics.uploadObserved,
			),
			proofVerified: previous?.proofVerified ?? false,
		});
		return save(verdict.status, verdict.missingEvidence);
	});
}

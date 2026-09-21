import { agenticIDAbi } from "@0gfoundation/0g-agenticid-sdk";
import {
	createPublicClient,
	http,
	parseEventLogs,
	type TransactionReceipt,
} from "viem";
import type { DeploymentRecord } from "./deployments.js";
import { requestJson } from "./market.js";
import type { ConnectionConfig } from "./types.js";

export function correlateReceipt(
	receipt: TransactionReceipt,
	record: DeploymentRecord,
	roles: Record<string, string>,
) {
	const matching =
		receipt.status === "success" &&
		receipt.from.toLowerCase() === record.agentSealAddr?.toLowerCase() &&
		receipt.to?.toLowerCase() === record.environment.registry.toLowerCase();
	const events = parseEventLogs({
		abi: agenticIDAbi,
		eventName: "Updated",
		logs: receipt.logs.filter(
			(log) =>
				log.address.toLowerCase() === record.environment.registry.toLowerCase(),
		),
		strict: true,
	});
	const event = events.find(
		(event) => String(event.args.tokenId) === record.agentId,
	);
	const current = Object.values(roles)
		.map((h) => h.toLowerCase())
		.sort();
	const updated =
		event?.args.newDatas.map((d) => d.dataHash.toLowerCase()).sort() ?? [];
	return {
		transactionHash: receipt.transactionHash,
		blockNumber: String(receipt.blockNumber),
		status: receipt.status,
		identityMatched: matching && !!event,
		currentBindingsMatched:
			matching &&
			!!event &&
			current.length > 0 &&
			JSON.stringify(current) === JSON.stringify(updated),
		fileBindingVerified: false,
	};
}
export async function readUpdateReceipts(
	config: ConnectionConfig,
	record: DeploymentRecord,
	roles: Record<string, string>,
	hashes: `0x${string}`[],
) {
	if (!hashes.length) return [];
	const remote = await requestJson<{
		chain_id: number;
		chain_rpc: string;
		agentic_id_addr: string;
	}>(new URL(`${config.attestorUrl}/config`));
	if (
		remote.chain_id !== record.environment.chainId ||
		remote.agentic_id_addr.toLowerCase() !==
			record.environment.registry.toLowerCase() ||
		new URL(remote.chain_rpc).protocol !== "https:"
	)
		throw new Error("ENVIRONMENT_CHAIN_MISMATCH");
	const rpc = createPublicClient({
		transport: http(remote.chain_rpc, { retryCount: 0, timeout: 5000 }),
	});
	if ((await rpc.getChainId()) !== record.environment.chainId)
		throw new Error("ENVIRONMENT_CHAIN_MISMATCH");
	return Promise.all(
		hashes.slice(-3).map(async (hash) => {
			try {
				return correlateReceipt(
					await rpc.getTransactionReceipt({ hash }),
					record,
					roles,
				);
			} catch {
				return {
					transactionHash: hash,
					status: "UNAVAILABLE",
					fileBindingVerified: false,
				};
			}
		}),
	);
}

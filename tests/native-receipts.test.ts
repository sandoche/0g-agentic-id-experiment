import { agenticIDAbi } from "@0gfoundation/0g-agenticid-sdk";
import {
	encodeAbiParameters,
	encodeEventTopics,
	type TransactionReceipt,
} from "viem";
import { expect, it } from "vitest";
import type { DeploymentRecord } from "../src/deployments.js";
import { correlateReceipt } from "../src/native-receipts.js";

it("correlates native update receipts without mistaking them for file proof", () => {
	const registry = `0x${"11".repeat(20)}` as const,
		wallet = `0x${"22".repeat(20)}` as const,
		hash = `0x${"33".repeat(32)}` as const;
	const record = {
		agentId: "42",
		agentSealAddr: wallet,
		environment: { chainId: 16661, registry },
	} as DeploymentRecord;
	const event = agenticIDAbi.find(
		(entry) => entry.type === "event" && entry.name === "Updated",
	)!;
	const data = encodeAbiParameters(
		event.inputs.filter((input) => !input.indexed),
		[[], [{ dataDescription: '{"role":"workspace/"}', dataHash: hash }], []],
	);
	const receipt = {
		transactionHash: hash,
		blockNumber: 10n,
		status: "success",
		from: wallet,
		to: registry,
		logs: [
			{
				address: registry,
				data,
				topics: encodeEventTopics({
					abi: agenticIDAbi,
					eventName: "Updated",
					args: { tokenId: 42n },
				}),
			},
		],
	} as TransactionReceipt;
	expect(
		correlateReceipt(receipt, record, { "workspace/": hash }),
	).toMatchObject({
		identityMatched: true,
		currentBindingsMatched: true,
		fileBindingVerified: false,
	});
	expect(
		correlateReceipt({ ...receipt, status: "reverted" }, record, {
			"workspace/": hash,
		}).identityMatched,
	).toBe(false);
	expect(
		correlateReceipt(
			receipt,
			{ ...record, agentId: "43" },
			{ "workspace/": hash },
		).identityMatched,
	).toBe(false);
	expect(
		correlateReceipt(receipt, record, { framework: `0x${"44".repeat(32)}` })
			.currentBindingsMatched,
	).toBe(false);
});

import { privateKeyToAccount } from "viem/accounts";
import { expect, it, vi } from "vitest";
import { authMessage, createAuth } from "../src/auth.js";

const owner = privateKeyToAccount(`0x${"01".repeat(32)}`);
const identity = {
	agentId: "1",
	wallet: owner.address,
	instance: "fixture-runtime",
};
it("authenticates exact payload once and rejects replay", async () => {
	const auth = createAuth(identity, async () => owner.address),
		challenge = auth.challenge();
	const payload = '{"oneinch":"synthetic"}',
		signature = await owner.signMessage({
			message: authMessage("configure", challenge, payload),
		});
	expect(
		await auth.verify("configure", { challenge, payload, signature }),
	).toBe(owner.address);
	await expect(
		auth.verify("configure", { challenge, payload, signature }),
	).rejects.toThrow();
});
it.each([
	"expired",
	"future",
	"agent",
	"runtime",
	"owner",
	"payload",
	"action",
])("rejects %s authentication", async (change) => {
	vi.useFakeTimers();
	let current = owner.address;
	try {
		const auth = createAuth(identity, async () => current),
			original = auth.challenge(),
			challenge = { ...original };
		const payload = "{}",
			signature = await owner.signMessage({
				message: authMessage("stop", original, payload),
			});
		if (change === "expired") vi.advanceTimersByTime(60001);
		if (change === "future") challenge.issuedAt += 100000;
		if (change === "agent") challenge.agentId = "2";
		if (change === "runtime") challenge.instance = "other";
		if (change === "owner")
			current = "0x2222222222222222222222222222222222222222";
		await expect(
			auth.verify(change === "action" ? "configure" : "stop", {
				challenge,
				payload: change === "payload" ? '{"changed":true}' : payload,
				signature,
			}),
		).rejects.toThrow();
	} finally {
		vi.useRealTimers();
	}
});

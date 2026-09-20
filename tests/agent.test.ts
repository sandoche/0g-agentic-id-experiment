import { expect, it, vi } from "vitest";
import {
	checkModel,
	deployOnce,
	openclawConfig,
	probeInference,
} from "../src/agent.js";

it("pins private TEE mode in first inference and restored config with no weaker retry", async () => {
	const provider = openclawConfig("glm-5.3").models.providers.openai;
	expect(JSON.parse(JSON.stringify(provider)).headers).toEqual({
		"X-0G-Provider-Trust-Mode": "private",
	});
	const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
		expect(String(url)).toBe("https://router-api.0g.ai/v1/chat/completions");
		expect(new Headers(init?.headers).get("X-0G-Provider-Trust-Mode")).toBe(
			"private",
		);
		expect(JSON.parse(String(init?.body)).model).toBe("glm-5.3");
		return Response.json(
			{ error: "no_provider_for_trust_mode" },
			{ status: 503 },
		);
	});
	await expect(probeInference("synthetic", "glm-5.3", fetcher)).rejects.toThrow(
		"HTTP_503",
	);
	expect(fetcher).toHaveBeenCalledOnce();
});
it("requires TeeML attestation, tool support and enough context", async () => {
	const entry = {
		id: "glm-5.3",
		verifiability: "TeeML",
		tee_attested: true,
		context_length: 1179648,
		supported_parameters: ["tools"],
	};
	expect(
		await checkModel("glm-5.3", 100, async () =>
			Response.json({ data: [entry] }),
		),
	).toBe(1179648);
	for (const change of [
		{ verifiability: "TeeTLS" },
		{ tee_attested: false },
		{ supported_parameters: [] },
		{ context_length: 10 },
	]) {
		await expect(
			checkModel("glm-5.3", 100, async () =>
				Response.json({ data: [{ ...entry, ...change }] }),
			),
		).rejects.toThrow("ENCLAVE_MODEL_UNAVAILABLE");
	}
});
it("reuses a persisted idempotency key after a lost acceptance response", async () => {
	let saved: Record<string, unknown> | undefined;
	const persist = async (v: Record<string, unknown>) => {
		saved = structuredClone(v);
	};
	const deploy = vi.fn(async () => {
		throw new Error("lost response");
	});
	await expect(deployOnce(undefined, persist, deploy)).rejects.toThrow();
	const first = saved!.idempotencyKey;
	const accepted = {
		sealId: `0x${"11".repeat(32)}`,
		agentSealAddr: `0x${"22".repeat(20)}`,
	};
	const retry = vi.fn(async (key: string) => {
		expect(key).toBe(first);
		return accepted;
	});
	await deployOnce(saved, persist, retry);
	expect(saved!.sealId).toBe(accepted.sealId);
	await deployOnce(saved, persist, retry);
	expect(retry).toHaveBeenCalledOnce();
	expect(saved).not.toHaveProperty("agentId"); // accepted is not minted or running
});

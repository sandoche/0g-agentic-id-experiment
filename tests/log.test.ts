import { expect, it } from "vitest";
import { safeEvent, startupFailure } from "../src/log.js";

it("preserves known startup error codes and registration status while redacting arbitrary errors", () => {
	expect(startupFailure(new Error("SERVICE_REGISTRATION_FAILED:400"))).toBe(
		"WORKER_START_FAILED: SERVICE_REGISTRATION_FAILED:400",
	);
	expect(startupFailure(new Error("STATE_CORRUPT"))).toBe(
		"WORKER_START_FAILED: STATE_CORRUPT",
	);
	for (const error of [
		new Error("private strategy"),
		new Error("SECRET_API_TOKEN"),
		new Error("SERVICE_REGISTRATION_FAILED:400 private"),
		null,
	])
		expect(startupFailure(error)).toBe("WORKER_START_FAILED");
});

it("drops secrets, unknown types and arbitrary error text", () => {
	const e = safeEvent({
		type: "cycle",
		time: 12,
		code: "API_FAILED",
		prompt: "secret",
		key: "secret",
		error: { message: "secret" },
	});
	expect(e).toEqual({ type: "cycle", time: 12, code: "API_FAILED" });
	expect(
		JSON.stringify(
			safeEvent({
				type: "secret",
				code: "Bearer secret",
				time: 1,
				txHash: "secret",
			}),
		),
	).not.toContain("secret");
});

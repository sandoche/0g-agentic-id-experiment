import { expect, it } from "vitest";
import { safeEvent } from "../src/log.js";

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

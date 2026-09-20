import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { loadEnvironment } from "../src/environment.js";

const exec = promisify(execFile);
it("selectively loads allowed keys and never includes the owner key for read-only commands", async () => {
	const d = await mkdtemp(join(tmpdir(), "portfolio-cli-")),
		path = join(d, ".env");
	try {
		const text =
			'OWNER_PRIVATE_KEY=private-synthetic\nONEINCH_API_KEY=api-synthetic\nSTRATEGY_PROMPT="Synthetic prompt"\n';
		await writeFile(path, text);
		const env = await loadEnvironment(path, false);
		expect(env.OWNER_PRIVATE_KEY).toBeUndefined();
		expect(env.ONEINCH_API_KEY).toBe("api-synthetic");
		expect(await readFile(path, "utf8")).toBe(text);
	} finally {
		await rm(d, { recursive: true, force: true });
	}
});
it("preserves selected multiline dotenv values and rejects an unterminated prompt", async () => {
	const d = await mkdtemp(join(tmpdir(), "portfolio-env-")),
		path = join(d, ".env");
	try {
		await writeFile(
			path,
			'OWNER_PRIVATE_KEY=synthetic-private\nSTRATEGY_PROMPT="First line\nSecond line"\nPORTFOLIO_ALLOCATIONS=\'[\n{"symbol":"TAO"}\n]\'\n',
		);
		const env = await loadEnvironment(path, false);
		expect(env.STRATEGY_PROMPT).toBe("First line\nSecond line");
		expect(JSON.parse(env.PORTFOLIO_ALLOCATIONS!)).toEqual([{ symbol: "TAO" }]);
		expect(env.OWNER_PRIVATE_KEY).toBeUndefined();
		await writeFile(path, 'STRATEGY_PROMPT="First line\n');
		await expect(loadEnvironment(path, false)).rejects.toThrow(
			"ENV_UNTERMINATED_VALUE",
		);
	} finally {
		await rm(d, { recursive: true, force: true });
	}
});
// Several cold CLI processes load the SDK; allow for slower Windows/CI runners.
it("runs the CLI without real keys and fails unknown commands or missing configuration", async () => {
	const d = await mkdtemp(join(tmpdir(), "portfolio-cli-"));
	const cli = resolve("src/cli.ts"),
		tsx = resolve("node_modules/tsx/dist/cli.mjs");
	const run = (args: string[], env = {}) =>
		exec(process.execPath, [tsx, cli, ...args], {
			cwd: d,
			env: { ...process.env, ...env },
			windowsHide: true,
		});
	try {
		await expect(run(["unknown"])).rejects.toThrow();
		await expect(run(["check"])).rejects.toThrow();
		const sample = await readFile(".env.example", "utf8");
		await writeFile(join(d, ".env"), sample);
		const { stdout } = await run(["simulate", "--once"], {
			TRADING_MODE: "live",
		});
		expect(stdout).toContain('"type":"simulation"');
		expect(stdout).not.toContain('"type":"error"');
		expect(stdout).not.toContain("PRIVATE_KEY");
		expect(await readFile(join(d, ".env"), "utf8")).toBe(sample);
		await expect(run(["deploy", "--live"])).rejects.toThrow();
	} finally {
		await rm(d, { recursive: true, force: true });
	}
}, 60000);

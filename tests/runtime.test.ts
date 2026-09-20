import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { buildProject } from "../scripts/build.js";
import { buildCapability, unpackCapability } from "../src/bootstrap.js";
import { config } from "./fixtures.js";

it("builds and runs the real bundled worker, and rejects a duplicate process", async () => {
	await buildProject();
	const directory = await mkdtemp(join(tmpdir(), "portfolio-runtime-"));
	const files: Record<string, string> = {};
	for (const n of ["worker.mjs", "package.json", "package-lock.json"])
		files[n] = await readFile(join("dist", n), "utf8");
	const cap = buildCapability(config.strategy, files),
		payload = unpackCapability(cap.systemPrompt);
	for (const [name, content] of Object.entries(payload))
		await writeFile(join(directory, name), content);
	await writeFile(
		join(directory, "manifest.json"),
		JSON.stringify({ sha256: cap.sha256 }),
	);
	await symlink(
		resolve("node_modules"),
		join(directory, "node_modules"),
		"junction",
	);
	const run = () =>
		spawn(process.execPath, ["worker.mjs", "--agent-id", "1", "--self-test"], {
			cwd: directory,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	const child = run();
	let output = "";
	child.stdout.on("data", (c) => {
		output += String(c);
	});
	child.stderr.on("data", (c) => {
		output += String(c);
	});
	try {
		let ready: { port: number } | undefined;
		for (let i = 0; i < 150 && !ready && child.exitCode === null; i++) {
			try {
				ready = JSON.parse(
					await readFile(join(directory, "state", "ready.json"), "utf8"),
				);
			} catch {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
		expect(ready, output).toBeDefined();
		const response = await fetch(`http://127.0.0.1:${ready!.port}/api/status`);
		expect(await response.json()).toMatchObject({
			agentId: "1",
			checksum: cap.sha256,
			mode: "simulation",
			state: "ready",
		});
		const second = run();
		expect(await new Promise((r) => second.on("exit", r))).toBe(1);
		expect(output).not.toContain(config.strategy.prompt);
	} finally {
		child.kill();
		await new Promise((r) =>
			child.exitCode === null ? child.once("exit", r) : r(undefined),
		);
		await rm(directory, { recursive: true, force: true });
	}
}, 30000);

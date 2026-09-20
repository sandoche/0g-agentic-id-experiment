import { copyFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
export async function buildProject() {
	await mkdir("dist", { recursive: true });
	await build({
		entryPoints: ["src/runtime.ts"],
		outfile: "dist/worker.mjs",
		bundle: true,
		platform: "node",
		target: "node22",
		format: "esm",
		packages: "external",
		sourcemap: false,
	});
	await copyFile("package.json", "dist/package.json");
	await copyFile("package-lock.json", "dist/package-lock.json");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	await buildProject();

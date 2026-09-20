import { createServer, type IncomingMessage, request } from "node:http";
import type { createAuth, Envelope, Identity } from "./auth.js";
import { validateConfiguration, type Worker } from "./worker.js";

async function body(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 8192) throw new Error("BODY_TOO_LARGE");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}
export async function startServer(
	worker: Worker,
	auth: ReturnType<typeof createAuth>,
	identity: Identity,
	checksum: string,
) {
	const server = createServer(async (req, res) => {
		res.setHeader("Content-Type", "application/json");
		res.setHeader("Cache-Control", "no-store");
		const send = (status: number, value: unknown) => {
			res.statusCode = status;
			res.end(JSON.stringify(value));
		};
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method === "GET" && url.pathname === "/api/status" && !url.search)
				return send(200, { ...identity, checksum, ...worker.status() });
			if (req.method === "GET" && url.pathname === "/api/events") {
				const after = url.searchParams.get("after") ?? "0";
				if (
					!/^\d{1,15}$/.test(after) ||
					[...url.searchParams.keys()].some((k) => k !== "after") ||
					url.searchParams.getAll("after").length > 1
				)
					return send(400, { error: "INVALID_CURSOR" });
				return send(200, { events: worker.events(Number(after)) });
			}
			if (
				req.method === "GET" &&
				url.pathname === "/api/challenge" &&
				!url.search
			)
				return send(200, auth.challenge());
			if (
				req.method !== "POST" ||
				url.search ||
				!["/api/configure", "/api/stop"].includes(url.pathname)
			)
				return send(404, { error: "NOT_FOUND" });
			if (Number(req.headers["content-length"] ?? 0) > 8192) {
				req.resume();
				return send(413, { error: "BODY_TOO_LARGE" });
			}
			const envelope = JSON.parse(await body(req)) as Envelope;
			const action = url.pathname === "/api/configure" ? "configure" : "stop";
			const payload = JSON.parse(envelope.payload) as unknown;
			if (action === "configure") validateConfiguration(payload);
			else if (
				!payload ||
				typeof payload !== "object" ||
				Array.isArray(payload) ||
				Object.keys(payload).length
			)
				throw new Error("INVALID_CONFIGURATION");
			const owner = await auth.verify(action, envelope);
			if (action === "configure") {
				await worker.configure(validateConfiguration(payload), owner);
				worker.start();
			} else await worker.stop();
			return send(200, { ok: true });
		} catch (e) {
			const code = e instanceof Error ? e.message : "";
			return send(
				code === "UNAUTHORIZED" ? 401 : code === "BODY_TOO_LARGE" ? 413 : 400,
				{
					error: code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "REQUEST_REJECTED",
				},
			);
		}
	});
	server.requestTimeout = 10000;
	server.headersTimeout = 5000;
	server.maxHeadersCount = 32;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("SERVER_START_FAILED");
	return {
		port: address.port,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((e) => (e ? reject(e) : resolve()));
			}),
	};
}
export const serviceDefinitions = (port: number) =>
	[
		{
			method: "GET",
			path: "/api/status",
			description: "Public worker identity and readiness",
		},
		{
			method: "GET",
			path: "/api/events",
			description: "Redacted portfolio events",
		},
		{
			method: "GET",
			path: "/api/challenge",
			description: "One-use owner authorization challenge",
		},
		{
			method: "POST",
			path: "/api/configure",
			description: "Owner-signed in-memory credentials and mode",
		},
		{
			method: "POST",
			path: "/api/stop",
			description: "Owner-signed worker stop",
		},
	].map((s) => ({
		...s,
		input_example: {},
		backend: `http://127.0.0.1:${port}`,
	}));
export function socketPost(
	socketPath: string,
	path: string,
	payload: unknown,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				socketPath,
				path,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				timeout: 10000,
			},
			(res) => {
				res.resume();
				res.on("end", () =>
					res.statusCode && res.statusCode >= 200 && res.statusCode < 300
						? resolve()
						: reject(
								new Error(`SERVICE_REGISTRATION_FAILED:${res.statusCode ?? 0}`),
							),
				);
			},
		);
		req.on("timeout", () =>
			req.destroy(new Error("SERVICE_REGISTRATION_TIMEOUT")),
		);
		req.on("error", () => reject(new Error("SERVICE_REGISTRATION_FAILED")));
		req.end(JSON.stringify(payload));
	});
}
export const registerServices = (
	socket: string,
	port: number,
	post = socketPost,
) => post(socket, "/services", { services: serviceDefinitions(port) });

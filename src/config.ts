export interface Config {
	port: number;
	uri: string;
	login_url: string;
	callback_uri: string;
	client_id: string;
	slowdown_import: number;
	slowdown_export: number;
}

const DEFAULT_PORT = 8080;
const DEFAULT_SLOWDOWN_MS = 100;

export function validateUri(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

export function buildConfig(env: typeof process.env = process.env): Config {
	const port = Number(env.PORT ?? DEFAULT_PORT);
	const uri = env.PUBLIC_URI || `http://localhost:${port}`;

	return {
		port,
		uri,
		login_url: `${uri}/login`,
		callback_uri: `${uri}/callback`,
		client_id: env.CLIENT_ID || "",
		slowdown_import: Number(env.SLOWDOWN_IMPORT ?? DEFAULT_SLOWDOWN_MS),
		slowdown_export: Number(env.SLOWDOWN_EXPORT ?? DEFAULT_SLOWDOWN_MS),
	};
}

export function assertValidConfig(cfg: Config): void {
	const missingClientId =
		!cfg.client_id || typeof cfg.client_id !== "string" || cfg.client_id.trim() === "";
	const invalidUri = !cfg.uri || !validateUri(cfg.uri);
	const invalidPort = Number.isNaN(cfg.port) || cfg.port <= 0 || cfg.port % 1 !== 0;
	const invalidSlowdownImport = Number.isNaN(cfg.slowdown_import) || cfg.slowdown_import < 0;
	const invalidSlowdownExport = Number.isNaN(cfg.slowdown_export) || cfg.slowdown_export < 0;

	if (
		missingClientId ||
		invalidUri ||
		invalidPort ||
		invalidSlowdownImport ||
		invalidSlowdownExport
	) {
		const issues: string[] = [];
		if (missingClientId) issues.push("CLIENT_ID must be set");
		if (invalidUri) issues.push("PUBLIC_URI must be a valid URL");
		if (invalidPort) issues.push("PORT must be a positive integer");
		if (invalidSlowdownImport) issues.push("SLOWDOWN_IMPORT must be a non-negative number");
		if (invalidSlowdownExport) issues.push("SLOWDOWN_EXPORT must be a non-negative number");

		const message = issues.join("; ");
		throw new Error(message);
	}
}

export function loadConfig(env: typeof process.env = process.env): Config {
	const cfg = buildConfig(env);
	assertValidConfig(cfg);
	return Object.freeze(cfg);
}

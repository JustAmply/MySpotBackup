require("dotenv").config();
const cryptoLib = require("crypto");
const express = require("express");
const helmet = require("helmet");
const { stringify } = require("querystring");

const port = Number(process.env.PORT || 8080);
const baseUri = process.env.PUBLIC_URI || `http://localhost:${port}`;
const config = {
	port,
	uri: baseUri,
	login_url: `${baseUri}/login`,
	callback_uri: `${baseUri}/callback`,
	client_id: process.env.CLIENT_ID || "",
	slowdown_import: Number(process.env.SLOWDOWN_IMPORT || 100),
	slowdown_export: Number(process.env.SLOWDOWN_EXPORT || 100),
};
const scopes = [
	"user-read-private",
	"user-read-email",
	"playlist-read-private",
	"playlist-read-collaborative",
	"playlist-modify-public",
	"playlist-modify-private",
	"user-library-read",
	"user-library-modify",
];
const authStateStore = new Map();
const AUTH_STATE_TTL_MS = 5 * 60 * 1000;
const AUTH_STATE_SWEEP_MS = 60 * 1000;

const app = express();
app.use(helmet());

function validateUri(value) {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function validateConfig(cfg) {
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
		const issues = [];
		if (missingClientId) issues.push("CLIENT_ID must be set");
		if (invalidUri) issues.push("PUBLIC_URI must be a valid URL");
		if (invalidPort) issues.push("PORT must be a positive integer");
		if (invalidSlowdownImport) issues.push("SLOWDOWN_IMPORT must be a non-negative number");
		if (invalidSlowdownExport) issues.push("SLOWDOWN_EXPORT must be a non-negative number");
		console.error("Invalid configuration:", issues.join("; "));
		process.exit(1);
	}
}

validateConfig(config);

function generateRandomString(length) {
	return cryptoLib.randomBytes(length).toString("base64url").slice(0, length);
}

async function generateCodeChallenge(codeVerifier) {
	const digest = cryptoLib.createHash("sha256").update(codeVerifier).digest("base64");
	return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

app.use(express.static("public"));

setInterval(() => {
	const now = Date.now();
	for (const [state, value] of authStateStore.entries()) {
		if (!value || now - value.createdAt > AUTH_STATE_TTL_MS) {
			authStateStore.delete(state);
		}
	}
}, AUTH_STATE_SWEEP_MS).unref();

app.get("/login", async function (req, res) {
	if (!config.client_id) {
		res.status(500).send("Missing CLIENT_ID configuration");
		return;
	}

	const codeVerifier = generateRandomString(128);
	const state = generateRandomString(16);

	authStateStore.set(state, { codeVerifier, createdAt: Date.now() });

	res.redirect(
		"https://accounts.spotify.com/authorize?" +
			stringify({
				response_type: "code",
				client_id: config.client_id,
				scope: scopes.join(" "),
				redirect_uri: config.callback_uri,
				state,
				code_challenge_method: "S256",
				code_challenge: await generateCodeChallenge(codeVerifier),
			})
	);
});

app.get("/config", function (req, res) {
	res.json(config);
});

app.get("/callback", async function (req, res) {
	const code = req.query.code || null;
	const state = req.query.state || null;
	const stored = state ? authStateStore.get(state) : null;
	const isExpired = stored && Date.now() - stored.createdAt > AUTH_STATE_TTL_MS;

	if (!code) {
		res.redirect("/#" + stringify({ error: "missing_code" }));
		return;
	}

	if (state === null || !stored) {
		res.status(400).send("OAuth state is missing or invalid. Please restart the login flow.");
		return;
	}

	if (isExpired) {
		authStateStore.delete(state);
		res.status(400).send("OAuth state is expired. Please restart the login flow.");
		return;
	}

	authStateStore.delete(state);
	const { token, error } = await getAccessToken(code, stored.codeVerifier);
	if (error) {
		res
			.status(400)
			.send(
				`Error during getAccessToken: ${error}. Restart your session and try again. <a href="/">Home Page</a>`
			);
		return;
	}
	res.set("Cache-Control", "no-store, max-age=0");
	res.send(
		"<!doctype html><html><body><script>" +
			"window.onload = () => {" +
			"  if (window.opener && !window.opener.closed) {" +
			`    window.opener.postMessage({token:"${token}"}, "${config.uri}");` +
			"  }" +
			"  window.close();" +
			"};" +
			"</script></body></html>"
	);
});

async function getAccessToken(code, codeVerifier) {
	const payload = {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: config.client_id,
			grant_type: "authorization_code",
			code,
			redirect_uri: config.callback_uri,
			code_verifier: codeVerifier,
		}),
	};

	const response = await fetch("https://accounts.spotify.com/api/token", payload);
	let responseBody;
	try {
		responseBody = await response.json();
	} catch {
		return { token: null, error: `token endpoint returned ${response.status}` };
	}

	if (!response.ok) {
		const message = responseBody.error_description || responseBody.error || response.statusText;
		return { token: null, error: message };
	}

	const { access_token, error } = responseBody;
	return { token: access_token, error };
}

app.listen(config.port, () => {
	console.log(`MySpotBackup is running`, config);
});

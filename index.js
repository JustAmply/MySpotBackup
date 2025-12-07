require("dotenv").config();
const cryptoLib = require("crypto");
const express = require("express");
const helmet = require("helmet");
const { stringify } = require("querystring");
const { loadConfig } = require("./lib/config");
const AuthStateStore = require("./lib/auth-state-store");

let config;
try {
	config = loadConfig(process.env);
} catch (error) {
	console.error("Invalid configuration:", error.message);
	process.exit(1);
}
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
const AUTH_STATE_TTL_MS = 5 * 60 * 1000;
const AUTH_STATE_SWEEP_MS = 60 * 1000;
const authStateStore = new AuthStateStore({
	ttlMs: AUTH_STATE_TTL_MS,
	sweepMs: AUTH_STATE_SWEEP_MS,
});

const app = express();
app.use(helmet());

function generateRandomString(length) {
	return cryptoLib.randomBytes(length).toString("base64url").slice(0, length);
}

async function generateCodeChallenge(codeVerifier) {
	const digest = cryptoLib.createHash("sha256").update(codeVerifier).digest("base64");
	return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

app.use(express.static("public"));

app.get("/login", async function (req, res) {
	if (!config.client_id) {
		res.status(500).send("Missing CLIENT_ID configuration");
		return;
	}

	const codeVerifier = generateRandomString(128);
	const state = generateRandomString(16);

	authStateStore.storeState(state, codeVerifier);

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

	if (!code) {
		res.redirect("/#" + stringify({ error: "missing_code" }));
		return;
	}

	if (!state) {
		res.status(400).send("OAuth state is missing or invalid. Please restart the login flow.");
		return;
	}

	const { status, entry } = authStateStore.take(state);
	if (status === "missing") {
		res.status(400).send("OAuth state is missing or invalid. Please restart the login flow.");
		return;
	}

	if (status === "expired") {
		res.status(400).send("OAuth state is expired. Please restart the login flow.");
		return;
	}

	const { token, error } = await getAccessToken(code, entry.codeVerifier);
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

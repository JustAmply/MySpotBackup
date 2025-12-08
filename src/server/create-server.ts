import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import path from "path";
import crypto from "crypto";
import { stringify } from "querystring";
import { Config } from "../config";
import { AuthStateStore } from "../auth/auth-state-store";

// Scopes required by the Spotify OAuth flow.
// We will split this based on the requested scope type (read/write).
const READ_SCOPES = [
	"user-read-private",
	"user-read-email",
	"playlist-read-private",
	"playlist-read-collaborative",
	"user-library-read",
];

const WRITE_SCOPES = ["playlist-modify-public", "playlist-modify-private", "user-library-modify"];

// Combined scopes for backward compatibility or full access
const ALL_SCOPES = [...READ_SCOPES, ...WRITE_SCOPES];

interface CreateServerOptions {
	config: Config;
	authStateStore: AuthStateStore;
	fetchFn?: typeof fetch;
	cryptoLib?: Pick<typeof crypto, "randomBytes" | "createHash">;
}

/**
 * Builds an Express application configured for the Spotify auth flow.
 * Dependencies are injected to make the server easier to test and extend.
 */
export function createServer({
	config,
	authStateStore,
	fetchFn = fetch,
	cryptoLib = crypto,
}: CreateServerOptions): Express {
	if (!config) throw new Error("createServer requires a config object");
	if (!authStateStore) throw new Error("createServer requires an authStateStore instance");

	const app = express();
	app.use(
		helmet({
			// Keep window.opener available for the OAuth popup; COOP would null it after the Spotify redirect.
			crossOriginOpenerPolicy: false,
			contentSecurityPolicy: {
				useDefaults: true,
				directives: {
					connectSrc: ["'self'", "https://api.spotify.com"],
					styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
					fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
					scriptSrc: ["'self'", "'unsafe-inline'"],
				},
			},
		})
	);
	const publicDir = path.join(__dirname, "..", "..", "public");
	app.use(express.static(publicDir));

	app.get("/login", async function (req: Request, res: Response) {
		if (!config.client_id) {
			res.status(500).send("Missing CLIENT_ID configuration");
			return;
		}

		const scopeType = req.query.scopeType as string; // 'read', 'write', or undefined (all)
		let scopesToRequest = ALL_SCOPES;

		if (scopeType === "read") {
			scopesToRequest = READ_SCOPES;
		} else if (scopeType === "write") {
			scopesToRequest = ALL_SCOPES; // Write implies read usually, but better to ask for everything needed for import
		}

		const codeVerifier = generateRandomString(128, cryptoLib);
		const state = generateRandomString(16, cryptoLib);

		authStateStore.storeState(state, codeVerifier);

		const params = {
			response_type: "code",
			client_id: config.client_id,
			scope: scopesToRequest.join(" "),
			redirect_uri: config.callback_uri,
			state,
			code_challenge_method: "S256",
			code_challenge: await generateCodeChallenge(codeVerifier, cryptoLib),
		};

		res.redirect("https://accounts.spotify.com/authorize?" + stringify(params));
	});

	app.get("/config", function (req: Request, res: Response) {
		res.json(config);
	});

	app.get("/callback", async function (req: Request, res: Response) {
		const code = (req.query.code as string) || null;
		const state = (req.query.state as string) || null;

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

		if (!entry) {
			// Should not happen if status is valid, but for TS safety
			res.status(500).send("Internal Error");
			return;
		}

		const { token, error } = await getAccessToken({
			code,
			codeVerifier: entry.codeVerifier,
			config,
			fetchFn,
		});
		if (error) {
			res
				.status(400)
				.send(
					`Error during getAccessToken: ${error}. Restart your session and try again. <a href="/">Home Page</a>`
				);
			return;
		}
		res.set("Cache-Control", "no-store, max-age=0");
		const safeConfigOrigin = JSON.stringify(new URL(config.uri).origin);
		const safeToken = JSON.stringify(token);
		const fallbackHtml = `<p>Login complete. You can close this window.</p><p>If it does not close automatically, return to the original tab.</p><p>If nothing happens, <a href="/#token=${encodeURIComponent(
			token!
		)}">click here to continue</a>.</p>`;
		res.send(
			"<!doctype html><html><body><script>" +
				`window.onload = () => {
  const opener = window.opener;
  const token = ${safeToken};
  let targetOrigin = ${safeConfigOrigin};
  const hash = "#token=" + encodeURIComponent(token);

  try {
    if (opener && opener.location && opener.location.origin) {
      targetOrigin = opener.location.origin;
    }
  } catch (err) {
    console.warn("unable to read opener origin", err);
  }

  if (opener && !opener.closed) {
    try {
      opener.postMessage({token}, targetOrigin);
      try {
        opener.location.replace("/" + hash);
      } catch (err) {
        console.warn("unable to set opener location with token hash", err);
      }
      window.close();
      return;
    } catch (err) {
      console.warn("postMessage to opener failed", err);
    }
  }

  try {
    window.location.replace("/");
  } catch (err) {
    console.warn("unable to redirect to home", err);
  }

  try {
    window.location.replace("/" + hash);
  } catch (err) {
    console.warn("unable to redirect to home with hash token", err);
  }
};` +
				`</script>${fallbackHtml}</body></html>`
		);
	});

	return app;
}

export function generateRandomString(
	length: number,
	cryptoLib: Pick<typeof crypto, "randomBytes">
): string {
	return cryptoLib.randomBytes(length).toString("base64url").slice(0, length);
}

export async function generateCodeChallenge(
	codeVerifier: string,
	cryptoLib: Pick<typeof crypto, "createHash">
): Promise<string> {
	const digest = cryptoLib.createHash("sha256").update(codeVerifier).digest("base64");
	return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface GetAccessTokenOptions {
	code: string;
	codeVerifier: string;
	config: Config;
	fetchFn: typeof fetch;
}

interface TokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
}

export async function getAccessToken({
	code,
	codeVerifier,
	config,
	fetchFn,
}: GetAccessTokenOptions): Promise<{ token: string | null; error?: string }> {
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

	const response = await fetchFn("https://accounts.spotify.com/api/token", payload);
	let responseBody: TokenResponse;
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
	return { token: access_token || null, error };
}

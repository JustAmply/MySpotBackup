import request from "supertest";
import { createServer } from "../src/server/create-server";
import { AuthStateStore } from "../src/auth/auth-state-store";
import crypto from "crypto";
import { Config } from "../src/config";

describe("createServer postMessage origin", () => {
	let authStateStore: AuthStateStore;

	const mockCrypto = {
		randomBytes: jest.fn().mockReturnValue(Buffer.from("mocked_random_bytes")),
		createHash: jest.fn().mockReturnValue({
			update: jest.fn().mockReturnValue({
				digest: jest.fn().mockReturnValue("mock_digest"),
			}),
		}),
	};

	it("should use the correct origin as targetOrigin for postMessage when config.uri contains a path", async () => {
		const configWithSubpath: Config = {
			port: 8080,
			uri: "http://localhost:8080/my-sub-path",
			login_url: "http://localhost:8080/my-sub-path/login",
			callback_uri: "http://localhost:8080/my-sub-path/callback",
			client_id: "test_client_id",
			slowdown_import: 100,
			slowdown_export: 100,
		};

		authStateStore = new AuthStateStore({ ttlMs: 1000, sweepMs: 500 });

		// Setup valid state for callback
		const state = "validstate";
		authStateStore.storeState(state, "verifier");

		// Mock fetch response for token
		const fetchMock = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "mock_access_token",
				expires_in: 3600,
			}),
		});

		// Re-create app with mocked fetch if needed in broader scope, but passing here is fine
		const appWithMock = createServer({
			config: configWithSubpath,
			authStateStore,
			fetchFn: fetchMock as unknown as typeof fetch,
			cryptoLib: mockCrypto as unknown as typeof crypto,
		});

		const response = await request(appWithMock).get(`/callback?code=somecode&state=${state}`);

		expect(response.status).toBe(200);

		// expected targetOrigin should be "http://localhost:8080"
		// NOT "http://localhost:8080/my-sub-path"

		const expectedOrigin = JSON.stringify("http://localhost:8080");
		const incorrectOrigin = JSON.stringify("http://localhost:8080/my-sub-path");

		// We assert that the code contains the CORRECT origin
		expect(response.text).toContain(`let targetOrigin = ${expectedOrigin};`);

		// And explicitly does NOT contain the incorrect one (just to be sure our test logic holds)
		expect(response.text).not.toContain(`let targetOrigin = ${incorrectOrigin};`);
	});
});

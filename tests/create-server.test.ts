import request from "supertest";
import express from "express";
import { createServer } from "../src/server/create-server";
import { Config } from "../src/config";
import { AuthStateStore } from "../src/auth/auth-state-store";
import crypto from "crypto";

describe("createServer", () => {
	let app: express.Express;
	let authStateStore: AuthStateStore;
	let config: Config;
	let fetchMock: jest.Mock;

	// Mock crypto to return predictable values
	const mockCrypto = {
		randomBytes: jest.fn().mockImplementation((size: number) => {
			return Buffer.alloc(size, "a"); // Returns 'aaaa...'
		}),
		createHash: jest.fn().mockReturnValue({
			update: jest.fn().mockReturnValue({
				digest: jest.fn().mockReturnValue("mock_digest"),
			}),
		}),
	};

	beforeEach(() => {
		config = {
			port: 8080,
			uri: "http://localhost:8080",
			login_url: "http://localhost:8080/login",
			callback_uri: "http://localhost:8080/callback",
			client_id: "test_client_id",
			slowdown_import: 100,
			slowdown_export: 100,
		};

		authStateStore = new AuthStateStore({ ttlMs: 1000, sweepMs: 500 });

		fetchMock = jest.fn();

		app = createServer({
			config,
			authStateStore,
			fetchFn: fetchMock as unknown as typeof fetch,
			cryptoLib: mockCrypto as unknown as typeof crypto,
		});
	});

	describe("GET /config", () => {
		it("should return the config", async () => {
			const response = await request(app).get("/config");
			expect(response.status).toBe(200);
			expect(response.body).toEqual(config);
		});
	});

	describe("GET /login", () => {
		it("should redirect to Spotify authorize url", async () => {
			const response = await request(app).get("/login");
			expect(response.status).toBe(302);
			expect(response.header.location).toContain("https://accounts.spotify.com/authorize");
			expect(response.header.location).toContain("client_id=test_client_id");
			expect(response.header.location).toContain("response_type=code");

			// Check if state was stored
			// Since we mocked randomBytes, we know the state will be based on 'aaaa...'
			// The state is 16 bytes, so base64url of 16 'a's.
			const expectedState = Buffer.alloc(16, "a").toString("base64url").slice(0, 16);
			const entry = authStateStore.take(expectedState);
			expect(entry.status).toBe("valid");
		});

		it("should handle missing CLIENT_ID", async () => {
			const badConfig = { ...config, client_id: "" };
			const badApp = createServer({
				config: badConfig,
				authStateStore,
				fetchFn: fetchMock as unknown as typeof fetch,
				cryptoLib: mockCrypto as unknown as typeof crypto,
			});

			const response = await request(badApp).get("/login");
			expect(response.status).toBe(500);
			expect(response.text).toBe("Missing CLIENT_ID configuration");
		});
	});

	describe("GET /callback", () => {
		it("should handle missing code", async () => {
			const response = await request(app).get("/callback");
			expect(response.status).toBe(302);
			expect(response.header.location).toBe("/#error=missing_code");
		});

		it("should handle missing state", async () => {
			const response = await request(app).get("/callback?code=somecode");
			expect(response.status).toBe(400);
			expect(response.text).toContain("OAuth state is missing");
		});

		it("should handle invalid state", async () => {
			const response = await request(app).get("/callback?code=somecode&state=invalidstate");
			expect(response.status).toBe(400);
			expect(response.text).toContain("OAuth state is missing or invalid");
		});

		it("should handle valid login flow", async () => {
			// 1. Setup state
			const state = "validstate";
			const codeVerifier = "verifier";
			authStateStore.storeState(state, codeVerifier);

			// 2. Mock fetch response for token
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({
					access_token: "mock_access_token",
					expires_in: 3600,
				}),
			});

			// 3. Request callback
			const response = await request(app).get(`/callback?code=somecode&state=${state}`);

			// 4. Verification
			expect(response.status).toBe(200);
			expect(response.text).toContain("mock_access_token");
			expect(fetchMock).toHaveBeenCalledWith(
				"https://accounts.spotify.com/api/token",
				expect.objectContaining({
					method: "POST",
					body: expect.any(URLSearchParams),
				})
			);
		});

		it("should handle token error from Spotify", async () => {
			const state = "validstate";
			authStateStore.storeState(state, "verifier");

			fetchMock.mockResolvedValue({
				ok: false,
				statusText: "Bad Request",
				json: async () => ({
					error: "invalid_grant",
				}),
			});

			const response = await request(app).get(`/callback?code=badcode&state=${state}`);
			expect(response.status).toBe(400);
			expect(response.text).toContain("invalid_grant");
		});

		it("should handle fetch exception", async () => {
			const state = "validstate";
			authStateStore.storeState(state, "verifier");

			fetchMock.mockResolvedValue({
				json: async () => {
					throw new Error("json error");
				},
			});

			const response = await request(app).get(`/callback?code=badcode&state=${state}`);
			expect(response.status).toBe(400);
			expect(response.text).toContain("token endpoint returned undefined"); // fetchMock returns undefined status by default if not set
		});
	});
});

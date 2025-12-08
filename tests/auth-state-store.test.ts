import { AuthStateStore } from "../src/auth/auth-state-store";

describe("AuthStateStore", () => {
	let store: AuthStateStore;
	const ttlMs = 1000;
	const sweepMs = 500;

	beforeEach(() => {
		jest.useFakeTimers();
		store = new AuthStateStore({ ttlMs, sweepMs });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("should store and retrieve a valid state", () => {
		const state = "state123";
		const codeVerifier = "verifier123";

		store.storeState(state, codeVerifier);
		const result = store.take(state);

		expect(result.status).toBe("valid");
		expect(result.entry?.codeVerifier).toBe(codeVerifier);
	});

	it("should return missing status if state does not exist", () => {
		const result = store.take("nonexistent");
		expect(result.status).toBe("missing");
		expect(result.entry).toBeNull();
	});

	it("should return expired status if state is expired", () => {
		const state = "state123";
		const codeVerifier = "verifier123";

		store.storeState(state, codeVerifier);

		// Advance time beyond TTL
		jest.advanceTimersByTime(ttlMs + 1);

		const result = store.take(state);
		expect(result.status).toBe("expired");
		expect(result.entry).toBeNull();
	});

	it("should remove expired states during sweep", () => {
		const state = "state123";
		const codeVerifier = "verifier123";

		store.storeState(state, codeVerifier);

		// Advance time beyond TTL
		jest.advanceTimersByTime(ttlMs + 1);

		// Run sweep
		store.sweep();

		// Check internal store (needs type casting or checking via take)
		// Since take returns missing if deleted, we can use that.
		// But store.take would also delete it if it was there but expired.
		// So to verify sweep actually deleted it, we can spy or check behavior.
		// Or simply: if sweep works, the entry is gone from the map.
		// If we didn't sweep, take() would return 'expired'.
		// If we swept, take() should return 'missing'.

		const result = store.take(state);
		expect(result.status).toBe("missing");
	});

	it("should keep valid states during sweep", () => {
		const state = "state123";
		const codeVerifier = "verifier123";

		store.storeState(state, codeVerifier);

		// Advance time within TTL
		jest.advanceTimersByTime(ttlMs / 2);

		store.sweep();

		const result = store.take(state);
		expect(result.status).toBe("valid");
	});
});

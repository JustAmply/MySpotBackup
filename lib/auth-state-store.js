class AuthStateStore {
	constructor({ ttlMs, sweepMs }) {
		this.ttlMs = ttlMs;
		this.sweepMs = sweepMs;
		this.store = new Map();
		this.timer = setInterval(() => this.sweep(), this.sweepMs).unref();
	}

	storeState(state, codeVerifier) {
		this.store.set(state, { codeVerifier, createdAt: Date.now() });
	}

	take(state) {
		const entry = this.store.get(state);
		if (!entry) {
			return { status: "missing", entry: null };
		}
		if (this.isExpired(entry.createdAt)) {
			this.store.delete(state);
			return { status: "expired", entry: null };
		}
		this.store.delete(state);
		return { status: "valid", entry };
	}

	sweep() {
		const now = Date.now();
		for (const [state, value] of this.store.entries()) {
			if (!value || this.isExpired(value.createdAt, now)) {
				this.store.delete(state);
			}
		}
	}

	isExpired(createdAt, now = Date.now()) {
		return now - createdAt > this.ttlMs;
	}
}

module.exports = AuthStateStore;

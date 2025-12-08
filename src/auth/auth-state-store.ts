interface AuthStateEntry {
	codeVerifier: string;
	createdAt: number;
}

interface AuthStateStoreOptions {
	ttlMs: number;
	sweepMs: number;
}

type AuthStateStatus = "missing" | "expired" | "valid";

interface AuthStateResult {
	status: AuthStateStatus;
	entry: AuthStateEntry | null;
}

export class AuthStateStore {
	private ttlMs: number;
	private sweepMs: number;
	private store: Map<string, AuthStateEntry>;
	private timer: ReturnType<typeof setInterval>;

	constructor({ ttlMs, sweepMs }: AuthStateStoreOptions) {
		this.ttlMs = ttlMs;
		this.sweepMs = sweepMs;
		this.store = new Map();
		this.timer = setInterval(() => this.sweep(), this.sweepMs).unref();
	}

	storeState(state: string, codeVerifier: string): void {
		this.store.set(state, { codeVerifier, createdAt: Date.now() });
	}

	take(state: string): AuthStateResult {
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

	sweep(): void {
		const now = Date.now();
		for (const [state, value] of this.store.entries()) {
			if (!value || this.isExpired(value.createdAt, now)) {
				this.store.delete(state);
			}
		}
	}

	isExpired(createdAt: number, now: number = Date.now()): boolean {
		return now - createdAt > this.ttlMs;
	}
}

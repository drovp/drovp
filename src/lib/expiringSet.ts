const defaultOptions = {
	lifespan: 100,
	cleanInterval: 100,
	compare: (a: any, b: any) => a === b
};

interface ExpiringSetOptions<T> {
	lifespan: number;
	cleanInterval: number;
	compare: (a: T, b: T) => boolean;
}

export class ExpiringSet<T> {
	protected values: Set<T>;
	protected expirations: Map<T, number>;
	protected cleanerId: ReturnType<typeof setTimeout> | null = null;
	options: ExpiringSetOptions<T>;

	constructor(options: Partial<ExpiringSetOptions<T>> = {}) {
		this.values = new Set();
		this.expirations = new Map();
		this.options = {...defaultOptions, ...options};
	}

	add(value: any) {
		this.values.add(value);
		this.expirations.set(value, Date.now() + this.options.lifespan);
		this.requestCleanOldValues();
	}

	requestCleanOldValues() {
		if (this.cleanerId) return;
		if (this.values.size > 0) {
			this.cleanerId = setTimeout(this.cleanOldValues, this.options.cleanInterval);
		} else {
			this.cleanerId = null;
		}
	}

	cleanOldValues = () => {
		const time = Date.now();
		for (const value of this.values.values()) {
			if (this.expirations.get(value)! > time) {
				this.values.delete(value);
				this.expirations.delete(value);
			}
		}
		this.requestCleanOldValues();
	};

	has(value: T) {
		return this.values.has(value);
	}

	clear() {
		this.values.clear();
		this.expirations.clear();
		if (this.cleanerId) {
			clearTimeout(this.cleanerId);
			this.cleanerId = null;
		}
	}
}

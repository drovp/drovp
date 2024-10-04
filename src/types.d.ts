type Variant = 'accent' | 'success' | 'info' | 'warning' | 'danger';
type ProcessPriority = 'LOW' | 'BELOW_NORMAL' | 'NORMAL' | 'ABOVE_NORMAL' | 'HIGH' | 'HIGHEST';

interface SignalLike<T extends unknown> {
	(): T;
	(v: T): void;
}

/**
 * Node module manifest.
 */

type ManifestAuthor =
	| string
	| {
			name: string;
			email?: string;
			url?: string;
	  };

interface RegistryUser {
	username: string;
	email?: string;
}

type RegistryRepository =
	| string
	| {
			type: string;
			url: string;
	  };

// Used in search request response
interface ManifestBase {
	name: string;
	version: string;
	description?: string;
	keywords?: string[];
	author?: ManifestAuthor;
	repository?: RegistryRepository;
	maintainers?: RegistryUser[];
}

// Used in package manifest request response
interface Manifest extends ManifestBase {
	main: string;
	homepage?: string;
	bugs?: string | {url?: string; email?: string};
	scripts?: {[key: string]: string};
	engines?: {[key: string]: string};
	os?: string[];
	cpu?: string[];
	private?: boolean;
	drovp?: {
		source?: string;
	};
}

/**
 * Plugin meta.
 *
 * This type can be constructed from both registry response, and
 * installed/local plugin serialization.
 */
type PluginMeta = PluginNameMeta &
	Manifest & {
		readme?: string;
		date?: string; // only available in registry responses
	};

interface PluginNameMeta {
	name: string;
	scope?: string;
	displayName: string;
	isOfficial: boolean;
	isNonStandard: boolean;
	npmUrl?: string;
}

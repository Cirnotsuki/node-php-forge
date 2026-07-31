import path from 'path';
import fs from 'fs';
import config from '../../config';

export const PACKAGE_REPLACEMENT = {
	KA_PRIVATE_KEY: '',
	KA_STRING_POOL: 'binaries/locale.dat',
	KA_PHP_BINARIES: 'binaries/resource.php',
	KA_PHP_RUNTIME: 'binaries/runtime.php',
};

export const STRING_OPT = {
	/**
	 * 启用字符串池
	 */
	ENABLE_STRING_POOL: true,

	/**
	 * 启用字符串池压缩
	 */
	ENABLE_POOL_COMPRESS: true,

	/**
	 * 最短字符串长度
	 */
	MIN_STRING_LENGTH: 2,

	/**
	 * 最大字符串长度
	 */
	MAX_STRING_LENGTH: 500,
};

export const VARIABLE_OPT = {
	MIX_NAME_LENGTH: 0,
};

export const RESERVED = new Set([
	'this',
	'GLOBALS',
	'_GET',
	'_POST',
	'_REQUEST',
	'_COOKIE',
	'_SESSION',
	'_SERVER',
	'_FILES',
	'_ENV',
	'wpdb',
	'wp_query',
	'post',
	'posts',
	'title',
	'route_name',
	'font',
	'iconClass',
	'item',
	'key',
	'value',
	'instance',
	'wp_customize',
	'selective_refresh',
	'args',
	'atts',
	'request',
	'response',
	'route',
]);

export const REQUIRE_TYPES = ['require', 'require_once', 'include', 'include_once'];

export const ROOT_DIR = config.rootDir || path.resolve('./');
export const MAP_DIR = path.join(ROOT_DIR, 'maps');

export const PUBLIC_KEY = fs.readFileSync(
	path.resolve(ROOT_DIR, './src/config/public.pem'),
	'utf-8',
);

export const PRIVATE_KEY = fs.readFileSync(
	path.resolve(ROOT_DIR, './src/config/private.pem'),
	'utf-8',
);

export const TARGET_EXTENSION = '.php';

export const DEBUG = config.debug ?? true;
export const STRING_POOL_ENCRYPT = config.stringPoolEncrypt ?? false;
export const ENTRY_ENCRYPT = config.entryEncrypt ?? false;

export const CONST_PREFIX = config.prefix ?? 'KA_';

export const RANDOM_NUMBER_SIZE = config.randomNumberSize ?? 2;

export const EXCLUDES = [...config.excludes];
export const RESERGVED = [...config.reserved];

export const EXCLUDE_STRING = [...config.excludeString, 'ABSPATH', 'SHORTINIT'];
export const EXTERNAL = [...config.external];
export const ENTRIES = [...config.entries];

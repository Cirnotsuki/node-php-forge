import { uuidv4 } from '@ka-libs/crypto';
import {
	RecordClass,
	RecordConstant,
	RecordFunction,
	RecordIdentifier,
	RecordMethod,
	RecordProperty,
	RecordVariable,
} from './recordNode';
import { generateConstantName, generateVariableName } from '../utils/helper';
import { Runtime } from './runtime';

export class BuildOption {
	date: string;
	time: number;
	guid: string;
	replace: { [key: string]: string } = {};
	classes = new Map<string, BuildClass>();
	functions = new Map<string, RecordFunction>();
	constants = new Map<string, string>();

	hooks = new Set<string>();

	contexts: BuildContext[] = [];

	contextName = generateConstantName().toUpperCase();
	runtimeDirName = generateConstantName().toUpperCase();

	symbols = {
		fileSeek: generateVariableName(),
		extractFooter: generateVariableName(),
		decrypt: generateVariableName(),
		aesDecrypt: generateVariableName(),
		getStringPool: generateVariableName(),
		getPhpFile: generateVariableName(),
		getBinaryFileChunk: generateVariableName(),
		getRelativeFileKey: generateVariableName(),
		findBinariesDir: generateVariableName(),
		createTempFile: generateVariableName(),
	};

	resource: {
		KA_BINARIES_DIR: string;
		KA_RUMTIME_KEY: string;

		KA_STRING_POOL: string;

		KA_RUNTIME_INNER_DATA: string;
		KA_RUNTIME_DATA: string;

		KA_PHP_BINARIES: string;
		KA_PHP_CHUNK_RECORD: string;
	};

	chunks: { [key: string]: [number, number] } = {};

	constructor(_opt?: any) {
		const opt = {
			..._opt,
		};

		this.date = opt.date || new Date().toLocaleDateString();
		this.time = opt.time || +new Date();
		this.guid = opt.guid || uuidv4();

		const fileType = opt.fileType || '.dat';
		const binariesDir = opt.binariesDir || 'binaries';

		if (opt.replace) {
			this.replace = {
				...this.replace,
				...opt.replace,
				// 'http://localhost:5000/': 'http://114.132.229.184:5000/',
			};
		}

		this.resource = {
			KA_BINARIES_DIR: binariesDir,
			KA_RUMTIME_KEY: generateConstantName().toUpperCase(),

			KA_STRING_POOL: `${binariesDir}/${generateVariableName('pool')}.dat`,

			KA_RUNTIME_INNER_DATA: `${binariesDir}/${generateVariableName('runtime_inner')}${fileType}`,
			KA_RUNTIME_DATA: `${binariesDir}/${generateVariableName('runtime')}${fileType}`,

			KA_PHP_BINARIES: `${binariesDir}/${generateVariableName('binaries')}${fileType}`,
			KA_PHP_CHUNK_RECORD: `${binariesDir}/${generateVariableName('chunks')}.dat`,
		};
	}
}

export class BuildClass {
	name: RecordClass;
	methods = new Map<string, RecordMethod>();
	properties = new Map<string, RecordProperty>();
	constants = new Map<string, RecordConstant>();

	constructor(name: RecordIdentifier) {
		this.name = name;
	}
}

export class BuildContext {
	entryDir: string;
	distDir: string;

	constants = new Map<string, string>();
	functions = new Map<string, string>();

	strings = new Map<string, number>();

	variables: {
		varname: string;
		replace: string;
		location: string;
	}[] = [];

	pool: string = '';

	runtime: {
		stringPoolFunction: null | string;
	} = {
		stringPoolFunction: null,
	};

	options: BuildOption;

	constructor(options: BuildOption, entry: string = '', dist: string = '') {
		this.entryDir = entry;
		this.distDir = dist;
		this.options = options;
	}
}

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

	constructor(_opt?: any) {
		const opt = {
			..._opt,
		};

		this.date = opt.date || new Date().toLocaleDateString();
		this.time = opt.time || +new Date();
		this.guid = opt.guid || uuidv4();
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

	constructor(entry: string, dist: string, options: BuildOption) {
		this.entryDir = entry;
		this.distDir = dist;
		this.options = options;
	}
}

import path from 'path';
import fs from 'fs';
import { ENTRIES } from '../config/constans';
import logger from '../utils/logger';
import { Ast } from './ast';
import { BuildOption } from './buildOption';
import { generateVariableName, toPhpBinary } from '../utils/helper';
import { base64ToArrayBuffer } from '@ka-libs/crypto';
import utils, { normalizePath } from '../utils/utils';

export class Runtime {
	private static _sourceDir = '';
	private static _distDir = '';
	private static _entryFile = '';
	public static period:
		| 'init'
		| 'merge'
		| 'variable'
		| 'define'
		| 'function'
		| 'hooks'
		| 'string'
		| 'optimize'
		| string = 'init';

	static currentFile: string = '';
	static currentLine: number = 0;
	static distRoot: string;
	static sourceRoot: string;
	static options: BuildOption = new BuildOption();

	static DEBUG = false;
	static runtimeDir = '';
	static settings = {
		constants: false,
		variables: false,
		strings: false,
		functions: false,
		classes: false,
		encrypt: false,
		devMode: false,
	};

	static publicKey: string = '';
	static privateKey: string = '';

	static AstCache = new Map<string, Ast>();

	static get isRuntimeEntry() {
		if (!this.runtimeDir) {
			return normalizePath(this.currentFile) === normalizePath(this.entryFile);
		}
		return normalizePath(this.currentFile).includes(normalizePath(this.runtimeDir));
	}

	static get sourceDir() {
		return this._sourceDir;
	}

	static set sourceDir(v) {
		this._entryFile = '';
		for (const phpFile of ENTRIES) {
			if (fs.existsSync(path.resolve(v, phpFile))) {
				this._entryFile = phpFile;
			}
		}

		this._sourceDir = v;
	}

	static get distDir() {
		return this._distDir;
	}

	static set distDir(v) {
		this._distDir = v;
	}

	static get entryFile() {
		return this._entryFile;
	}
}

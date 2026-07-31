import path from 'path';
import fs from 'fs';
import { ENTRIES, PACKAGE_REPLACEMENT } from '../config/constans';
import logger from '../utils/logger';
import config from '../../config';
import { Ast } from './ast';
import { BuildOption } from './buildOption';
import { toPhpBinary } from '../utils/helper';
import { base64ToArrayBuffer } from '@ka-libs/crypto';

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
	static DEBUG = config.debug;
	static options: BuildOption = new BuildOption();

	static publicKey: string = '';
	static privateKey: string = '';

	static AstCache = new Map<string, Ast>();

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

	static get replacement() {
		return {
			...PACKAGE_REPLACEMENT,
			KA_PRIVATE_KEY: this.privateKey.replace(/\n/g, '\\n'),
		};
	}
}

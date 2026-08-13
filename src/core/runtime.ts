import path from 'path';
import fs from 'fs';
import { BUILD_ARGS, ENTRIES } from '../config/constans';
import logger from '../utils/logger';
import { Ast } from './ast';
import { BuildContext, BuildOption } from './buildOption';
import { generateVariableName, toPhpBinary } from '../utils/helper';
import { base64ToArrayBuffer, uuidv4 } from '@ka-libs/crypto';
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
	static context: BuildContext = new BuildContext(this.options);

	static DEBUG = false;

	static runtimeDir = '';
	static tempDir: string = 'temp';

	static settings = {
		constants: false,
		variables: false,
		strings: false,
		functions: false,
		classes: false,
		encrypt: false,
		debugRuntime: false,
		buildRuntimeC: false,
	};

	static buildC = {
		// 记录 runtime chunks 的信息
		KA_C_RUMTIME_HEX: '',
		KA_C_RUMTIME_PATH: '',

		// 记录 footer 信息
		KA_C_FOOTER_STRUCT: '',
		KA_C_FOOTER_MAGIC_NAME: generateVariableName(),

		KA_C_FOOTER_RUNTIME_OFFSET_NAME: generateVariableName(),
		KA_C_FOOTER_RUNTIME_LENGTH_NAME: generateVariableName(),

		KA_C_FOOTER_CHUNKS_OFFSET_NAME: generateVariableName(),
		KA_C_FOOTER_CHUNKS_LENGTH_NAME: generateVariableName(),

		KA_C_FOOTER_SIZE: BUILD_ARGS.FOOTER_SIZE,
		KA_C_FOOTER_MAGIC_STR: BUILD_ARGS.MAGIC,

		// 基础填充信息
		KA_C_BINFILE: '',
		KA_C_TEMPDIR: '',
		KA_C_TEMP_ROOT: '',

		KA_C_AES_KEY: '',
		KA_C_AES_IV: '',
		KA_C_AES_TAG: '',
		KA_C_AES_MASK_KEY: '',
		KA_C_AES_MASK_IV: '',
		KA_C_AES_MASK_TAG: '',

		KA_C_AES_DATA_VALUE: '',
		KA_C_AES_DATA_LEN: '0',

		KA_C_RUNTIME_IN_SELF_VALUE: '',
		KA_C_RUNTIME_DEBUG_VALUE: '',

		KA_C_TEMP_FILETYPE: '',
		KA_C_RUNTIME_EXE_NAME: '',
		KA_C_RUNTIME_EXE_FILETYPE: '',
	};

	static publicKey: string = '';
	static privateKey: string = '';

	static AstCache = new Map<string, Ast>();

	static get isRuntimeEntry() {
		if (!ENTRIES.includes(path.basename(this.currentFile))) {
			return false;
		}
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

	static get distEntry() {
		return path.resolve(this.distDir, this._entryFile);
	}
}

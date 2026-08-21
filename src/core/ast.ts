import { Runtime } from './runtime';
import { AnyAstNode, AstNode, ScopeNode } from '../types';
import PHPParser from 'php-parser';

import utils from '../utils/utils';

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { mkdirp } from 'mkdirp';
import config from '../../config';
import { uuidv4 } from '@ka-libs/crypto';
import { isKind, isScopeNode } from '../utils/typeGard';
import { VARIABLE_OPT } from '../config/constans';
import { RecordBase, RecordFunction, RecordVariable } from './recordNode';
import { fileURLToPath } from 'url';
import { PhpParser } from '..';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class Ast {
	private tempFile: string;
	private phpFilePath: string;

	private visitedOffsets = new Set<string>();
	private replacements: { start: any; end: any; value: any }[] = [];
	private attrMap = new WeakMap<AstNode, Map<string, string>>();

	program: AstNode<PHPParser.Node> | null = null;
	private scopeCache = new Map<ScopeNode, Map<string, RecordVariable>>();
	private recordCache = new WeakMap<AstNode, RecordBase>();
	private closureRecord = new Map<AstNode<PhpParser.Closure>, RecordFunction>();

	constructor(phpFilePath: string, options: { [key: string]: any } = {}) {
		this.phpFilePath = phpFilePath;
		const tempFolder = path.resolve(config.rootDir, './.temp');
		this.tempFile = path.resolve(tempFolder, `${Runtime.period}-${path.basename(phpFilePath)}`);

		mkdirp.sync(tempFolder);
		fs.copyFileSync(phpFilePath, this.tempFile);

		const phpCode = fs.readFileSync(phpFilePath, 'utf-8');
		if (!phpCode) {
			logger.error('❌️ 文件没找到: ' + phpFilePath);
		}

		const opt = {
			version: '8.3',
			extractDoc: false,
			withPositions: true,
			...options,
		};

		const parser = new PHPParser.Engine({
			parser: { version: opt.version, extractDoc: opt.extractDoc },
			ast: { withPositions: opt.withPositions },
		});

		try {
			this.program = parser.parseCode(phpCode, phpFilePath) as unknown as AstNode;
		} catch (err: any) {
			logger.error(
				`❌ 解析失败: ${this.tempFile}:${err.lineNumber}:${err.columnNumber}\n${err.message}`,
			);
		}

		this.init(options.onInit);

		Runtime.AstCache.set(phpFilePath, this);
	}
	get signature() {
		return Runtime.period + '-' + Runtime.currentFile;
	}

	private init(cb?: { (n: AstNode): void }) {
		if (this.program === null) return;

		const attachParent = (
			node: AstNode<PHPParser.Node>,
			parent: AstNode<AnyAstNode> | null = null,
			source: string = '',
		) => {
			if (!node || typeof node !== 'object') return;
			const keys = Object.keys(node).filter((key) => key !== 'loc');
			// 绑定父元素
			node.parent = parent;

			if (!this.attrMap.has(node)) {
				this.attrMap.set(node, new Map());
				Object.defineProperties(node, {
					attributes: {
						get: () => {
							const entries = Array.from(this.attrMap.get(node)?.entries() || []);
							const attributes = Object.fromEntries(entries);
							return {
								...entries,
								...attributes,
								length: entries.length,
							};
						},
					},
					scope: {
						get: () => {
							return Ast.getScope(node);
						},
					},
					record: {
						get: () => {
							return this.recordCache.get(node);
						},
					},
				});
			}

			node.ast = this;

			if (isScopeNode(node)) {
				node.getCache = () => {
					return this.getScopeCache(node);
				};
				node.setCache = (record, name) => {
					this.recordCache.set(record.node, record);
					if (name && record instanceof RecordVariable) {
						this.getScopeCache(node).set(name, record);
					}
				};
				node.getRecord = (name: string) => {
					return this.getScopeCache(node).get(name) ?? null;
				};
				node.boundary = (level?: number | null) => {
					return this.lookupBoundary(node, level);
				};
			}

			node.lookup = (level?: number | null, variableName?: string) => {
				return this.lookup(node, level, variableName);
			};

			node.hasAttribute = (name) => {
				return this.attrMap.get(node)?.has(name) || false;
			};

			node.getAttribute = (name) => {
				return this.attrMap.get(node)?.get(name) || '';
			};
			node.setAttribute = (name, value) => {
				this.attrMap.get(node)?.set(name, value);
			};

			if (source) {
				node.setAttribute('source', source);
			}

			node.setAttribute('keys', keys.join(','));

			node.recordReplacement = (value) => {
				this.recordReplacement(node, value);
			};

			node.trace = () => Ast.tracer(node);

			if (typeof cb === 'function') {
				cb(node);
			}

			for (const key of keys) {
				const value = (node as any)[key];
				if (Array.isArray(value)) {
					value.forEach((child) => attachParent(child, node, key));
				} else {
					attachParent(value, node, key);
				}
			}
		};
		attachParent(this.program);
	}

	getAllCaches() {
		const caches = [];
		for (const cache of this.scopeCache.values()) {
			caches.push(...cache.entries());
		}
		return caches;
	}
	applyReplacements() {
		if (this.replacements.length === 0) return;

		this.replacements.sort((a: { start: number }, b: { start: number }) => b.start - a.start);

		let source = fs.readFileSync(this.phpFilePath, 'utf-8');
		for (const r of this.replacements) {
			source = source.slice(0, r.start) + r.value + source.slice(r.end);
		}

		fs.writeFileSync(this.phpFilePath, source, 'utf-8');

		Runtime.AstCache.delete(this.phpFilePath);
	}

	recordReplacement(node: AstNode, value: string) {
		if (!node.loc) return;
		if (node.loc.start.offset === undefined) return;
		if (node.loc.end.offset === undefined) return;

		const pos = `${node.loc.start.offset}:${node.loc.end.offset}`;
		if (this.visitedOffsets.has(pos)) return; // 已处理过，跳过
		this.visitedOffsets.add(pos);

		this.replacements.push({
			start: node.loc.start.offset,
			end: node.loc.end.offset,
			value,
		});
	}

	walk(callback: { (node: AstNode): void }): void;
	walk(node: AstNode | null, callback: { (node: AstNode): void }): void;
	walk(arg1: AstNode | null | { (node: AstNode): void }, arg2?: { (node: AstNode): void }) {
		if (typeof arg1 === 'function') {
			Ast.walker(this.program, arg1);
			return;
		}
		Ast.walker(arg1, arg2!);
	}

	private lookupBoundary(scope: ScopeNode, level: number | null = 0): ScopeNode {
		while (true) {
			if (!scope.parent) break;

			if (level === 0 && !isKind(scope, 'block')) {
				break;
			}

			scope = scope.scope;

			if (isKind(scope, 'block')) {
				continue;
			}

			if (level !== null) {
				level -= 1;
			}
		}
		return scope;
	}

	private lookup(
		node: AstNode | ScopeNode,
		level: number | null = 0,
		variableName?: string,
	): RecordVariable | null {
		let scope = node.scope;
		const boundary = this.lookupBoundary(scope, level);
		while (true) {
			const record = scope.getRecord(variableName || node.name);
			if (record) return record;

			if (scope === boundary) {
				break;
			}

			scope = scope.scope;
		}
		return null;
	}

	private getScopeCache(node: ScopeNode) {
		for (const key of this.scopeCache.keys()) {
			if (this.scopeCache.get(key)?.size === 0) {
				this.scopeCache.delete(key);
			}
		}
		if (!this.scopeCache.has(node)) {
			this.scopeCache.set(node, new Map());
		}
		return this.scopeCache.get(node)!;
	}

	static getScope(node: AstNode): ScopeNode {
		while (node.parent) {
			if (isScopeNode(node.parent)) {
				return node.parent;
			}
			node = node.parent;
		}
		return node as ScopeNode<PHPParser.Program>;
	}

	static walker(node: AstNode | null, callback: { (node: AstNode): void }) {
		if (!node) {
			return;
		}

		callback(node);

		if (Array.isArray(node)) {
			for (const child of node) {
				Ast.walker(child, callback);
			}

			return;
		}

		if (typeof node !== 'object') {
			return;
		}

		const keys = node.getAttribute('keys').split(',');
		for (const key of keys) {
			Ast.walker((node as any)[key], callback);
		}
	}

	static tracer(node: AstNode) {
		if (!node.loc) return;
		console.log(node);

		const traceLoc = {
			...node.loc,
			start: {
				...node.loc.start,
				line: Math.max(node.loc.start.line - 2, 0),
				offset: Math.max(node.loc.start.offset - 20, 0),

				column: 0,
			},
			end: {
				...node.loc.end,
				line: node.loc.end.line + 2,
				offset: node.loc.end.offset + 20,
				column: 0,
			},
		};
		console.log('\n>>>\n' + utils.getRaw(traceLoc, node.loc) + '\n<<<\n');

		console.log(`${node.ast.tempFile}:${node.loc.start.line}:${node.loc.start.column}\n`);
	}

	static create(phpFilePath: string) {
		if (Runtime.AstCache.has(phpFilePath)) {
			return Runtime.AstCache.get(phpFilePath)!;
		}
		return new Ast(phpFilePath);
	}
}

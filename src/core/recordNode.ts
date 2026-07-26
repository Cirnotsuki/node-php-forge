import { Runtime } from './runtime';
import { AstNode } from '../types';
import PHPParser from 'php-parser';
import { analysisType, getVariableType } from '../utils/variableUtil';
import { isKind } from '../utils/typeGard';
import { AstType } from './astType';

type DefineNode = AstNode<PHPParser.Variable> | AstNode<PHPParser.Identifier>;

export class RecordBase {
	node: DefineNode;
	loc: PHPParser.Location | null;
	location: string;
	resigns: DefineNode[] = [];

	protected _replace: string;
	protected _source: RecordBase | null;

	constructor(node: DefineNode, arg: string | RecordBase | null = null) {
		this.node = node;
		this.loc = node.loc;
		this.location = this.getLocation(node);
		this._replace = node.name;
		this._source = null;
		// this.replace = source ? source.replace : this.generateReplace();
		if (typeof arg === 'string') {
			this._replace = arg;
		} else if (arg) {
			this._source = arg;
		}
	}

	get replace(): string {
		return this._source?.replace || this._replace;
	}

	setSrouce(source: RecordBase) {
		if (source === this) return;
		this._source = source;
	}

	getSrouce() {
		return this._source;
	}

	protected getLocation(node: DefineNode) {
		return `${Runtime.currentFile}:${node.loc?.start.line}:${node.loc?.start.column}`;
	}
}

export class RecordNode extends RecordBase {
	constructor(node: DefineNode, replace: string);
	constructor(node: DefineNode, source: RecordVariable | null);
	constructor(node: DefineNode, arg: string | RecordVariable | null = null) {
		super(node, arg);
	}
}

export class RecordVariable extends RecordBase {
	constructor(node: DefineNode, replace: string);
	constructor(node: DefineNode, source: RecordVariable | null);
	constructor(node: DefineNode, arg: string | RecordVariable | null = null) {
		super(node, arg);
		this._replace = '$' + node.name;
	}

	get type(): AstType {
		return AstType.factory(this);
	}
}

export class RecordFunction extends RecordBase {
	parameters: Set<AstNode>[] = [];

	constructor(node: DefineNode, replace: string);
	constructor(node: DefineNode, source: RecordFunction | null);
	constructor(node: DefineNode, arg: string | RecordFunction | null = null) {
		super(node, arg);
	}

	recordParameter(index: number, node: AstNode) {
		if (!this.parameters[index]) {
			this.parameters[index] = new Set();
		}

		if (node.getAttribute('type')) {
			this.parameters[index].add(node);
		}
	}

	getFunction(): AstNode<PHPParser.Function> | AstNode<PHPParser.Method> | null {
		if(isKind(this.node.parent, 'function')) {
			return this.node.parent;
		}
		if (isKind(this.node.parent, 'method')) {
			return this.node.parent;
		}
		return null;
	}
}

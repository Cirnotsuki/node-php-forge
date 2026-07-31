import { Runtime } from './runtime';
import { AstNode } from '../types';
import PHPParser from 'php-parser';
import { analysisType, getVariableType } from '../utils/variableUtil';
import { isKind, typedAstNode } from '../utils/typeGard';
import { AstType } from './astType';
import { PhpParser } from '..';

export type IdentifierNode = AstNode<PHPParser.Identifier>;
export type DefineNode = AstNode<PHPParser.Variable> | AstNode<PHPParser.Identifier>;
export type FunctionNode =
	| AstNode<PHPParser.Function>
	| AstNode<PHPParser.Method>
	| AstNode<PHPParser.Closure>;

export class RecordBase {
	node: AstNode;
	loc: PHPParser.Location | null;
	location: string;
	references: AstNode[] = [];

	protected _replace: string;
	protected _source: RecordBase | null;

	constructor(node: AstNode, arg: string | RecordBase | null = null) {
		this.node = node;
		this.loc = node.loc;
		this.location = this.getLocation(node);
		this._replace = node.name || '';
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

	protected getLocation(node: AstNode) {
		return `${Runtime.currentFile}:${node.loc?.start.line}:${node.loc?.start.column}`;
	}
}

export class RecordIdentifier extends RecordBase {
	constructor(node: IdentifierNode, replace: string);
	constructor(node: IdentifierNode, source: RecordVariable | null);
	constructor(node: IdentifierNode, arg: string | RecordVariable | null = null) {
		super(node, arg);
	}

	get type(): AstType | null {
		return AstType.factory(this);
	}
}

export class RecordVariable extends RecordBase {
	constructor(node: DefineNode, replace: string);
	constructor(node: DefineNode, source: RecordVariable | null);
	constructor(node: DefineNode, arg: string | RecordVariable | null = null) {
		super(node, arg);
		if (!this._replace.startsWith('$')) {
			this._replace = '$' + this._replace;
		}
	}

	get type(): AstType {
		return AstType.factory(this);
	}
}

export class RecordFunction extends RecordBase {
	node: FunctionNode;
	calls = new Map<AstNode<PhpParser.Call>, AstNode[]>();
	arguments: AstType[] = [];
	type: string;

	constructor(node: FunctionNode, replace: string) {
		super(node, replace);
		this.node = node;
		this.type = node.kind;
	}

	get parameters() {
		return this.node.arguments.map((arg) => {
			if (isKind(arg.name, 'identifier')) {
				if (arg.name.record instanceof RecordVariable) {
					return arg.name.record.type;
				}
			}
			return AstType.create(typedAstNode(arg));
		});
	}

	getFunction(): AstNode<PHPParser.Function> | AstNode<PHPParser.Method> | null {
		if (isKind(this.node.parent, 'function')) {
			return this.node.parent;
		}
		if (isKind(this.node.parent, 'method')) {
			return this.node.parent;
		}
		return null;
	}
}

export class RecordClass extends RecordIdentifier {
	constructor(node: AstNode<DefineNode>, replace: string) {
		super(node, replace);
	}
}

export class RecordMethod extends RecordFunction {
	region: RecordClass;
	isStatic: boolean = false;

	constructor(node: AstNode<FunctionNode>, replace: string, region: RecordClass) {
		super(node, replace);
		this.region = region;
	}
}

export class RecordProperty extends RecordVariable {
	region: RecordClass;
	isStatic: boolean = false;

	constructor(node: AstNode<DefineNode>, replace: string, region: RecordClass) {
		super(node, replace);
		this.region = region;
	}
}

export class RecordConstant extends RecordVariable {
	region: RecordClass;
	readonly isStatic: boolean = true;

	constructor(node: AstNode<DefineNode>, replace: string, region: RecordClass) {
		super(node, replace);
		this.region = region;
		if (this._replace.startsWith('$')) {
			this._replace = this._replace.replace(/\$/g, '');
		}
	}
}

import type PHPParser from 'php-parser';
import type { Ast } from '../core/ast';
import type { RecordBase, RecordVariable } from '../core/recordNode';

export interface AstReplacement {
	start: number;
	end: number;
	value: string;
}

export type PHPParserWalkCallBack = (
	node: PHPParser.Block,
	parent: PHPParser.Block | null,
	callback?: PHPParserWalkCallBack,
) => void;

export type AnyAstNode = AstNodeMap[keyof AstNodeMap];

export type AstBaseNode<T extends PHPParser.Node = PHPParser.Node> = T & {
	ast: Ast;
	name: string;
	parent: AstBaseNode<AnyAstNode> | null;

	attributes: { [key: string]: any };
	record: RecordBase | null;

	trace: () => void;
	lookup: (level?: number | null, variableName?: string) => RecordBase | null;

	hasAttribute: (name: string) => boolean;
	getAttribute: (name: string) => string;
	setAttribute: (name: string, value: string) => void;
	recordReplacement: (value: string) => void;
};

export type AstNode<T extends PHPParser.Node = PHPParser.Node> = AstBaseNode<T> & {
	parent: AstNode<AnyAstNode> | null;
	scope: ScopeNode;
};

export type ScopeNode<
	T extends PHPParser.Node =
		| PHPParser.Program
		| PHPParser.Function
		| PHPParser.Method
		| PHPParser.Closure
		| PHPParser.Block
		| PHPParser.Class,
> = AstBaseNode<T> & {
	scope: ScopeNode;
	getRecord(name: string): RecordVariable | null;
	getCache(): Map<string, RecordVariable>;
	setCache(record: RecordBase, name?: string): void;
	boundary: (level?: number | null) => ScopeNode | null;
};

export interface AstNodeMap {
	node: PHPParser.Node;
	variable: PHPParser.Variable;
	assign: PHPParser.Assign;
	foreach: PHPParser.Foreach;
	function: PHPParser.Function;
	class: PHPParser.Class;
	method: PHPParser.Method;
	parameter: PHPParser.Parameter;
	global: PHPParser.Global;
	staticvariable: PHPParser.StaticVariable;
	catch: PHPParser.Catch;
	use: PHPParser.UseItem;
	closure: PHPParser.Closure;
	arrowfunc: PHPParser.ArrowFunc;
	static: PHPParser.Static;
	return: PHPParser.Return;
	silent: PHPParser.Silent;
	encapsed: PHPParser.Encapsed;
	encapsedpart: PHPParser.EncapsedPart;
	string: PHPParser.String;
	constant: PHPParser.Constant;
	constantstatement: PHPParser.ConstantStatement;
	classconstant: PHPParser.ClassConstant;
	property: PHPParser.Property;
	propertylookup: PHPParser.PropertyLookup;
	propertystatement: PHPParser.PropertyStatement;
	attribute: PHPParser.Attribute;
	attrgroup: PHPParser.AttrGroup;
	enumcase: PHPParser.EnumCase;
	nowdoc: PHPParser.NowDoc;
	call: PHPParser.Call;
	identifier: PHPParser.Identifier;
	name: PHPParser.Name;
	selfreference: PHPParser.SelfReference;
	staticlookup: PHPParser.StaticLookup;
	new: PHPParser.New;
	list: PHPParser.List;
	entry: PHPParser.Entry;
	block: PHPParser.Block;
	bin: PHPParser.Bin;
	expression: PHPParser.Expression;
	array: PHPParser.Array;
}

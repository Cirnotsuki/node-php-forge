import { uuidv4 } from '@ka-libs/crypto';
import { Runtime } from '../core/runtime';
import { Ast } from '../core/ast';
import { BuildClass, BuildContext } from '../core/buildOption';
import { RecordVariable, RecordFunction, RecordIdentifier } from '../core/recordNode';
import { isKind, typedAstNode } from '../utils/typeGard';
import { fileIterator, getRaw, scanPHPFile } from '../utils/utils';
import { CONST_PREFIX } from '../config/constans';
import { AstNode } from '../types';
import PhpParser from 'php-parser';
import { randomPrefix } from '../utils/randomPrefix';
import hookArgTypes from '../config/hookArgTypes';
import { getNodeName } from '../utils/helper';
import { findBuildClass, findSelfBuildClass } from '../utils/pipeUtil';
export default async function (buildContext: BuildContext) {
	const ROOT_DIR = buildContext.distDir;
	const { functions, classes, constants } = Runtime.options;
	const { settings } = Runtime;

	// const classes = Runtime.options.classes;
	function handleCallableClassMethod(list: AstNode<PhpParser.List | PhpParser.Array>) {
		if (!settings.classes) return;

		if (list.items.length !== 2) return;

		if (!isKind(list.items[0], 'entry') || !isKind(list.items[1], 'entry')) return;
		const classNode = list.items[0].value;
		const methodNode = list.items[1].value;

		if (!isKind(classNode, 'string') || !isKind(methodNode, 'string')) return;

		const classRecord = classes.get(classNode.value);
		if (!classRecord) return;
		if (!classRecord.methods.has(methodNode.value)) return;

		classNode.recordReplacement(`"${classRecord.name.replace}"`);
		methodNode.recordReplacement(`"${classRecord.methods.get(methodNode.value)!.replace}"`);
	}
	function handleHookCall(callNode: AstNode<PhpParser.Call>) {
		const hookName = getNodeName(callNode.what.name);
		const types = hookArgTypes.get(hookName);

		if (!types) {
			Runtime.options.hooks.add(hookName);
			return;
		}

		const argIndex = types.findIndex((type) => type === 'callable');
		if (argIndex < 0) return;

		const argNode = callNode.arguments[argIndex];
		if (!argNode) return;

		if (isKind(argNode, 'array') || isKind(argNode, 'list')) {
			handleCallableClassMethod(argNode);
			return;
		}

		if (!isKind(argNode, 'string')) return;
		if (!settings.functions) return;

		const functionRecord = functions.get(argNode.value);
		if (functionRecord) {
			argNode.recordReplacement(`"${functionRecord.replace}"`);
		}
	}

	function handleGlobalCall(call: AstNode<PhpParser.Call>) {
		if (!isKind(call.what, 'name')) return;
		const fName = getNodeName(call.what.name);

		if (functions.has(fName)) {
			if (settings.functions) {
				const record = functions.get(fName)!;
				call.what.recordReplacement(record.replace);
			}
		} else {
			handleHookCall(call);
		}
	}

	function handleStaticCallable(array: AstNode<PhpParser.Array>) {
		if (!settings.classes) return;

		if (array.items.length !== 2) return;

		if (!isKind(array.items[0], 'entry')) return;

		const staticlookup = array.items[0].value;
		if (!isKind(staticlookup, 'staticlookup')) return;

		const identifier = staticlookup.offset;
		if (!isKind(identifier, 'identifier')) return;

		const what = typedAstNode(staticlookup.what);

		const offset = getNodeName(identifier.name);
		if (offset !== 'class') return;

		const buildClass = findBuildClass(what);
		if (!buildClass) return;

		const method = array.items[1];
		if (!isKind(method, 'entry')) return;

		const methodNode = method.value;

		if (!isKind(methodNode, 'string')) return;

		const methodRecord = buildClass.methods.get(methodNode.value);
		if (!methodRecord) return;

		methodNode.recordReplacement(`"${methodRecord.replace}"`);
	}

	function handleDefine(node: AstNode<PhpParser.Name>) {
		if (!settings.constants) return;

		const name = getNodeName(node.name);
		if (!constants.has(name)) return;

		node.recordReplacement(constants.get(name)!);
	}

	// 记录替换，只处理静态属性
	await fileIterator(await scanPHPFile(ROOT_DIR), async (file) => {
		const ast = Ast.create(file);

		ast.walk((node) => {
			if (isKind(node, 'call')) {
				handleGlobalCall(node);
				return;
			}
			if (isKind(node, 'array') || isKind(node, 'list')) {
				handleStaticCallable(node);
				return;
			}

			if (isKind(node, 'name')) {
				handleDefine(node);
				return;
			}
		});

		ast.applyReplacements();
	});
}

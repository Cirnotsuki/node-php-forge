export default new Map<string, Array<'string' | 'callable' | 'int' | 'int|float'>>([
	['add_action', ['string', 'callable', 'int', 'int']],
	['add_filter', ['string', 'callable', 'int', 'int']],
	['add_submenu_page', ['string', 'string', 'string', 'string', 'string', 'callable', 'int|float']],
]);

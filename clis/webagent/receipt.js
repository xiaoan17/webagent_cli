import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    getSessionReceipt,
    requirePositiveInt,
} from './utils.js';

export const receiptCommand = cli({
    site: 'webagent',
    name: 'receipt',
    access: 'read',
    description: 'Show the latest WebAgent task receipt, artifacts, and follow-up actions',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'turns', type: 'int', default: 10, help: 'Number of recent turns to inspect (default: 10)' },
    ],
    columns: ['session_id', 'url', 'receipt', 'response', 'artifacts', 'evolve', 'next_actions'],
    func: async (page, kwargs) => {
        const turns = requirePositiveInt(
            Number(kwargs.turns ?? 10),
            'webagent receipt --turns',
            'Example: opencli webagent receipt <id> --turns 10',
        );
        const result = await getSessionReceipt(page, kwargs.id, { turns });
        return [{
            session_id: result.session.id,
            url: result.url,
            receipt: result.receipt,
            response: result.response,
            artifacts: result.artifacts,
            evolve: result.evolve,
            next_actions: result.next_actions,
        }];
    },
});

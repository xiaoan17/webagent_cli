import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    WEBAGENT_DOMAIN,
    getSession,
    requirePositiveInt,
} from './utils.js';

export const detailCommand = cli({
    site: 'webagent',
    name: 'detail',
    access: 'read',
    description: 'Read a WebAgent session by ID or URL',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'turns', type: 'int', default: 10, help: 'Number of recent turns to fetch (default: 10)' },
    ],
    columns: ['role', 'text'],
    func: async (page, kwargs) => {
        const turns = requirePositiveInt(
            Number(kwargs.turns ?? 10),
            'webagent detail --turns',
            'Example: opencli webagent detail <id> --turns 10',
        );
        const session = await getSession(page, kwargs.id, { turns });
        if (!session.messages.length) {
            throw new EmptyResultError(
                'webagent detail',
                `No text messages found in WebAgent session ${session.id}.`,
            );
        }
        return session.messages.map((message) => ({
            role: message.role,
            text: message.text,
        }));
    },
});

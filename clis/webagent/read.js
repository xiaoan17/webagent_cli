import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    WEBAGENT_DOMAIN,
    getCurrentSessionId,
    getSession,
    requirePositiveInt,
} from './utils.js';

export const readCommand = cli({
    site: 'webagent',
    name: 'read',
    access: 'read',
    description: 'Read the current WebAgent session from the browser URL',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'turns', type: 'int', default: 10, help: 'Number of recent turns to fetch (default: 10)' },
    ],
    columns: ['role', 'text'],
    func: async (page, kwargs) => {
        const turns = requirePositiveInt(
            Number(kwargs.turns ?? 10),
            'webagent read --turns',
            'Example: opencli webagent read --turns 10',
        );
        const id = await getCurrentSessionId(page);
        if (!id) {
            throw new EmptyResultError(
                'webagent read',
                'The current browser tab is not a WebAgent chat URL. Use `opencli webagent detail <id>` for a specific session.',
            );
        }
        const session = await getSession(page, id, { turns });
        if (!session.messages.length) {
            throw new EmptyResultError('webagent read', `No text messages found in WebAgent session ${id}.`);
        }
        return session.messages.map((message) => ({
            role: message.role,
            text: message.text,
        }));
    },
});

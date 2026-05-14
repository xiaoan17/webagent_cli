import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    requireNonEmptyPrompt,
    requirePositiveInt,
    sendToSession,
} from './utils.js';

export const sendCommand = cli({
    site: 'webagent',
    name: 'send',
    access: 'write',
    description: 'Send a prompt to an existing WebAgent session',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to keep the stream open (default: 120)' },
        { name: 'file', valueRequired: true, multiple: true, help: 'Attach a local file' },
        { name: 'data', valueRequired: true, multiple: true, help: 'Attach inline text data as a generated .txt file' },
        { name: 'data-file', valueRequired: true, multiple: true, help: 'Attach a local data file' },
    ],
    columns: ['status', 'session_id', 'response', 'files'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'webagent');
        const timeoutSeconds = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'webagent send --timeout',
            'Example: opencli webagent send <id> "continue" --timeout 120',
        );
        const result = await sendToSession(page, kwargs.id, prompt, {
            timeoutSeconds,
            files: kwargs.file,
            data: kwargs.data,
            dataFiles: kwargs['data-file'],
        });
        return [{
            status: result.status || 'sent',
            session_id: result.sessionId || kwargs.id,
            response: result.response || null,
            files: result.files?.map((file) => file.name).join(', ') || null,
        }];
    },
});

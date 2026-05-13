import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    WEBAGENT_DOMAIN,
    createSession,
    ensureAssistantResponse,
    parseBoolFlag,
    requireNonEmptyPrompt,
    requirePositiveInt,
    sendToSession,
} from './utils.js';

export const askCommand = cli({
    site: 'webagent',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to WebAgent and wait for the response',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send to WebAgent' },
        { name: 'id', help: 'Continue an existing WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response (default: 120)' },
        { name: 'new', type: 'boolean', default: true, help: 'Start a new session when --id is not provided (default: true)' },
        { name: 'project-id', help: 'Optional WebAgent project_id to attach to a new session' },
        { name: 'agent-type', default: 'opencode', help: 'WebAgent config.agent_type for new sessions (default: opencode)' },
    ],
    columns: ['response', 'session_id', 'url'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'webagent');
        const timeoutSeconds = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'webagent ask --timeout',
            'Example: opencli webagent ask "hello" --timeout 120',
        );
        const id = String(kwargs.id || '').trim();
        const startNew = parseBoolFlag(kwargs.new, true);
        if (!id && !startNew) {
            throw new ArgumentError(
                'webagent ask --new false requires --id',
                'Pass --id <sessionId> to continue an existing session, or omit --new to start a new one.',
            );
        }
        const result = id
            ? await sendToSession(page, id, prompt, { timeoutSeconds })
            : await createSession(page, prompt, {
                timeoutSeconds,
                projectId: kwargs['project-id'],
                agentType: kwargs['agent-type'] || 'opencode',
            });
        const response = ensureAssistantResponse(result, 'webagent ask');
        return [{
            response,
            session_id: result.sessionId || null,
            url: result.sessionId ? `https://agent.famou.com/chat/${result.sessionId}` : null,
        }];
    },
});

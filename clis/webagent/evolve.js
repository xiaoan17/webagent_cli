import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    dismissEvolutionSuggestion,
    parseBoolFlag,
    parseWebAgentFeedback,
    receiptOutputFields,
    requirePositiveInt,
    startEvolution,
} from './utils.js';

export const evolveCommand = cli({
    site: 'webagent',
    name: 'evolve',
    access: 'write',
    description: 'Start or dismiss the latest WebAgent deep-evolution suggestion',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'later', type: 'boolean', default: false, help: 'Click the WebAgent "稍后再说" action instead of starting evolution' },
        { name: 'force', type: 'boolean', default: false, help: 'Send /evolve even if no suggestion card is found in the recent receipt' },
        { name: 'skip-check', type: 'boolean', default: false, help: 'Skip WebAgent evolution credit check before submitting' },
        { name: 'turns', type: 'int', default: 10, help: 'Number of recent turns to inspect for an evolution suggestion (default: 10)' },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds to wait for evolution response (default: 300)' },
    ],
    columns: ['status', 'session_id', 'url', 'response', 'credits', 'artifacts', 'evolve', 'next_actions'],
    func: async (page, kwargs) => {
        if (parseBoolFlag(kwargs.later, false)) {
            const result = await dismissEvolutionSuggestion(page, kwargs.id);
            const receipt = receiptOutputFields(result.sessionId, parseWebAgentFeedback(''));
            return [{
                status: result.status,
                session_id: result.sessionId,
                url: receipt.url,
                response: result.message,
                credits: null,
                artifacts: null,
                evolve: null,
                next_actions: receipt.next_actions,
            }];
        }
        const timeoutSeconds = requirePositiveInt(
            Number(kwargs.timeout ?? 300),
            'webagent evolve --timeout',
            'Example: opencli webagent evolve <id> --timeout 300',
        );
        const turns = requirePositiveInt(
            Number(kwargs.turns ?? 10),
            'webagent evolve --turns',
            'Example: opencli webagent evolve <id> --turns 10',
        );
        const result = await startEvolution(page, kwargs.id, {
            timeoutSeconds,
            turns,
            force: kwargs.force,
            skipCheck: kwargs['skip-check'],
        });
        const feedback = result.feedback || parseWebAgentFeedback(result.response || '');
        const receipt = receiptOutputFields(result.sessionId, feedback);
        const credits = result.creditCheck?.requiredCredits || result.creditCheck?.availableCredits
            ? `required=${result.creditCheck?.requiredCredits ?? ''}, available=${result.creditCheck?.availableCredits ?? ''}`
            : null;
        return [{
            status: result.status || 'submitted',
            session_id: result.sessionId,
            url: receipt.url,
            response: result.response || result.creditCheck?.message || null,
            credits,
            artifacts: receipt.artifacts,
            evolve: receipt.evolve,
            next_actions: receipt.next_actions,
        }];
    },
});

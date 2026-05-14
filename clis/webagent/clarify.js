import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    ensureAssistantResponse,
    parseWebAgentFeedback,
    receiptOutputFields,
    requirePositiveInt,
    submitClarification,
} from './utils.js';

export const clarifyCommand = cli({
    site: 'webagent',
    name: 'clarify',
    access: 'write',
    description: 'Submit answers to the latest WebAgent clarification card',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'answer', valueRequired: true, multiple: true, help: 'Override a clarification answer, e.g. --answer 1=是' },
        { name: 'note', valueRequired: true, help: 'Optional extra note appended as 补充说明' },
        { name: 'force', type: 'boolean', default: false, help: 'Submit even if the latest clarification already has a following user answer' },
        { name: 'turns', type: 'int', default: 20, help: 'Number of recent turns to inspect (default: 20)' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response (default: 120)' },
    ],
    columns: ['status', 'session_id', 'url', 'submitted', 'response', 'receipt', 'artifacts', 'evolve', 'next_actions'],
    func: async (page, kwargs) => {
        const timeoutSeconds = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'webagent clarify --timeout',
            'Example: opencli webagent clarify <id> --timeout 120',
        );
        const turns = requirePositiveInt(
            Number(kwargs.turns ?? 20),
            'webagent clarify --turns',
            'Example: opencli webagent clarify <id> --turns 20',
        );
        const result = await submitClarification(page, kwargs.id, {
            answers: kwargs.answer,
            note: kwargs.note,
            force: kwargs.force,
            turns,
            timeoutSeconds,
        });
        const response = ['already_submitted', 'submitted_pending'].includes(result.status)
            ? (result.response || null)
            : ensureAssistantResponse(result, 'webagent clarify');
        const feedback = parseWebAgentFeedback(response || '');
        const receipt = receiptOutputFields(result.sessionId || kwargs.id, feedback);
        return [{
            status: result.status || 'submitted',
            session_id: result.sessionId || kwargs.id,
            url: receipt.url,
            submitted: result.submittedText || null,
            response: feedback.cleanText || response,
            receipt: receipt.receipt,
            artifacts: receipt.artifacts,
            evolve: receipt.evolve,
            next_actions: receipt.next_actions,
        }];
    },
});

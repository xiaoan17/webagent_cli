import { describe, expect, it } from 'vitest';
import {
    extractAssistantTextFromEvents,
    isSessionDoneStatus,
    normalizeSessionMessages,
    parseSessionId,
    parseSseEvents,
} from './utils.js';

describe('webagent utils', () => {
    it('parses WebAgent session ids from ids and chat URLs', () => {
        expect(parseSessionId('abcDEF_12345')).toBe('abcDEF_12345');
        expect(parseSessionId('https://agent.famou.com/chat/sess_123456789')).toBe('sess_123456789');
        expect(parseSessionId('/chat/sess-abcdef12')).toBe('sess-abcdef12');
        expect(() => parseSessionId('https://example.com/chat/sess_123456789')).toThrow(/WebAgent chat URL/);
    });

    it('parses event_type SSE blocks into canonical event types', () => {
        const raw = [
            'id: e1',
            'event_type: text',
            'data: {"event_id":"evt-1","session_id":"s1","payload":{"partial":false,"content":"hello"}}',
            '',
            'id: e2',
            'event_type: status',
            'data: {"payload":{"status":"idle"},"seq":2}',
            '',
        ].join('\n');

        const events = parseSseEvents(raw, 'fallback');
        expect(events).toEqual([
            expect.objectContaining({
                event_id: 'evt-1',
                session_id: 's1',
                type: 'agent/text',
                payload: { partial: false, content: 'hello' },
            }),
            expect.objectContaining({
                event_id: 'e2',
                session_id: 'fallback',
                type: 'session/status',
                payload: { status: 'idle' },
                seq: 2,
            }),
        ]);
    });

    it('extracts final text and strips WebAgent suggestions markup', () => {
        const events = [
            { type: 'agent/text', payload: { partial: true, content: 'draft' } },
            { type: 'agent/text', payload: { partial: false, content: 'final <sag>{"suggestions":["x"]}</sag>' } },
        ];
        expect(extractAssistantTextFromEvents(events)).toBe('final');
    });

    it('falls back to partial text when no final text arrived', () => {
        const events = [
            { type: 'agent/text', payload: { partial: true, content: 'partial answer' } },
        ];
        expect(extractAssistantTextFromEvents(events)).toBe('partial answer');
    });

    it('normalizes history events into user and assistant rows', () => {
        const session = {
            events: [
                {
                    type: 'user/message',
                    payload: {
                        messages: [{
                            role: 'user',
                            content: [{ type: 'text', text: 'hi' }],
                        }],
                    },
                },
                {
                    type: 'agent/text',
                    payload: { partial: false, content: 'hello' },
                },
            ],
        };
        expect(normalizeSessionMessages(session)).toEqual([
            { role: 'user', text: 'hi' },
            { role: 'assistant', text: 'hello' },
        ]);
    });

    it('recognizes terminal session statuses', () => {
        expect(isSessionDoneStatus('idle')).toBe(true);
        expect(isSessionDoneStatus('running')).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';
import {
    extractAssistantTextFromEvents,
    isSessionDoneStatus,
    normalizeSessionMessages,
    parseSessionId,
    parseSseEvents,
    __test__,
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

    it('includes attached file names in normalized user rows', () => {
        const session = {
            events: [
                {
                    type: 'user/message',
                    payload: {
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: 'analyze this' },
                                { type: 'file', name: 'orders.csv', size: 12, url: 'https://example.com/orders.csv' },
                            ],
                        }],
                    },
                },
            ],
        };
        expect(normalizeSessionMessages(session)).toEqual([
            { role: 'user', text: 'analyze this\n[Attached file: orders.csv]' },
        ]);
    });

    it('recognizes terminal session statuses', () => {
        expect(isSessionDoneStatus('idle')).toBe(true);
        expect(isSessionDoneStatus('running')).toBe(false);
    });

    it('normalizes WebAgent project summaries', () => {
        expect(__test__.normalizeProjectSummary({
            projectId: 'p1',
            projectName: '生产排程',
            knowledge: [{ fileName: 'orders.xlsx' }],
            skills: [{ id: 's1' }],
            tasks: [{ id: 't1' }, { id: 't2' }],
            limit: { fileCount: 10, fileSize: 1024 * 1024 },
        })).toEqual({
            id: 'p1',
            name: '生产排程',
            file_count: 1,
            skill_count: 1,
            task_count: 2,
            created_at: '',
            file_limit: 10,
            size_limit: '1.00MB',
        });
    });

    it('builds WebAgent file message content', () => {
        expect(__test__.fileToMessageContent({
            name: 'orders.csv',
            size: 12,
            url: 'https://example.com/orders.csv',
        })).toEqual({
            type: 'file',
            name: 'orders.csv',
            size: 12,
            url: 'https://example.com/orders.csv',
        });
        expect(__test__.fileToMessageContent({
            name: 'chart.png',
            size: 34,
            fileType: 'image/png',
            url: 'https://example.com/chart.png',
        })).toEqual({
            type: 'image',
            name: 'chart.png',
            size: 34,
            mimeType: 'image/png',
            url: 'https://example.com/chart.png',
        });
    });

    it('appends inline CLI data to prompts', () => {
        const prompt = __test__.appendInlineDataToPrompt('summarize', [
            { name: 'orders.csv', source: '--data-file', text: 'company,segment\n宁德时代,动力电池\n' },
        ]);
        expect(prompt).toContain('summarize');
        expect(prompt).toContain('BEGIN CLI DATA: orders.csv (--data-file)');
        expect(prompt).toContain('宁德时代,动力电池');
        expect(prompt).toContain('END CLI DATA: orders.csv');
    });

    it('expands escaped newlines in inline data arguments', () => {
        expect(__test__.normalizeInlineDataText('company,segment\\n宁德时代,动力电池'))
            .toBe('company,segment\n宁德时代,动力电池');
    });
});

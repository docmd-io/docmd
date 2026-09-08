declare module 'docmd-assistant' {
  export interface AssistantOptions {
    endpoint?: string;
    projectId?: string;
    siteId?: string;
    provider?: string;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    systemPrompt?: string;
    history?: any[];
    tools?: any[];
    headers?: Record<string, string>;
    relayUrl?: string;
    [key: string]: any;
  }

  export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    sender?: string;
    timestamp?: number;
    [key: string]: any;
  }

  export interface ChatResponse {
    message: string;
    role: string;
    history: ChatMessage[];
    citations?: any[];
    provider?: string;
    model?: string;
    [key: string]: any;
  }

  export class DocmdAssistantEngine {
    constructor(options?: AssistantOptions);
    registerTool(tool: any): this;
    unregisterTool(name: string): boolean;
    getTools(): any[];
    getTool(name: string): any;
    setSystemPrompt(prompt: string): this;
    appendSystemPrompt(additionalPrompt: string): this;
    getSystemPrompt(): string;
    updateOptions(newOptions: Partial<AssistantOptions>): this;
    getHistory(): ChatMessage[];
    setHistory(history: ChatMessage[]): this;
    clearHistory(): this;
    addMessage(message: ChatMessage): this;
    on(event: string, listener: (...args: any[]) => any): this;
    off(event: string, listener: (...args: any[]) => any): this;
    emit(type: string, data: any): void;
    sendMessage(content: string, overrideOptions?: Partial<AssistantOptions>): Promise<ChatResponse>;
    executeTool(name: string, args: any): Promise<any>;
  }

  export function createStandardTools(
    customSearch?: (...args: any[]) => any,
    customReader?: (...args: any[]) => any
  ): any[];
}
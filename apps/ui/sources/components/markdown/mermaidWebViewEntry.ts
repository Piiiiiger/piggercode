import mermaid from 'mermaid';
import { removeMermaidNavigation } from './mermaidSanitize';

declare global {
    var PIGGERCODE_MERMAID: typeof mermaid | undefined;
    var PIGGERCODE_MERMAID_REMOVE_NAVIGATION: typeof removeMermaidNavigation | undefined;
}

globalThis.PIGGERCODE_MERMAID = mermaid;
globalThis.PIGGERCODE_MERMAID_REMOVE_NAVIGATION = removeMermaidNavigation;

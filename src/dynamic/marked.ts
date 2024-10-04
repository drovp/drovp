import {marked} from 'marked';
import {sanitize as DOMPurifySanitize} from 'dompurify';
export const toHTML = marked.parse;
export const sanitize = DOMPurifySanitize;

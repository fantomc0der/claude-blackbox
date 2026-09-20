import { createMemo, createSignal, onSettled } from "solid-js";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface MarkdownProps {
  content: string;
  highlight?: string;
}

function highlightHtml(html: string, query?: string): string {
  if (!query?.trim() || typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  for (const textNode of nodes) {
    const value = textNode.nodeValue ?? "";
    expression.lastIndex = 0;
    if (!expression.test(value)) continue;
    expression.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of value.matchAll(expression)) {
      const index = match.index ?? 0;
      fragment.append(value.slice(offset, index));
      const mark = document.createElement("mark");
      mark.textContent = match[0];
      fragment.append(mark);
      offset = index + match[0].length;
    }
    fragment.append(value.slice(offset));
    textNode.replaceWith(fragment);
  }
  return template.innerHTML;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeLinkAttributes(html: string): string {
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const link of template.content.querySelectorAll("a")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  return template.innerHTML;
}

export function Markdown(props: MarkdownProps) {
  const [settled, setSettled] = createSignal(false);
  onSettled(() => {
    setSettled(true);
  });

  const html = createMemo(() => {
    const renderer = new marked.Renderer();
    renderer.image = ({ text }) => `<span data-blocked-image="true">Image blocked${text ? `: ${escapeHtml(text)}` : ""}</span>`;
    const parsed = marked.parse(props.content, { async: false, gfm: true, breaks: true, renderer }) as string;
    const sanitized = DOMPurify.sanitize(parsed, {
      ALLOWED_TAGS: ["a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
      ALLOWED_ATTR: ["data-blocked-image", "href", "rel", "target", "title"],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i,
    });
    const linked = safeLinkAttributes(sanitized);
    return settled() ? highlightHtml(linked, props.highlight) : linked;
  });

  return <div class="md-content" innerHTML={html()} />;
}

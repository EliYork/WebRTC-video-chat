// Minimal DOM for deterministic presentation tests. Browser geometry is tested
// separately with the actual rendered template, CSS and entry point.
export class Element {
    constructor(tag = 'div', ownerDocument) {
        this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument;
        this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map();
        this.style = {}; this.scrollTop = 0; this.paused = false;
        const values = new Set();
        this.classList = {
            add: (...items) => items.forEach((item) => values.add(item)),
            remove: (...items) => items.forEach((item) => values.delete(item)),
            contains: (item) => values.has(item),
            toggle: (item, force = !values.has(item)) => force ? values.add(item) : values.delete(item),
            values,
        };
    }
    set className(value) { this.classList.values.clear(); value.split(/\s+/).filter(Boolean).forEach((item) => this.classList.add(item)); }
    get className() { return [...this.classList.values].join(' '); }
    get isConnected() { return this === this.ownerDocument?.body || Boolean(this.parentElement?.isConnected); }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    append(...items) { items.forEach((item) => { item.remove(); item.parentElement = this; this.children.push(item); }); }
    prepend(item) { item.remove(); item.parentElement = this; this.children.unshift(item); }
    replaceChildren(...items) { [...this.children].forEach((item) => item.remove()); this.append(...items); }
    before(item) { const host = this.parentElement; item.remove(); item.parentElement = host; host.children.splice(host.children.indexOf(this), 0, item); }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    matches(selector) {
        return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) {
        return this.children.flatMap((child) => [...(selector.split(',').some((part) => child.matches(part.trim())) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    click() { this.listeners.get('click')?.forEach((handler) => handler({ target: this, preventDefault() {}, stopPropagation() {} })); }
    focus() { this.ownerDocument.activeElement = this; }
    play() { this.playCount = (this.playCount || 0) + 1; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
}
export const createDocument = () => {
    const document = { createElement: (tag) => new Element(tag, document), createTextNode: (text) => { const node = new Element('text', document); node.textContent = text; return node; } };
    document.body = document.createElement('body');
    document.getElementById = (id) => document.body.querySelector(`#${id}`);
    return document;
};

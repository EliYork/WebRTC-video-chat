export function createDocument() {
    const document = { hidden: false, listeners: new Map(), activeElement: null };
    class Element {
        constructor(tag) { this.tagName = tag.toUpperCase(); }
        children = []; attributes = {}; listeners = new Map(); className = ''; dataset = {};
        hidden = false; open = false; value = ''; textContent = ''; style = {};
        append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
        replaceChildren(...nodes) { this.children.forEach((node) => { node.parentElement = null; }); this.children = []; this.append(...nodes); }
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
        setAttribute(key, value) { this.attributes[key] = String(value); }
        getAttribute(key) { return this.attributes[key]; }
        removeAttribute(key) { delete this.attributes[key]; }
        addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
        removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== fn)); }
        dispatchEvent(event) { event.target ||= this; event.preventDefault ||= () => { event.defaultPrevented = true; }; event.stopPropagation ||= () => { event.stopped = true; }; for (const fn of this.listeners.get(event.type) || []) fn(event); return !event.defaultPrevented; }
        matches(selector) { return selector.split(',').some((value) => { value = value.trim(); return value[0] === '.' ? this.className.split(' ').includes(value.slice(1)) : value === this.tagName.toLowerCase(); }); }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
        contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
        querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0]; }
        focus() { document.activeElement = this; }
        click() { this.dispatchEvent({ type: 'click' }); }
        showModal() { this.open = true; }
        close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
        getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }; }
        get isConnected() { return document.body.contains(this); }
    }
    document.createElement = (tag) => new Element(tag);
    document.body = new Element('body');
    document.addEventListener = Element.prototype.addEventListener.bind(document);
    document.removeEventListener = Element.prototype.removeEventListener.bind(document);
    document.dispatchEvent = Element.prototype.dispatchEvent.bind(document);
    return document;
}
export function allText(element) { return [element.textContent, ...element.children.map(allText)].join(' '); }

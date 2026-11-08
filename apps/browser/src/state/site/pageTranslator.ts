
export type Passage = [number, [number, string][]];

const KEY = `window[Symbol.for("ardia.translator")]`;

const INSTALL = String.raw`
const KEY = Symbol.for("ardia.translator");
if (!window[KEY]) {
  const SKIP = "script,style,noscript,template,code,pre,kbd,samp,var,textarea,input,select,option,svg,math,iframe,[contenteditable]:not([contenteditable=false]),[translate=no],.notranslate";
  const BLOCK = "p,li,dd,dt,td,th,caption,figcaption,blockquote,h1,h2,h3,h4,h5,h6,summary,legend,label,button,div,section,article,aside,header,footer,main,nav,form,fieldset,details,dialog,body";
  const LETTER = /\p{L}/u;
  const MAX_WATCHED = 20000;
  const MAX_TEXT = 20000;
  const MAX_PIECES = 40;
  const MAX_RETRIES = 2;
  const MARGIN = 300;
  const ENDS_IN_SPACE = /\s$/;
  const STARTS_WITH_SPACE = /^\s/;
  const skipCache = new WeakMap();
  const skipped = (el) => {
    if (!el) return true;
    let v = skipCache.get(el);
    if (v === undefined) skipCache.set(el, (v = !!el.closest(SKIP)));
    return v;
  };
  const blockCache = new WeakMap();
  const blockOf = (el) => {
    let b = blockCache.get(el);
    if (b === undefined) blockCache.set(el, (b = el.closest(BLOCK) || document.documentElement));
    return b;
  };
  const root = () => document.body || document.documentElement;
  const t = (window[KEY] = {
    active: false,
    token: null,
    letter: LETTER,
    seq: 0,
    done: 0,
    records: new Map(),
    byId: new Map(),
    queue: [],
    queued: new Set(),
    later: [],
    waiting: new Set(),
    retries: new WeakMap(),
    watched: new WeakSet(),
    shown: new WeakSet(),
    watchedCount: 0,
    observer: null,
    visibility: null,
    waiters: [],
    eligible(n) {
      return n.nodeType === 3 && n.nodeValue.length <= MAX_TEXT && this.letter.test(n.nodeValue) && !skipped(n.parentElement);
    },
    sample() {
      const w = document.createTreeWalker(root(), NodeFilter.SHOW_TEXT);
      let text = "";
      for (let n = w.nextNode(), i = 0; n && text.length < 2500 && i < 20000; n = w.nextNode(), i++)
        if (n.nodeValue.length <= MAX_TEXT && LETTER.test(n.nodeValue) && !skipped(n.parentElement)) text += n.nodeValue.trim() + " ";
      return { lang: document.documentElement.lang || "", text, active: this.active };
    },
    wake() {
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
    },
    enqueue(block) {
      if (this.queued.has(block)) return;
      this.waiting.delete(block);
      this.queued.add(block);
      this.queue.push(block);
      this.wake();
    },
    defer(block) {
      if (this.queued.has(block) || this.waiting.has(block)) return;
      this.waiting.add(block);
      this.later.push(block);
      if (!this.watched.has(block) && this.watchedCount < MAX_WATCHED) {
        this.watched.add(block);
        this.watchedCount++;
        this.visibility.observe(block);
      }
      this.wake();
    },
    track(node) {
      const blocks = new Set();
      if (node.nodeType === 3) {
        if (this.eligible(node)) blocks.add(blockOf(node.parentElement));
      } else if (node.nodeType === 1 && !skipped(node)) {
        const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (this.eligible(n)) blocks.add(blockOf(n.parentElement));
      }
      const top = -MARGIN, bottom = innerHeight + MARGIN;
      for (const b of blocks) {
        if (this.shown.has(b)) this.enqueue(b);
        else {
          const r = b.getBoundingClientRect();
          if (r.bottom >= top && r.top <= bottom && (r.width || r.height)) {
            this.shown.add(b);
            this.enqueue(b);
          } else this.defer(b);
        }
      }
    },
    pieces(block) {
      const out = [];
      const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let separated = false;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeType === 1) {
          if (n.tagName === "BR") separated = true;
        } else if (this.eligible(n) && !this.records.has(n) && blockOf(n.parentElement) === block) {
          const previous = out[out.length - 1];
          const gap = !!previous && separated && !ENDS_IN_SPACE.test(previous.node.nodeValue) && !STARTS_WITH_SPACE.test(n.nodeValue);
          out.push({ node: n, gap });
          separated = false;
        } else if (n.nodeValue.length) separated = true;
      }
      return out;
    },
    release(node) {
      this.records.delete(node);
      const tries = (this.retries.get(node) || 0) + 1;
      this.retries.set(node, tries);
      if (tries <= MAX_RETRIES && node.isConnected) this.track(node);
    },
    start(token, letters) {
      if (this.active) return this.token === token;
      this.active = true;
      this.token = token;
      try {
        this.letter = letters ? new RegExp(letters, "u") : LETTER;
      } catch {
        this.letter = LETTER;
      }
      this.visibility = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          this.visibility.unobserve(e.target);
          this.watched.delete(e.target);
          this.shown.add(e.target);
          if (this.waiting.has(e.target)) this.enqueue(e.target);
        }
      }, { rootMargin: MARGIN + "px 0px" });
      this.track(root());
      this.observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "characterData") {
            const rec = this.records.get(m.target);
            if (rec && m.target.nodeValue === rec.applied) continue;
            if (rec) this.records.delete(m.target);
            this.track(m.target);
          } else for (const n of m.addedNodes) this.track(n);
        }
      });
      this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      return true;
    },
    take() {
      while (this.queue.length) {
        const block = this.queue.shift();
        this.queued.delete(block);
        if (block.isConnected) return block;
      }
      while (this.later.length) {
        const block = this.later.shift();
        if (!this.waiting.delete(block)) continue;
        if (block.isConnected) return block;
      }
      return null;
    },
    next(token, max, maxChars) {
      if (!this.active || this.token !== token) return { passages: [], more: false, gone: true, done: 0, total: 0 };
      const passages = [];
      let chars = 0;
      for (let block; passages.length < max && chars < maxChars && (block = this.take()); ) {
        const nodes = this.pieces(block);
        for (let i = 0; i < nodes.length; i += MAX_PIECES) {
          const pieces = [];
          let previous = null;
          for (const { node, gap } of nodes.slice(i, i + MAX_PIECES)) {
            const id = ++this.seq;
            const spaced = gap && previous !== null;
            if (spaced) previous.gapAfter = true;
            previous = { orig: node.nodeValue, applied: null, gapBefore: spaced, gapAfter: false };
            this.byId.set(id, node);
            this.records.set(node, previous);
            pieces.push([id, spaced ? " " + node.nodeValue : node.nodeValue]);
            chars += node.nodeValue.length;
          }
          passages.push([++this.seq, pieces]);
        }
      }
      this.done += passages.length;
      const left = this.queue.length + this.waiting.size;
      return { passages, more: left > 0, gone: false, done: this.done, total: this.done + left };
    },
    wait(token, ms) {
      if (!this.active || this.token !== token) return "gone";
      if (this.queue.length || this.waiting.size) return "work";
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== done);
          resolve("idle");
        }, ms);
        const done = () => {
          clearTimeout(timer);
          resolve(this.active && this.token === token ? "work" : "gone");
        };
        this.waiters.push(done);
      });
    },
    apply(results) {
      for (const [id, text] of results) {
        const node = this.byId.get(id);
        this.byId.delete(id);
        const rec = node && this.records.get(node);
        if (!rec || rec.applied !== null || !node.isConnected || node.nodeValue !== rec.orig) continue;
        if (typeof text !== "string") {
          this.release(node);
          continue;
        }
        const [, textLead, body, textTrail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const origLead = rec.orig.match(/^\s*/)[0];
        const origTrail = rec.orig.match(/\s*$/)[0];
        rec.applied = (origLead || (rec.gapBefore ? "" : textLead)) + body + (origTrail || (rec.gapAfter ? "" : textTrail));
        node.nodeValue = rec.applied;
      }
      return true;
    },
    revert() {
      this.active = false;
      this.token = null;
      this.letter = LETTER;
      if (this.observer) this.observer.disconnect();
      if (this.visibility) this.visibility.disconnect();
      this.observer = this.visibility = null;
      this.queue = [];
      this.queued = new Set();
      this.later = [];
      this.waiting = new Set();
      this.watched = new WeakSet();
      this.shown = new WeakSet();
      this.retries = new WeakMap();
      this.watchedCount = this.done = 0;
      this.wake();
      for (const [node, rec] of this.records) if (rec.applied !== null && node.nodeValue === rec.applied) node.nodeValue = rec.orig;
      this.records.clear();
      this.byId.clear();
      return true;
    },
  });
}
`;

type Installing = "sample" | "start";
type Op = Installing | "next" | "wait" | "apply" | "revert";

export function translatorCall(op: Op, ...args: unknown[]): string {
  const call = `Promise.resolve(${KEY} ? ${KEY}.${op}(...${JSON.stringify(args)}) : null).then((r) => post("result", JSON.stringify(r)), () => post("result", "null"));`;
  return op === "sample" || op === "start" ? `${INSTALL}\n${call}` : call;
}

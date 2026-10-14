/**
 * "Import from a browser tab": a bookmarklet the user clicks while viewing a
 * song page in their own browser. It reads what that page already shows and
 * opens GuitarCoach with the data in the URL fragment (#…), which browsers
 * never send to any server. No credentials, cookies or hidden data are read.
 */

import { nowIso } from "../song/model";
import type { ImportedContent } from "./types";
import { extractFromPageData } from "./adapters/ultimateGuitar";
import type { UgTab, UgTabView } from "./adapters/ugData";

export const HASH_KEY = "gc-import=";

export interface BookmarkletPayload {
  v: 1;
  url: string;
  title?: string;
  /** Present on Ultimate Guitar pages: the page's own song data. */
  ug?: { tab?: UgTab; tab_view?: UgTabView };
  /** Selected text, or the page's main text, for any other site. */
  text?: string;
  selection?: boolean;
}

export function bookmarkletSource(appOrigin: string): string {
  const code = `(function(){var A=${JSON.stringify(appOrigin)};var d={v:1,url:location.href,title:document.title};try{var e=document.querySelector('.js-store');if(e){var s=JSON.parse(e.getAttribute('data-content'));var p=s.store.page.data,t=p.tab||{},w=p.tab_view||{};if(t.tab_access_type&&t.tab_access_type!=='public'){alert('GuitarCoach: this version is paid content, so it is not imported.');return;}d.ug={tab:t,tab_view:{wiki_tab:w.wiki_tab,meta:w.meta,strummings:w.strummings,applicature:w.applicature,versions:w.versions,stats:w.stats,contributors:(w.contributors||[]).length,ug_difficulty:w.ug_difficulty}};}}catch(x){}if(!d.ug||!d.ug.tab_view||!d.ug.tab_view.wiki_tab||!d.ug.tab_view.wiki_tab.content){d.ug=undefined;var g=String(getSelection()||'');var pre=document.querySelector('pre');d.selection=g.length>20;d.text=(d.selection?g:(pre?pre.innerText:document.body.innerText)).slice(0,200000);}var j=JSON.stringify(d);var b=btoa(unescape(encodeURIComponent(j)));window.open(A+'/add#${HASH_KEY}'+b,'_blank');})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function decodePayload(hash: string): BookmarkletPayload | null {
  const i = hash.indexOf(HASH_KEY);
  if (i < 0) return null;
  try {
    const b64 = hash.slice(i + HASH_KEY.length);
    const bin = atob(decodeURIComponent(b64));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const d = JSON.parse(json) as BookmarkletPayload;
    if (d?.v !== 1 || typeof d.url !== "string") return null;
    return d;
  } catch {
    return null;
  }
}

export function encodePayload(p: BookmarkletPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return HASH_KEY + btoa(bin);
}

export function contentFromPayload(p: BookmarkletPayload): ImportedContent | null {
  let host = "";
  try {
    host = new URL(p.url).hostname;
  } catch {
    host = "";
  }
  if (p.ug?.tab_view?.wiki_tab?.content) {
    try {
      const c = extractFromPageData(p.ug, p.url);
      return { ...c, hints: [`Imported from your open browser tab on ${nowIso().slice(0, 10)}.`, ...c.hints] };
    } catch {
      return null;
    }
  }
  if (p.text && p.text.trim()) {
    return {
      adapterId: "browser-tab",
      site: host || "Browser tab",
      url: p.url,
      title: p.title?.split(/[|–—-]/)[0]?.trim(),
      text: p.text,
      format: "auto",
      meta: {},
      hints: p.selection
        ? ["Imported from the text you selected in your browser."]
        : ["Imported the whole page's text. Remove anything that isn't part of the song (menus, comments) before saving."],
    };
  }
  return null;
}

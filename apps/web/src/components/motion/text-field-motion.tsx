"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { SPRING_CARET } from "@/lib/ease";
import { textCompletion } from "@/lib/text-completion";

type TextField = HTMLInputElement | HTMLTextAreaElement;
function textField(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement && ["text", "search", "tel", "email", "url", "password"].includes(target.type)) return target;
  return null;
}
const subscribeBody = () => () => {};
const clientBody = () => document.body;
const serverBody = () => null;

function completion(field: TextField) {
  if (field.disabled || field.readOnly || field.type === "password" || field.dataset.textCompletion === "off" || /password/.test(field.autocomplete) || field.getAttribute("aria-expanded") === "true") return null;
  const explicit = field.dataset.textSuggestion;
  const options = field instanceof HTMLInputElement && field.list
    ? Array.from(field.list.options, (option) => option.value)
    : [];
  return textCompletion({
    value: field.value,
    // A datalist or an explicit suggestion takes precedence over its hint.
    suggestions: explicit ? [explicit] : options.length ? options : [field.placeholder],
    start: field.selectionStart ?? (field.value === "" ? 0 : null),
    end: field.selectionEnd ?? (field.value === "" ? 0 : null),
    maxLength: field.maxLength,
  });
}

/** One focused-field painter covers native fields, shared primitives and portals.
 * It never wraps a field or takes ownership of its value, ref or form events.
 * The native editor still owns selection, IME, undo, autofill and validation. */
export function TextFieldMotion() {
  const body = useSyncExternalStore(subscribeBody, clientBody, serverBody);
  const layerRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, SPRING_CARET);
  const springY = useSpring(y, SPRING_CARET);
  const opacity = useMotionValue(0);
  const height = useMotionValue(0);

  useEffect(() => {
    const layer = layerRef.current;
    const origin = originRef.current;
    const mirror = mirrorRef.current;
    const ghost = ghostRef.current;
    const status = statusRef.current;
    if (!body || !layer || !origin || !mirror || !ghost || !status) return;
    let active: TextField | null = null;
    let composing = false;
    let shown = false;
    let frame = 0;
    let lastMeasurement = "";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const hide = () => {
      active?.removeAttribute("data-smooth-caret-active");
      opacity.set(0);
      shown = false;
      ghost.textContent = "";
    };
    const update = () => {
      const field = active;
      if (!field || !field.isConnected || document.activeElement !== field) {
        hide();
        active = null;
        return;
      }
      const suggestion = composing ? null : completion(field);
      const announcement = suggestion ? `Suggestion: ${suggestion}. Press Tab to complete.` : "";
      if (status.textContent !== announcement) status.textContent = announcement;
      // Email and URL editors do not expose selection coordinates. Keep their
      // native caret rather than painting an incorrect one at the end.
      if (composing || field.disabled || field.readOnly || field.selectionStart === null || field.selectionStart !== field.selectionEnd || field.closest("[inert]")) {
        hide();
        return;
      }
      const rect = field.getBoundingClientRect();
      const scaleX = rect.width / field.offsetWidth || 1;
      const scaleY = rect.height / field.offsetHeight || 1;
      const style = getComputedStyle(field);
      const signature = [field.value, field.selectionStart, field.type, field.scrollLeft, field.scrollTop, rect.x, rect.y, rect.width, rect.height, style.font, style.padding, suggestion, reduce.matches].join("\u0001");
      if (signature === lastMeasurement && shown) return;
      lastMeasurement = signature;
      for (const property of ["font", "letterSpacing", "fontFeatureSettings", "fontVariationSettings", "textIndent", "textAlign", "textTransform", "direction", "tabSize", "padding", "borderWidth", "borderStyle", "boxSizing", "wordBreak", "overflowWrap"] ) {
        const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        mirror.style.setProperty(cssProperty, style.getPropertyValue(cssProperty));
      }
      mirror.style.borderColor = "transparent";
      mirror.style.width = `${field.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
      mirror.style.whiteSpace = field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
      // Measure the full text, so editing inside a wrapping word does not
      // change its line break. Password mirrors contain only mask characters.
      mirror.textContent = (field.type === "password"
        ? (navigator.userAgent.match(/firefox|fxios/i) ? "●" : "•").repeat(field.value.length)
        : field.value) + "\u200b";
      const text = mirror.firstChild;
      if (!text) { hide(); return; }
      const range = document.createRange();
      range.setStart(text, field.selectionStart);
      range.collapse(true);
      const mirrorBox = mirror.getBoundingClientRect();
      const mark = range.getBoundingClientRect();
      const localX = (mark.left - mirrorBox.left - field.scrollLeft) * scaleX;
      const localY = field instanceof HTMLTextAreaElement
        ? (mark.top - mirrorBox.top - field.scrollTop) * scaleY
        : (rect.height - mark.height * scaleY) / 2;
      const caretHeight = mark.height * scaleY;
      // Respect all scrolling/clipping ancestors, including a dialog's body.
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let parent = field.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (!/auto|scroll|hidden|clip/.test(parentStyle.overflowX + parentStyle.overflowY)) continue;
        const box = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(parentStyle.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
        if (/auto|scroll|hidden|clip/.test(parentStyle.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      }
      const nextX = rect.left + localX, nextY = rect.top + localY;
      if (nextX < left - 1 || nextX > right || nextY < top - 1 || nextY + caretHeight > bottom + 1) { hide(); return; }
      // The manual popover is visual only, so it can paint above native dialogs
      // without entering their focus order or escaping their clipping bounds.
      if (typeof layer.showPopover === "function" && !layer.matches(":popover-open")) layer.showPopover();
      layer.style.clipPath = `inset(${top}px ${innerWidth - right}px ${innerHeight - bottom}px ${left}px)`;
      layer.style.color = style.color === "rgba(0, 0, 0, 0)" ? "var(--foreground)" : style.color;
      field.setAttribute("data-smooth-caret-active", "");
      origin.style.left = `${rect.left}px`;
      origin.style.top = `${rect.top}px`;
      x.set(localX); y.set(localY); height.set(caretHeight);
      // Focus, line wraps and scroll move straight to the native position.
      // Only movement within a line glides through the shared composer spring.
      if (!shown || reduce.matches || Math.abs((y.getPrevious() ?? localY) - localY) > caretHeight / 2) { springX.jump(localX); springY.jump(localY); }
      opacity.set(1);
      shown = true;
      const suffix = suggestion && field.value ? suggestion.slice(field.value.length) : "";
      ghost.textContent = suffix;
      ghost.style.font = style.font;
      ghost.style.lineHeight = `${mark.height}px`;
      ghost.style.letterSpacing = style.letterSpacing;
      ghost.style.direction = style.direction;
      ghost.style.transformOrigin = style.direction === "rtl" ? "right top" : "left top";
      ghost.style.transform = `${style.direction === "rtl" ? "translateX(-100%) " : ""}scale(${scaleX}, ${scaleY})`;
      ghost.style.left = `${nextX}px`;
      ghost.style.top = `${nextY}px`;
    };
    // Watch only the active editor. This also follows externally controlled
    // edits and moving panels, which do not emit input/selection events.
    const tick = () => { update(); if (active) frame = requestAnimationFrame(tick); };
    const focus = () => {
      hide(); cancelAnimationFrame(frame);
      // Re-enter the top layer when focus changes: a newly opened dialog may
      // otherwise sit above a popover left open by the previous field.
      if (layer.matches(":popover-open")) layer.hidePopover();
      active = textField(document.activeElement);
      composing = false; lastMeasurement = "";
      if (active) tick();
    };
    const blur = () => {
      hide(); active = null; status.textContent = ""; cancelAnimationFrame(frame);
      if (layer.matches(":popover-open")) layer.hidePopover();
    };
    const onCompositionStart = () => { composing = true; hide(); };
    const onCompositionEnd = () => { composing = false; lastMeasurement = ""; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented || event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || composing) return;
      const suggestion = completion(active);
      if (!suggestion) return;
      event.preventDefault();
      const field = active;
      const suffix = suggestion.slice(field.value.length);
      const completed = field.value + suffix;
      // Native insertion preserves browser undo and sends the real input event.
      document.execCommand("insertText", false, suffix);
      if (field.value !== completed) {
        const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, completed);
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: suffix }));
      }
      if (field.selectionStart !== null) field.setSelectionRange(completed.length, completed.length);
      update();
    };
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("compositionstart", onCompositionStart);
    document.addEventListener("compositionend", onCompositionEnd);
    focus();
    return () => {
      blur();
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("compositionstart", onCompositionStart);
      document.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [body, height, opacity, springX, springY, x, y]);

  return body ? createPortal(<>
    <div ref={mirrorRef} aria-hidden="true" className="smooth-field-mirror" />
    <div ref={layerRef} popover="manual" aria-hidden="true" className="smooth-field-layer">
      <div ref={originRef} className="absolute top-0 left-0">
        <motion.span data-slot="smooth-field-caret" className="smooth-field-caret" style={{ x: springX, y: springY, height, opacity }} />
      </div>
      <span ref={ghostRef} className="smooth-field-suggestion" />
    </div>
    <span ref={statusRef} role="status" className="sr-only" />
  </>, body) : null;
}

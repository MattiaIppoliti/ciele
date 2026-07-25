"use client";

import { ArrowUp, Mic, Search } from "lucide-react";
import { AuthGrid } from "@/components/auth/auth-grid";
import { GhostMark } from "@/components/auth/ghost-mark";

export function AuthChatbotPanel() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#1a1a1a] p-8">
      {/* Vercel-style square grid: thin gridlines tile small squares, fading
          toward the panel edges. */}
      <AuthGrid tone="dark" />

      <div className="relative z-10 w-full max-w-[480px]">
        <div className="mb-8 flex justify-center">
          <GhostMark className="w-24" eyesClassName="ghost-eyes-glance" />
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute -inset-[2px] z-10 overflow-hidden rounded-3xl">
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 604 108"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="none"
            >
              <defs>
                <radialGradient id="authPulseGradient">
                  <stop offset="1%" stopColor="#F5E6E4" stopOpacity="1" />
                  <stop offset="3%" stopColor="#F5E6E4" stopOpacity="0.8" />
                  <stop offset="20%" stopColor="#F5E6E4" stopOpacity="0.4" />
                  <stop offset="50%" stopColor="#F5E6E4" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#F5E6E4" stopOpacity="0" />
                </radialGradient>
                <mask id="authPulseMask">
                  <rect width="604" height="108" fill="white" />
                  <rect x="2" y="2" width="600" height="104" rx="24" ry="24" fill="black" />
                </mask>
              </defs>
              <g mask="url(#authPulseMask)">
                <circle
                  r="85"
                  fill="url(#authPulseGradient)"
                  filter="blur(6px)"
                  className="auth-composer-pulse-left"
                />
                <circle
                  r="85"
                  fill="url(#authPulseGradient)"
                  filter="blur(6px)"
                  className="auth-composer-pulse-right"
                />
              </g>
            </svg>
          </div>

          <div className="relative rounded-3xl border border-[#3a3a3a] bg-[#2a2a2a] p-6 shadow-2xl">
            <div className="flex items-center gap-4">
              <Search className="size-6 shrink-0 text-gray-400" />
              <input
                type="text"
                value=""
                readOnly
                onKeyDown={(e) => e.preventDefault()}
                placeholder="Ask anything..."
                aria-label="Ask anything"
                className="w-full cursor-default bg-transparent text-xl text-gray-200 outline-none placeholder:text-gray-500"
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                aria-label="Voice input"
                className="text-gray-400 transition-colors hover:text-gray-300"
              >
                <Mic className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Send"
                disabled
                className="rounded-full bg-[#3a3a3a] p-2 text-gray-400"
              >
                <ArrowUp className="size-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

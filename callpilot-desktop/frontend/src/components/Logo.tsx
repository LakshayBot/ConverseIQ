import React from "react";
import { AudioWaveform } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface LogoProps {
    isCollapsed: boolean;
}

/**
 * Sidebar brand mark.
 *
 * Reimagined from the old pill-shaped "CallPilot" text and the small low-res
 * `logo-collapsed.png`. Both states now share the same gradient square +
 * `AudioWaveform` glyph so the brand reads consistently at any width:
 *
 *   - expanded: square mark + wordmark + tagline ("Live intelligence").
 *   - collapsed: just the square mark, centred, with a "CallPilot" tooltip.
 *
 * The whole element still triggers the About modal (preserved from the
 * original implementation) so users can keep the existing affordance.
 */
const Logo: React.FC<LogoProps> = ({ isCollapsed }) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        {isCollapsed ? (
          <button
            className="group flex items-center justify-center mx-auto mb-2 cursor-pointer bg-transparent border-none p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
            title="CallPilot"
          >
            <BrandMark size="md" />
          </button>
        ) : (
          <button className="group flex items-center gap-2.5 px-2 py-1.5 mb-2 cursor-pointer bg-transparent border-none rounded-lg hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors">
            <BrandMark size="md" />
            <span className="flex flex-col leading-tight text-left">
              <span className="text-[15px] font-semibold text-gray-900 tracking-tight">
                CallPilot
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                Live intelligence
              </span>
            </span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About CallPilot</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
};

/**
 * Gradient square brand mark. Single source of truth so the expanded and
 * collapsed logos stay pixel-identical.
 */
const BrandMark: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const dim = size === 'md' ? 'h-9 w-9' : 'h-7 w-7';
  const icon = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <div
      className={`relative ${dim} shrink-0 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 shadow-sm ring-1 ring-black/5 flex items-center justify-center overflow-hidden`}
    >
      {/* Subtle inner highlight so the gradient reads as polished, not flat. */}
      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/20" />
      <AudioWaveform className={`relative ${icon} text-white drop-shadow-sm`} strokeWidth={2.25} />
    </div>
  );
};

export default Logo;
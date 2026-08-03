// ============================================================================
// App — the composition root. Owns boot, smooth scroll, cursor and the
// page's night → day → night arc.
// ============================================================================

import { useEffect, useState } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useSmoothScroll } from '@/lib/lenis'
import { useCursor } from '@/lib/cursor'
import { refreshScrollTriggers } from '@/lib/motion'
import { Grain } from './components/Grain'
import { Preloader } from './components/Preloader'
import { ScrollProgress } from './components/ScrollProgress'
import { TopNav } from './components/TopNav'
import { Hero } from './components/Hero'
import { MarqueeStrip } from './components/MarqueeStrip'
import { ProblemSection } from './components/ProblemSection'
import { PipelineSection } from './components/PipelineSection'
import { SignalLab } from './components/SignalLab'
import { CardAnatomy } from './components/CardAnatomy'
import { ArchitectureSection } from './components/ArchitectureSection'
import { UseCasesSection } from './components/UseCasesSection'
import { PricingSection } from './components/PricingSection'
import { FAQSection } from './components/FAQSection'
import { FinalCTA } from './components/FinalCTA'
import { Footer } from './components/Footer'

export default function App(): React.JSX.Element {
  const [booted, setBooted] = useState(false)

  useSmoothScroll()
  useCursor()

  useEffect(() => {
    if (!booted) return
    window.scrollTo(0, 0)
    refreshScrollTriggers()
    const t = setTimeout(() => ScrollTrigger.refresh(), 400)
    return () => clearTimeout(t)
  }, [booted])

  return (
    <div className="relative min-h-screen bg-ink-950">
      <Grain />
      <ScrollProgress />
      <Preloader onDone={() => setBooted(true)} />

      <TopNav />

      <main>
        <Hero booted={booted} />
        <MarqueeStrip />
        <ProblemSection />
        <PipelineSection />
        <SignalLab />
        <CardAnatomy />
        <ArchitectureSection />
        <UseCasesSection />
        <PricingSection />
        <FAQSection />
        <FinalCTA />
      </main>

      <Footer />
    </div>
  )
}
